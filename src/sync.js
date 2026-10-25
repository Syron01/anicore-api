import { db, saveMediaBatch } from './db.js';
import { anilistQuery } from './providers/anilist.js';
import { Semaphore } from './lib/rate-limit.js';
import { priority } from './lib/priority.js';

const BULK_SEM = new Semaphore(Number(process.env.SYNC_CONCURRENCY ?? 4));
const PER_PAGE = 50;
// AniList caps Page depth at 5000 entries (page 101 @ perPage 50).
// So we chunk the entire catalog BY YEAR — no single year comes close to 5k.
// Anime chunk on seasonYear; manga chunk on startDate year (manga rarely has
// seasonYear). Cursor = year*10000 + page, stored in sync_state.last_id.
const FIRST_YEAR = 1917;
const CURRENT_YEAR = new Date().getFullYear() + 1;

const SYNC_PAGE_QUERY = `
  query ($kind: MediaType, $page: Int, $perPage: Int, $seasonYear: Int, $startG: FuzzyDateInt, $startL: FuzzyDateInt) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(type: $kind, sort: ID, isAdult: false,
            seasonYear: $seasonYear,
            startDate_greater: $startG, startDate_lesser: $startL) {
        id idMal title { romaji english native userPreferred } synonyms
        description(asHtml: false) format status episodes duration chapters volumes
        genres tags { name rank isMediaSpoiler } averageScore meanScore popularity favourites
        startDate { year month day } endDate { year month day } season seasonYear
        countryOfOrigin isAdult coverImage { extraLarge large color } bannerImage
        trailer { id site } externalLinks { site url language }
        studios(isMain: true) { edges { node { id name } } } source hashtag
      }
    }
  }
`;

const stateGet = db.prepare('SELECT * FROM sync_state WHERE kind = ?');
const stateUpsert = db.prepare(`
  INSERT INTO sync_state (kind, last_id, total, running, started_at, finished_at)
  VALUES (@kind, @last_id, @total, @running, @started_at, @finished_at)
  ON CONFLICT(kind) DO UPDATE SET
    last_id = excluded.last_id, total = excluded.total,
    running = excluded.running, started_at = excluded.started_at,
    finished_at = excluded.finished_at
`);

const importBatch = db.transaction((items) => saveMediaBatch(items));

/**
 * Bulk-sync ALL anime or manga from AniList into the local SQLite mirror.
 * Year-chunked to stay under AniList's 5000-entry page-depth cap, and fully
 * resumable: interrupt any time, rerun to continue from the last year/page.
 * Runs in the background; progress via /v1/sync/status.
 */
export function startSync(kind) {
  const state = stateGet.get(kind);
  if (state?.running) return { alreadyRunning: true, state };

  stateUpsert.run({
    kind,
    last_id: state?.last_id ?? 0,
    total: state?.total ?? null,
    running: 1,
    started_at: Date.now(),
    finished_at: null,
  });

  runSync(kind).catch((err) => {
    console.error(`[sync:${kind}] failed:`, err.message);
    const s = stateGet.get(kind);
    stateUpsert.run({ kind, last_id: s.last_id, total: s.total, running: 0, started_at: s.started_at, finished_at: Date.now() });
  });

  return { started: true, resumeFrom: state?.last_id ?? 0 };
}

async function runSync(kind) {
  const filterFor = (year) =>
    kind === 'ANIME'
      ? { seasonYear: year, startG: undefined, startL: undefined }
      : { seasonYear: undefined, startG: `${year}0101`, startL: `${year + 1}0101` };

  let cursor = stateGet.get(kind).last_id;
  let resumeYear = Math.floor(cursor / 10000);
  let resumePage = (cursor % 10000) + 1;
  const years = [];
  for (let y = FIRST_YEAR; y <= CURRENT_YEAR; y++) years.push(y);

  for (const year of years) {
    if (year < resumeYear) continue;
    let page = year === resumeYear ? resumePage : 1;
    const { overflow } = await pageLoop(kind, filterFor(year), page);
    if (overflow) {
      // year has >5000 entries (AniList page-depth cap) → re-chunk by month
      console.log(`[sync:${kind}] year ${year} overflow, falling back to month chunks`);
      for (let month = 1; month <= 12; month++) {
        const f = filterFor(year);
        f.startG = `${year}${String(month).padStart(2, '0')}01`;
        const nm = month === 12 ? `${year + 1}0101` : `${year}${String(month + 1).padStart(2, '0')}01`;
        f.startL = nm;
        await pageLoop(kind, f, 1);
      }
    }
  }

  const s = stateGet.get(kind);
  stateUpsert.run({ kind, last_id: s.last_id, total: s.total, running: 0, started_at: s.started_at, finished_at: Date.now() });
  console.log(`[sync:${kind}] complete: ${s.total} items`);
}

async function pageLoop(kind, filters, startPage) {
  let page = startPage;
  for (;;) {
    // yield to interactive (user-facing) requests before every page
    while (priority.waiters > 0) {
      await new Promise((r) => setTimeout(r, 300));
    }
    let medias;
    let data;
    try {
      data = await BULK_SEM.run(() =>
        anilistQuery(SYNC_PAGE_QUERY, { kind, page, perPage: PER_PAGE, ...filters }),
      );
      medias = data.Page.media;
      if (medias.length === 0) return { overflow: false };
    } catch (err) {
      if (String(err.message).includes('depth exceeds')) return { overflow: true };
      // one chunk failing must never kill the whole mirror build
      console.error(`[sync:${kind}] page ${page} failed: ${err.message}`);
      return { overflow: false };
    }

    importBatch(medias.map((m) => toItem(m, kind)));

    stateUpsert.run({
      kind,
      last_id: page,
      total: (stateGet.get(kind).total ?? 0) + medias.length,
      running: 1,
      started_at: stateGet.get(kind).started_at,
      finished_at: null,
    });

    if (!data.Page.pageInfo.hasNextPage) return { overflow: false };
    page++;
  }
}

function toItem(m, kind) {
  return {
    type: kind,
    id: { anilist: m.id, myanimelist: m.idMal, kitsu: null },
    title: m.title,
    synonyms: m.synonyms,
    description: m.description ? m.description.replace(/<[^>]*>/g, '').trim() : null,
    format: m.format,
    status: m.status,
    episodes: m.episodes,
    chapters: m.chapters,
    volumes: m.volumes,
    durationMinutes: m.duration,
    genres: m.genres,
    tags: (m.tags ?? []).filter((t) => !t.isMediaSpoiler).map((t) => ({ name: t.name, rank: t.rank })),
    scores: { average: m.averageScore, mean: m.meanScore, popularity: m.popularity, favorites: m.favourites },
    dates: { start: ymd(m.startDate), end: ymd(m.endDate), season: m.season, seasonYear: m.seasonYear },
    countryOfOrigin: m.countryOfOrigin,
    isAdult: m.isAdult,
    studios: (m.studios?.edges ?? []).map((e) => ({ id: e.node.id, name: e.node.name })),
    source: m.source,
    images: { cover: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null, color: m.coverImage?.color ?? null, banner: m.bannerImage ?? null },
    trailer: m.trailer ? { id: m.trailer.id, site: m.trailer.site } : null,
    externalLinks: (m.externalLinks ?? []).map((l) => ({ site: l.site, url: l.url, language: l.language ?? null })),
    hashtag: m.hashtag,
    providers: ['anilist'],
  };
}

function ymd(d) {
  if (!d || !d.year) return null;
  return [d.year, d.month ?? 1, d.day ?? 1].map((n) => String(n).padStart(2, '0')).join('-');
}
