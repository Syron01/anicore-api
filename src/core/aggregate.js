import { normalizeAnilist, normalizeKitsu } from './normalize.js';
import { kitsuSearch } from '../providers/kitsu.js';
import { anilistMedia } from '../providers/anilist.js';

/**
 * Aggregation layer.
 * Primary source: AniList (richer categorization, MAL cross-id).
 * Enrichment:    Kitsu  (per-language titles, independent ID namespace).
 * Cross-provider matching is done by normalized title + fuzzy compare,
 * never by scraping anything. Each response records exactly which
 * providers contributed, so attribution is always visible.
 */

function normalizeTitle(t) {
  return (t ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
    .trim();
}

function titleSimilarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  return 0;
}

async function matchKitsu(media, kind) {
  const candidates = [
    media.title?.english,
    media.title?.romaji,
    media.title?.userPreferred,
  ].filter(Boolean);
  if (candidates.length === 0) return null;

  const searchKind = kind === 'ANIME' ? 'anime' : 'manga';
  for (const candidate of candidates) {
    try {
      const results = await kitsuSearch(searchKind, candidate, { limit: 5 });
      let best = null;
      let bestScore = 0;
      for (const r of results) {
        const attrs = r.attributes ?? {};
        const names = [
          attrs.canonicalTitle,
          ...Object.values(attrs.titles ?? {}),
        ].filter(Boolean);
        const score = Math.max(
          ...names.map((n) => titleSimilarity(candidate, n)),
          0,
        );
        // require a real match, not just the first result
        if (score > bestScore) {
          bestScore = score;
          best = r;
        }
      }
      if (best && bestScore >= 0.8) return best;
    } catch {
      // Kitsu enrichment is best-effort; never fail the main request over it
    }
  }
  return null;
}

export async function aggregateMedia({ kind, id, search, page, perPage, sort, enrich = true }) {
  const data = await anilistMedia({ type: kind, id, search, page, perPage, sort });
  const medias = id ? [data.Media] : data.Page.media;
  const pageInfo = id ? null : data.Page.pageInfo;

  const items = await Promise.all(
    medias.filter(Boolean).map(async (media) => {
      const item = normalizeAnilist(media, 'en');
      item.type = kind === 'ANIME' ? 'ANIME' : 'MANGA';
      if (enrich) {
        const kitsu = await matchKitsu(media, kind);
        if (kitsu) {
          item.id.kitsu = kitsu.id;
          item.providers.push('kitsu');
        }
      }
      return item;
    }),
  );

  return { items, pageInfo };
}

export { normalizeAnilist, normalizeKitsu };
