import express from 'express';
import { config, SUPPORTED_LANGUAGES } from './config.js';
import { router } from './routes/index.js';
import { cache } from './lib/cache.js';

export function createApp() {
  const app = express();

  // CORS (allow any self-hoster to consume)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      config.corsOrigin.includes('*') ||
      (origin && config.corsOrigin.includes(origin))
    ) {
      res.set('Access-Control-Allow-Origin', origin ?? '*');
    }
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/', (req, res) => {
    res.json({
      name: 'AniCore API',
      version: '1.0.0',
      description:
        'Free, self-hostable, multilingual anime & manga metadata API. No API keys, no paid tier, no copyrighted data stored.',
      documentation: '/docs',
      languages: SUPPORTED_LANGUAGES,
      providers: ['anilist', 'kitsu'],
      license: 'MIT',
    });
  });

  app.get('/languages', (req, res) => res.json({ languages: SUPPORTED_LANGUAGES }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', cache: cache.stats(), uptime: process.uptime() });
  });

  app.use('/v1', router);
  app.use('/docs', (req, res) =>
    res.type('text/plain').send(quickDocs()),
  );

  app.use((req, res) => res.status(404).json({ error: 'Not found', hint: 'See /docs' }));
  app.use((err, req, res, next) => {
    const status = err.status && err.status >= 400 ? err.status : 502;
    res.status(status).json({
      error: err.message ?? 'Upstream provider error',
      hint: 'This API aggregates open community APIs; transient upstream errors are retried automatically. Try again shortly.',
    });
  });

  return app;
}

function quickDocs() {
  return `AniCore API v1 — Endpoints

GET  /v1/anime/:id                 Anime detail (enriched with Kitsu cross-id)
GET  /v1/anime/search?q=&page=&perPage=   Search anime
GET  /v1/anime/top                 Top-rated anime
GET  /v1/anime/trending            Trending anime
GET  /v1/anime/season/:year/:season   Season by year (winter|spring|summer|fall)
GET  /v1/manga/:id                 Manga detail
GET  /v1/manga/search?q=           Search manga
GET  /v1/character/:id             Character detail (AniList)
GET  /v1/kitsu/anime/:id           Direct Kitsu anime by Kitsu ID
GET  /languages                    Supported language codes
GET  /health                       Health + cache stats

Attribution: metadata aggregated live from AniList (anilist.co) and Kitsu (kitsu.app).
Every response carries X-Data-Providers and X-Attribution headers.
License: MIT (code). Data belongs to its providers — this service stores none.
`;
}
