/**
 * Normalization layer: turns provider-specific payloads into one unified,
 * provider-agnostic schema. Titles are exposed per-language; the caller's
 * ?lang= preference decides which title surfaces as `title.preferred`.
 */

const KITSU_TITLE_KEYS = ['en', 'en_jp', 'ja_jp', 'en_us', 'ko_kr', 'zh_cn', 'zh_tw', 'zh_hk'];

export function normalizeAnilist(media, lang = 'en') {
  if (!media) return null;
  const titles = {
    romaji: media.title?.romaji ?? null,
    english: media.title?.english ?? null,
    native: media.title?.native ?? null,
    userPreferred: media.title?.userPreferred ?? null,
    synonyms: media.synonyms ?? [],
  };
  const preferred =
    (lang === 'ja' ? titles.native : null) ??
    (lang !== 'en' && titles.english ? titles.english : titles.userPreferred) ??
    titles.romaji ??
    titles.english ??
    titles.native;

  return {
    type: media.type ?? null,
    id: { anilist: media.id ?? null, myanimelist: media.idMal ?? null, kitsu: null },
    title: { ...titles, preferred },
    description: media.description
      ? media.description.replace(/<[^>]*>/g, '').trim()
      : null,
    format: lower(media.format),
    status: lower(media.status),
    episodes: media.episodes ?? null,
    chapters: media.chapters ?? null,
    volumes: media.volumes ?? null,
    durationMinutes: media.duration ?? null,
    genres: media.genres ?? [],
    tags: (media.tags ?? [])
      .filter((t) => !t.isMediaSpoiler)
      .map((t) => ({ name: t.name, rank: t.rank })),
    scores: {
      average: media.averageScore ?? null,
      mean: media.meanScore ?? null,
      popularity: media.popularity ?? null,
      favorites: media.favourites ?? null,
    },
    dates: {
      start: ymd(media.startDate),
      end: ymd(media.endDate),
      season: lower(media.season),
      seasonYear: media.seasonYear ?? null,
    },
    countryOfOrigin: media.countryOfOrigin ?? null,
    isAdult: Boolean(media.isAdult),
    studios: (media.studios?.edges ?? []).map((e) => ({ id: e.node.id, name: e.node.name })),
    source: lower(media.source),
    images: {
      cover: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
      color: media.coverImage?.color ?? null,
      banner: media.bannerImage ?? null,
    },
    trailer: media.trailer ? { id: media.trailer.id, site: media.trailer.site } : null,
    externalLinks: (media.externalLinks ?? []).map((l) => ({
      site: l.site,
      url: l.url,
      language: l.language ?? null,
    })),
    hashtag: media.hashtag ?? null,
    providers: ['anilist'],
  };
}

export function normalizeKitsu(anime) {
  if (!anime) return null;
  const a = anime.attributes ?? {};
  const titles = {};
  for (const key of KITSU_TITLE_KEYS) {
    if (a.titles?.[key]) titles[key] = a.titles[key];
  }
  const canonical =
    a.canonicalTitle ?? a.titles?.en_jp ?? a.titles?.en ?? Object.values(a.titles ?? {})[0] ?? null;
  return {
    type: 'Anime',
    id: { kitsu: anime.id, anilist: null, myanimelist: null },
    title: {
      romaji: a.titles?.en_jp ?? null,
      english: a.titles?.en_us ?? a.titles?.en ?? null,
      native: a.titles?.ja_jp ?? null,
      userPreferred: canonical,
      synonyms: [],
      extra: titles,
    },
    description: a.synopsis ?? a.description ?? null,
    format: a.subtype ? a.subtype.toLowerCase() : null,
    status: mapKitsuStatus(a.status),
    episodes: a.episodeCount ?? null,
    chapters: null,
    volumes: null,
    durationMinutes: a.episodeLength ?? null,
    genres: [],
    tags: [],
    scores: {
      average: a.averageRating ? Number(a.averageRating) : null,
      mean: null,
      popularity: a.userCount ?? null,
      favorites: a.favoritesCount ?? null,
    },
    dates: {
      start: a.startDate ?? null,
      end: a.endDate ?? null,
      season: a.season ?? null,
      seasonYear: a.seasonYear ?? null,
    },
    countryOfOrigin: null,
    isAdult: Boolean(a.nsfw),
    studios: [],
    source: null,
    images: {
      cover: a.posterImage?.original ?? a.posterImage?.large ?? null,
      color: null,
      banner: a.coverImage?.original ?? null,
    },
    trailer: a.youtubeVideoId ? { id: a.youtubeVideoId, site: 'youtube' } : null,
    externalLinks: [],
    hashtag: null,
    providers: ['kitsu'],
  };
}

function mapKitsuStatus(s) {
  switch (s) {
    case 'current': return 'releasing';
    case 'finished': return 'finished';
    case 'upcoming': return 'not_yet_released';
    case 'tba': return 'cancelled';
    default: return s ?? null;
  }
}

function ymd(d) {
  if (!d || !d.year) return null;
  const parts = [d.year, d.month ?? 1, d.day ?? 1].map((n) => String(n).padStart(2, '0'));
  return parts.length === 3 ? parts.join('-') : null;
}

const lower = (s) => (s ? s.toLowerCase() : null);
