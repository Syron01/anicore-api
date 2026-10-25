import { Router } from 'express';
import { cache } from '../lib/cache.js';
import { aggregateMedia, normalizeAnilist, normalizeKitsu } from '../core/aggregate.js';
import { anilistMedia, anilistSeason, anilistCharacter, anilistMediaExtras } from '../providers/anilist.js';
import { kitsuAnimeById } from '../providers/kitsu.js';
import { startSync } from '../sync.js';
import {
  getMediaById, getMediaBulk, searchMedia, topMedia, seasonMedia, dbStats,
} from '../db.js';
import { db } from '../db.js';
import { getExtras, setExtras } from '../db.js';
import { priority } from '../lib/priority.js';

export const router = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const cacheKey = (prefix, obj) => `${prefix}:${JSON.stringify(obj)}`;

function pageOf(req) {
  return {
    page: Math.max(1, Number.parseInt(req.query.page ?? '1', 10) || 1),
    perPage: Math.min(50, Math.max(1, Number.parseInt(req.query.perPage ?? '20', 10) || 20)),
  };
}

function respond(res, data, providers, served = 'live') {
  res.set('X-Data-Providers', providers.join(','));
  res.set('X-Attribution', 'Metadata by AniList (anilist.co) and Kitsu (kitsu.app)');
  // "mirror" = served from local SQLite mirror: unlimited, millisecond-fast
  res.set('X-Served-By', served);
  res.json(data);
}

function paginationOf(page, perPage, count) {
  return { page, perPage, count, hasMore: count === perPage };
}

/* ---------------------------------- sync ---------------------------------- */

router.post('/sync/:kind', wrap(async (req, res) => {
  const kind = req.params.kind.toUpperCase();
  if (kind !== 'ANIME' && kind !== 'MANGA') {
    return res.status(400).json({ error: 'kind must be anime or manga' });
  }
  const result = startSync(kind);
  res.status(result.alreadyRunning ? 409 : 202).json({ kind, ...result });
}));

router.get('/sync/status', (req, res) => {
  res.json(dbStats());
});

/* ---------------------------------- anime --------------------------------- */

router.get(
  '/anime/search',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'Missing required query param: q' });
    const { page, perPage } = pageOf(req);

    const hasMirror = db.prepare('SELECT COUNT(*) n FROM media WHERE kind=?').get('ANIME').n > 0;
    if (hasMirror) {
      const { items } = searchMedia('ANIME', q, { page, perPage });
      return respond(res, { data: items, pagination: paginationOf(page, perPage, items.length) }, ['anilist'], 'mirror');
    }
    const key = cacheKey('anime:search', { q, page, perPage });
    let payload = cache.get(key);
    if (!payload) {
      payload = await aggregateMedia({ kind: 'ANIME', search: q, page, perPage, sort: 'SEARCH_MATCH' });
      cache.set(key, payload);
    }
    respond(res, { data: payload.items, pagination: payload.pageInfo }, ['anilist', 'kitsu']);
  }),
);

router.get(
  '/anime/top',
  wrap(async (req, res) => {
    const { page, perPage } = pageOf(req);
    const by = req.query.by === 'popularity' ? 'popularity' : 'score';
    const hasMirror = db.prepare('SELECT COUNT(*) n FROM media WHERE kind=?').get('ANIME').n > 0;
    if (hasMirror) {
      const items = topMedia('ANIME', { page, perPage, by });
      return respond(res, { data: items, pagination: paginationOf(page, perPage, items.length) }, ['anilist'], 'mirror');
    }
    const key = cacheKey('anime:top', { page, perPage });
    let payload = cache.get(key);
    if (!payload) {
      payload = await aggregateMedia({ kind: 'ANIME', page, perPage, sort: by === 'popularity' ? 'POPULARITY_DESC' : 'SCORE_DESC', enrich: false });
      cache.set(key, payload, 3600_000);
    }
    respond(res, { data: payload.items, pagination: payload.pageInfo }, ['anilist']);
  }),
);

