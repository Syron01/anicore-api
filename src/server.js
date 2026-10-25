import path from 'node:path';
import express from 'express';
import compression from 'compression';
import { config, SUPPORTED_LANGUAGES } from './config.js';
import { router } from './routes/index.js';
import { cache } from './lib/cache.js';
import { dbStats } from './db.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');
  app.use(compression());
  app.use(express.static(path.join(process.cwd(), 'public')));

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
    res.json({ status: 'ok', cache: cache.stats(), db: dbStats(), uptime: process.uptime() });
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
  return `AniCore API v2 — Endpoints

POWER MODE: run POST /v1/sync/anime once to mirror the ENTIRE AniList anime
database (~21k titles) into local SQLite. After that, search/top/season/:id
come from the mirror: ZERO rate limits on your side, millisecond responses
(X-Served-By: mirror). Fully resumable — interrupt anytime, rerun to continue.
Manga: POST /v1/sync/manga. Progress: GET /v1/sync/status.

GET  /v1/anime/search?q=&page=&perPage=   Search (FTS5 full-text on mirror)
GET  /v1/anime/bulk?ids=1,2,3             Up to 500 items in ONE request
GET  /v1/anime/top?by=score|popularity    Top lists
GET  /v1/anime/trending                   Trending (live, always current)
GET  /v1/anime/season/:year/:season       winter|spring|summer|fall
GET  /v1/anime/:id                        Detail (mirror-first)
GET  /v1/anime/:id/characters             Cast with roles
GET  /v1/anime/:id/relations              Franchise graph (prequels, spin-offs)
GET  /v1/anime/:id/recommendations        "If you liked this"
POST /v1/sync/anime | /v1/sync/manga      Start/continue bulk mirror
GET  /v1/sync/status                      Mirror progress
GET  /v1/manga/search?q= | /v1/manga/top  | /v1/manga/:id
GET  /v1/character/:id                    Character detail
GET  /v1/kitsu/anime/:id                  Direct Kitsu lookup
GET  /health                              Health + cache + mirror stats

No rate limit is ever applied to your clients. Attribution is mandatory and
automatic: X-Data-Providers / X-Attribution on every response.
License: MIT (code). Data belongs to AniList / Kitsu / rights holders.
`;
}
