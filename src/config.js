export const config = {
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  env: process.env.NODE_ENV ?? 'development',
  corsOrigin: (process.env.CORS_ORIGIN ?? '*').split(',').map((s) => s.trim()),
  cache: {
    ttl: Number(process.env.CACHE_TTL ?? 600) * 1000,
    maxItems: Number(process.env.CACHE_MAX_ITEMS ?? 5000),
  },
  providers: {
    anilist: {
      url: 'https://graphql.anilist.co',
      concurrency: Number(process.env.ANILIST_CONCURRENCY ?? 3),
    },
    kitsu: {
      url: 'https://kitsu.io/api/edge',
      concurrency: Number(process.env.KITSU_CONCURRENCY ?? 5),
    },
  },
};

// Preferred display languages. Titles/descriptions are returned per-language
// where the upstream provider offers them.
export const SUPPORTED_LANGUAGES = [
  'tr', // Türkçe
  'en', // English
  'ja', // 日本語
  'es', 'fr', 'de', 'it', 'pt', 'ru', 'ko', 'zh', 'ar', 'hi', 'id',
];