router.get(
  '/anime/trending',
  wrap(async (req, res) => {
    const { page, perPage } = pageOf(req);
    const key = cacheKey('anime:trending', { page, perPage });
    let payload = cache.get(key);
    if (!payload) {
      payload = await aggregateMedia({ kind: 'ANIME', page, perPage, sort: 'TRENDING_DESC', enrich: false });
      cache.set(key, payload, 300_000);
    }
    respond(res, { data: payload.items, pagination: payload.pageInfo }, ['anilist']);
  }),
);

router.get(
  '/anime/season/:year/:season',
  wrap(async (req, res) => {
    const year = Number(req.params.year);
    const season = String(req.params.season).toLowerCase();
    if (!Number.isInteger(year) || year < 1917 || year > 2200) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    if (!['winter', 'spring', 'summer', 'fall'].includes(season)) {
      return res.status(400).json({ error: 'Season must be one of: winter, spring, summer, fall' });
    }
    const { page, perPage } = pageOf(req);
    const hasMirror = db.prepare('SELECT COUNT(*) n FROM media WHERE kind=?').get('ANIME').n > 0;
    if (hasMirror) {
      const items = seasonMedia('ANIME', { year, season, page, perPage });
      return respond(res, { data: items, pagination: paginationOf(page, perPage, items.length) }, ['anilist'], 'mirror');
    }
    const key = cacheKey('anime:season', { year, season, page, perPage });
    let payload = cache.get(key);
    if (!payload) {
      const data = await anilistSeason({ year, season, page, perPage });
      payload = { items: (data.Page?.media ?? []).map((m) => normalizeAnilist(m, 'en')), pageInfo: data.Page?.pageInfo ?? null };
      cache.set(key, payload);
    }
    respond(res, { data: payload.items, pagination: payload.pageInfo }, ['anilist']);
  }),
);

router.get(
  '/anime/bulk',
  wrap(async (req, res) => {
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 500);
    if (ids.length === 0) return res.status(400).json({ error: 'Provide ids=1,2,3 (max 500)' });
    const kind = String(req.query.type ?? 'anime').toLowerCase() === 'manga' ? 'MANGA' : 'ANIME';

    // mirror hit first — instant
    let items = getMediaBulk(kind, ids);
    if (items.some((x) => x === null)) {
      const missing = ids.filter((_, i) => items[i] === null);
      const live = await Promise.all(missing.map((id) =>
        anilistMedia({ type: kind, id }).then((d) => (d?.Media ? normalizeAnilist(d.Media, 'en') : null)).catch(() => null),
      ));
      const map = new Map(missing.map((id, i) => [id, live[i]]));
      items = items.map((it, i) => it ?? map.get(ids[i]) ?? null);
    }
    respond(res, { data: items, found: items.filter(Boolean).length }, ['anilist'], 'mirror+live');
  }),
);

router.get(
  '/anime/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const mirrored = getMediaById('ANIME', id);
    if (mirrored) return respond(res, { data: mirrored }, ['anilist'], 'mirror');
    const data = await anilistMedia({ type: 'ANIME', id });
    if (!data?.Media) return res.status(404).json({ error: 'Anime not found' });
    const enriched = await aggregateMedia({ kind: 'ANIME', id, enrich: true });
    respond(res, { data: enriched.items[0] }, enriched.items[0].providers);
  }),
);

