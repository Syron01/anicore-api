import { db, saveMediaBatch } from './db.js';
import { anilistQuery } from './providers/anilist.js';
import { config } from './config.js';
import { Semaphore, fetchWithRetry } from './lib/rate-limit.js';

const BULK_SEM = new Semaphore(Number(process.env.SYNC_CONCURRENCY ?? 4));
const PER_PAGE = 50;

const SYNC_PAGE_QUERY = `
  query ($kind: MediaType, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { lastPage hasNextPage }
      media(type: $kind, sort: ID, isAdult: false) {
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
 * Paginates with `id_greater` so it is fully resumable: interrupt it any time
 * and running it again continues from the last synced ID.
 * Runs in the background; progress is visible via /v1/sync/status.
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

  // intentionally not awaited — background job
  runSync(kind).catch((err) => {
    console.error(`[sync:${kind}] failed:`, err.message);
    stateUpsert.run({
      kind,
      last_id: stateGet.get(kind).last_id,
      total: stateGet.get(kind).total,
      running: 0,
      started_at: stateGet.get(kind).started_at,
      finished_at: Date.now(),
    });
  });

  return { started: true, resumeFrom: state?.last_id ?? 0 };
}

async function runSync(kind) {
  // `last_id` column stores the last synced PAGE number (page-cursor pagination)
  let nextPage = stateGet.get(kind).last_id + 1;
  let batches = 0;
  console.log(`[sync:${kind}] starting from page ${nextPage}`);
  for (;;) {
    const data = await BULK_SEM.run(() =>
      anilistQuery(SYNC_PAGE_QUERY, { kind, page: nextPage, perPage: PER_PAGE }),
    );
    const medias = data.Page.media;
    if (medias.length === 0) break;

    const items = medias.map((m) => ({
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
    }));

    importBatch(items);
    batches++;

    stateUpsert.run({
      kind,
      last_id: nextPage,
      total: (stateGet.get(kind).total ?? 0) + items.length,
      running: 1,
      started_at: stateGet.get(kind).started_at,
      finished_at: null,
    });

    if (batches % 10 === 0) {
      console.log(`[sync:${kind}] synced page ${nextPage} (batch ${batches}, total ${stateGet.get(kind).total})`);
    }
    if (!data.Page.pageInfo.hasNextPage || nextPage >= (data.Page.pageInfo.lastPage ?? 0)) break;
    nextPage++;
  }
  const s = stateGet.get(kind);
  stateUpsert.run({ kind, last_id: s.last_id, total: s.total, running: 0, started_at: s.started_at, finished_at: Date.now() });
  console.log(`[sync:${kind}] complete: ${s.total} items up to id ${s.last_id}`);
}

function ymd(d) {
  if (!d || !d.year) return null;
  return [d.year, d.month ?? 1, d.day ?? 1].map((n) => String(n).padStart(2, '0')).join('-');
}
