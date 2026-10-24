import { Router } from 'express';
import { cache } from '../lib/cache.js';
import { aggregateMedia, normalizeAnilist, normalizeKitsu } from '../core/aggregate.js';
import { anilistMedia, anilistSeason, anilistCharacter } from '../providers/anilist.js';
import { kitsuAnimeById } from '../providers/kitsu.js';

export const router = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const cacheKey = (prefix, obj) => `${prefix}:${JSON.stringify(obj)}`;

function pageOf(req) {
  return {
    page: Math.max(1, Number.parseInt(req.query.page ?? '1', 10) || 1),
    perPage: Math.min(50, Math.max(1, Number.parseInt(req.query.perPage ?? '20', 10) || 20)),
  };
}

function respond(res, data, providers) {
  res.set('X-Data-Providers', providers.join(','));
  res.set('X-Attribution', 'Metadata by AniList (anilist.co) and Kitsu (kitsu.app)');
  res.json(data);
}

router.get(
  '/anime/search',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'Missing required query param: q' });
    const { page, perPage } = pageOf(req);
    const key = cacheKey('anime:search', { q, page, perPage });
    let payload = cache.get(key);
    if (!payload) {
      payload = await aggregateMedia({
        kind: 'ANIME',
        search: q,
        page,
        perPage,
        sort: 'SEARCH_MATCH',
      });
      cache.set(key, payload);
    }
    respond(res, { data: payload.items, pagination: payload.pageInfo }, ['anilist', 'kitsu']);
  }),
);

router.get(
  '/anime/top',
  wrap(async (req, res) => {
    const { page, perPage } = pageOf(req);
    const key = cacheKey('anime:top', { page, perPage });
    let payload = cache.get(key);
    if (!payload) {
      payload = await aggregateMedia({
        kind: 'ANIME',
        page,
        perPage,
        sort: 'SCORE_DESC',
        enrich: false,
      });
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
      payload = await aggregateMedia({
        kind: 'ANIME',
        page,
        perPage,
        sort: 'TRENDING_DESC',
        enrich: false,
      });
      cache.set(key, payload, 600_000);
    }
    respond(res, { data: payload.items, pagination: payload.pageInfo }, ['anilist']);
  }),
);

const SEASONS = ['winter', 'spring', 'summer', 'fall'];
router.get(
  '/anime/season/:year/:season',
  wrap(async (req, res) => {
    const year = Number(req.params.year);
    const season = String(req.params.season).toLowerCase();
    if (!Number.isInteger(year) || year < 1917 || year > 2200) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    if (!SEASONS.includes(season)) {
      return res.status(400).json({ error: `Season must be one of: ${SEASONS.join(', ')}` });
    }
    const { page, perPage } = pageOf(req);
    const key = cacheKey('anime:season', { year, season, page, perPage });
    let payload = cache.get(key);
    if (!payload) {
      const data = await anilistSeason({ year, season, page, perPage });
      payload = {
        items: (data.Page?.media ?? []).map((m) => normalizeAnilist(m, 'en')),
        pageInfo: data.Page?.pageInfo ?? null,
      };
      cache.set(key, payload);
    }
    respond(res, { data: payload.items, pagination: payload.pageInfo }, ['anilist']);
  }),
);

router.get(
  '/anime/:id',
  wrap(async (req, res) => {
    const key = cacheKey('anime:id', { id: req.params.id });
    let payload = cache.get(key);
    if (!payload) {
      const data = await anilistMedia({ type: 'ANIME', id: Number(req.params.id) });
      if (!data?.Media) return res.status(404).json({ error: 'Anime not found' });
      const enriched = await aggregateMedia({
        kind: 'ANIME',
        id: Number(req.params.id),
        enrich: true,
      });
      payload = enriched.items[0];
      cache.set(key, payload);
    }
    respond(res, { data: payload }, payload.providers);
  }),
);

router.get(
  '/manga/search',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'Missing required query param: q' });
    const { page, perPage } = pageOf(req);
    const key = cacheKey('manga:search', { q, page, perPage });
    let payload = cache.get(key);
    if (!payload) {
      payload = await aggregateMedia({
        kind: 'MANGA',
        search: q,
        page,
        perPage,
        sort: 'SEARCH_MATCH',
      });
      cache.set(key, payload);
    }
    respond(res, { data: payload.items, pagination: payload.pageInfo }, ['anilist', 'kitsu']);
  }),
);

router.get(
  '/manga/:id',
  wrap(async (req, res) => {
    const key = cacheKey('manga:id', { id: req.params.id });
    let payload = cache.get(key);
    if (!payload) {
      const enriched = await aggregateMedia({
        kind: 'MANGA',
        id: Number(req.params.id),
        enrich: true,
      });
      if (!enriched.items[0]) return res.status(404).json({ error: 'Manga not found' });
      payload = enriched.items[0];
      cache.set(key, payload);
    }
    respond(res, { data: payload }, payload.providers);
  }),
);

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
        appearances: (c.media?.nodes ?? []).map((m) => ({
          id: m.id,
          type: m.type,
          title: m.title?.userPreferred ?? null,
        })),
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