router.get(
  '/anime/:id/full',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });

    // 1) media: pure local mirror read — millisecond fast, always
    let media = getMediaById('ANIME', id);
    let mediaSource = 'mirror';

    // 2) extras: permanent local cache → zero repeat cost
    let extras = getExtras(id);
    let extrasSource = extras ? 'cache' : null;

    // 3) only the very first click ever pays one batched live round-trip;
    //    sync yields to us while we wait, so this stays sub-second
    if (!extras) {
      priority.waiters++;
      try {
        const data = await anilistMediaExtras(id);
        if (data?.Media) {
          extras = {
            characters: (data.Media.characters?.edges ?? []).map((e) => ({
              role: e.role,
              id: e.node.id,
              name: { full: e.node.name?.full ?? null, native: e.node.name?.native ?? null },
              image: e.node.image?.large ?? null,
            })),
            relations: (data.Media.relations?.edges ?? []).map((e) => ({
              relation: e.relationType,
              id: e.node.id,
              type: e.node.type,
              title: e.node.title?.userPreferred ?? null,
              cover: e.node.coverImage?.large ?? null,
              format: e.node.format ?? null,
              score: e.node.averageScore ?? null,
            })),
            recommendations: (data.Media.recommendations?.nodes ?? [])
              .filter((n) => n.mediaRecommendation)
              .map((n) => ({
                rating: n.rating,
                id: n.mediaRecommendation.id,
                type: n.mediaRecommendation.type,
                title: n.mediaRecommendation.title?.userPreferred ?? null,
                cover: n.mediaRecommendation.coverImage?.large ?? null,
                score: n.mediaRecommendation.averageScore ?? null,
                format: n.mediaRecommendation.format ?? null,
              })),
          };
          setExtras(id, extras);
          extrasSource = 'live';
        }
      } catch {
        extras = { characters: [], relations: [], recommendations: [] };
        extrasSource = 'unavailable';
      } finally {
        priority.waiters--;
      }
    }

    // 4) mirror miss → fetch media once and persist it
    if (!media) {
      priority.waiters++;
      try {
        const data = await anilistMedia({ type: 'ANIME', id });
        if (!data?.Media) return res.status(404).json({ error: 'Anime not found' });
        const enriched = await aggregateMedia({ kind: 'ANIME', id, enrich: false });
        media = enriched.items[0];
        mediaSource = 'live';
      } finally {
        priority.waiters--;
      }
    }

    respond(
      res,
      { data: { media, ...extras }, meta: { mediaSource, extrasSource } },
      ['anilist'],
      extrasSource === 'cache' ? 'mirror' : 'mirror+live',
    );
  }),
);

router.get(
  '/anime/:id/characters',
  wrap(async (req, res) => {
    const key = cacheKey('anime:chars', { id: req.params.id });
    let payload = cache.get(key);
    if (!payload) {
      const data = await anilistMediaExtras(Number(req.params.id));
      if (!data?.Media) return res.status(404).json({ error: 'Anime not found' });
      payload = (data.Media.characters?.edges ?? []).map((e) => ({
        role: e.role,
        id: { anilist: e.node.id },
        name: { full: e.node.name?.full ?? null, native: e.node.name?.native ?? null },
        image: e.node.image?.large ?? null,
      }));
      cache.set(key, payload, 3600_000);
    }
    respond(res, { data: payload }, ['anilist']);
  }),
);

router.get(
  '/anime/:id/relations',
  wrap(async (req, res) => {
    const key = cacheKey('anime:rels', { id: req.params.id });
    let payload = cache.get(key);
    if (!payload) {
      const data = await anilistMediaExtras(Number(req.params.id));
      if (!data?.Media) return res.status(404).json({ error: 'Anime not found' });
      payload = (data.Media.relations?.edges ?? []).map((e) => ({
        relation: e.relationType,
        id: e.node.id,
        type: e.node.type,
        title: e.node.title?.userPreferred ?? null,
        cover: e.node.coverImage?.large ?? null,
        format: e.node.format ?? null,
        score: e.node.averageScore ?? null,
      }));
      cache.set(key, payload, 3600_000);
    }
    respond(res, { data: payload }, ['anilist']);
  }),
);

router.get(
  '/anime/:id/recommendations',
  wrap(async (req, res) => {
    const key = cacheKey('anime:recs', { id: req.params.id });
    let payload = cache.get(key);
    if (!payload) {
      const data = await anilistMediaExtras(Number(req.params.id));
      if (!data?.Media) return res.status(404).json({ error: 'Anime not found' });
      payload = (data.Media.recommendations?.nodes ?? [])
        .filter((n) => n.mediaRecommendation)
        .map((n) => ({
          rating: n.rating,
          id: n.mediaRecommendation.id,
          type: n.mediaRecommendation.type,
          title: n.mediaRecommendation.title?.userPreferred ?? null,
          cover: n.mediaRecommendation.coverImage?.large ?? null,
          score: n.mediaRecommendation.averageScore ?? null,
          format: n.mediaRecommendation.format ?? null,
        }));
      cache.set(key, payload, 3600_000);
    }
    respond(res, { data: payload }, ['anilist']);
  }),
);

