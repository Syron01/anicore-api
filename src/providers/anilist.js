import { config } from '../config.js';
import { Semaphore, fetchWithRetry } from '../lib/rate-limit.js';

const sem = new Semaphore(config.providers.anilist.concurrency);

/**
 * AniList GraphQL provider.
 * Open API, no key required. Multilingual titles (romaji/english/native),
 * deep categorization (genres + tags), studio/character/staff data.
 * https://docs.anilist.co
 */
export async function anilistQuery(query, variables = {}) {
  return sem.run(async () => {
    const res = await fetchWithRetry(config.providers.anilist.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Attribution per AniList guidelines
        'User-Agent': 'AniCore-API/1.0 (open-source metadata aggregator)',
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors?.length) {
      const e = new Error(json.errors[0].message);
      e.status = json.errors[0].status ?? res.status;
      throw e;
    }
    if (!res.ok) {
      const e = new Error(`AniList request failed (${res.status})`);
      e.status = res.status;
      throw e;
    }
    return json.data;
  });
}

const MEDIA_CORE = `
  id
  idMal
  title { romaji english native userPreferred }
  synonyms
  description(asHtml: false)
  format
  status
  episodes
  duration
  chapters
  volumes
  genres
  tags { name rank isMediaSpoiler }
  averageScore
  meanScore
  popularity
  favourites
  startDate { year month day }
  endDate { year month day }
  season
  seasonYear
  countryOfOrigin
  isAdult
  coverImage { extraLarge large color }
  bannerImage
  trailer { id site }
  externalLinks { id site url language color icon }
  studios(isMain: true) { edges { node { id name } } }
  source
  hashtag
`;

export async function anilistMedia({ type, id, search, page = 1, perPage = 20, sort }) {
  let query;
  const vars = { page, perPage };
  if (id) {
    query = `query ($id: Int) { Media(id: $id, type: ${type}) { ${MEDIA_CORE} } }`;
    vars.id = id;
  } else {
    query = `query ($page: Int, $perPage: Int, $search: String, $sort: [MediaSort]) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage perPage hasNextPage }
        media(search: $search, type: ${type}, sort: $sort, isAdult: false) { ${MEDIA_CORE} }
      }
    }`;
    vars.search = search;
    vars.sort = sort;
  }
  return anilistQuery(query, vars);
}

export async function anilistSeason({ year, season, page = 1, perPage = 20 }) {
  const query = `query ($page: Int, $perPage: Int, $year: Int, $season: MediaSeason) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total currentPage perPage hasNextPage }
      media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_CORE} }
    }
  }`;
  return anilistQuery(query, { page, perPage, year, season: season.toUpperCase() });
}

export async function anilistCharacter(id) {
  const query = `query ($id: Int) {
    Character(id: $id) {
      id
      name { full native alternative }
      image { large }
      description(asHtml: false)
      favourites
      media(sort: POPULARITY_DESC, perPage: 5) { nodes { id type title { userPreferred romaji } } }
    }
  }`;
  const data = await anilistQuery(query, { id });
  return data.Character;
}