/* ---------------------------------- manga --------------------------------- */

router.get(
  '/manga/search',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'Missing required query param: q' });
    const { page, perPage } = pageOf(req);
    const hasMirror = db.prepare('SELECT COUNT(*) n FROM media WHERE kind=?').get('MANGA').n > 0;
    if (hasMirror) {
      const { items } = searchMedia('MANGA', q, { page, perPage });
      return respond(res, { data: items, pagination: paginationOf(page, perPage, items.length) }, ['anilist'], 'mirror');
    }
    const key = cacheKey('manga:search', { q, page, perPage });
    let payload = cache.get(key);
    if (!payload) {
      payload = await aggregateMedia({ kind: 'MANGA', search: q, page, perPage, sort: 'SEARCH_MATCH' });
      cache.set(key, payload);
    }
    respond(res, { data: payload.items, pagination: payload.pageInfo }, ['anilist', 'kitsu']);
  }),
);

router.get(
  '/manga/top',
  wrap(async (req, res) => {
    const { page, perPage } = pageOf(req);
    const hasMirror = db.prepare('SELECT COUNT(*) n FROM media WHERE kind=?').get('MANGA').n > 0;
    if (hasMirror) {
      const items = topMedia('MANGA', { page, perPage, by: req.query.by === 'popularity' ? 'popularity' : 'score' });
      return respond(res, { data: items, pagination: paginationOf(page, perPage, items.length) }, ['anilist'], 'mirror');
    }
    const key = cacheKey('manga:top', { page, perPage });
    let payload = cache.get(key);
    if (!payload) {
      payload = await aggregateMedia({ kind: 'MANGA', page, perPage, sort: 'SCORE_DESC', enrich: false });
      cache.set(key, payload, 3600_000);
    }
    respond(res, { data: payload.items, pagination: payload.pageInfo }, ['anilist']);
  }),
);

router.get(
  '/manga/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const mirrored = getMediaById('MANGA', id);
    if (mirrored) return respond(res, { data: mirrored }, ['anilist'], 'mirror');
    const enriched = await aggregateMedia({ kind: 'MANGA', id, enrich: true });
    if (!enriched.items[0]) return res.status(404).json({ error: 'Manga not found' });
    respond(res, { data: enriched.items[0] }, enriched.items[0].providers);
  }),
);

/* ------------------------------- character etc ---------------------------- */

router.get(
  '/character/:id',
  wrap(async (req, res) => {
    const key = cacheKey('character', { id: req.params.id });
    let payload = cache.get(key);
    if (!payload) {
      const c = await anilistCharacter(Number(req.params.id));
      if (!c) return res.status(404).json({ error: 'Character not found' });
      payload = {
        id: { anilist: c.id },
        name: c.name,
        description: c.description?.replace(/<[^>]*>/g, '').trim() ?? null,
        image: c.image?.large ?? null,
        favorites: c.favourites ?? null,
        appearances: (c.media?.nodes ?? []).map((m) => ({ id: m.id, type: m.type, title: m.title?.userPreferred ?? null })),
      };
      cache.set(key, payload);
    }
    respond(res, { data: payload }, ['anilist']);
  }),
);

router.get(
  '/kitsu/anime/:id',
  wrap(async (req, res) => {
    const key = cacheKey('kitsu:anime', { id: req.params.id });
    let payload = cache.get(key);
    if (!payload) {
      const raw = await kitsuAnimeById(req.params.id);
      if (!raw) return res.status(404).json({ error: 'Not found on Kitsu' });
      payload = normalizeKitsu(raw);
      cache.set(key, payload);
    }
    respond(res, { data: payload }, ['kitsu']);
  }),
);
