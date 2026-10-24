import { config } from '../config.js';
import { Semaphore, fetchWithRetry } from '../lib/rate-limit.js';

const sem = new Semaphore(config.providers.kitsu.concurrency);

/**
 * Kitsu provider (JSON:API /edge).
 * Open API, no key required. Provides per-language titles
 * (en, en_jp, ja_jp, en_us, ...) which powers our multilingual output.
 * https://kitsu.docs.apiary.io
 */
export async function kitsuGet(path, params = {}) {
  return sem.run(async () => {
    const url = new URL(config.providers.kitsu.url + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetchWithRetry(url, {
      headers: {
        Accept: 'application/vnd.api+json',
        'User-Agent': 'AniCore-API/1.0 (open-source metadata aggregator)',
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(json?.errors?.[0]?.detail ?? `Kitsu request failed (${res.status})`);
      e.status = res.status;
      throw e;
    }
    return json;
  });
}

export async function kitsuAnimeById(id) {
  const json = await kitsuGet(`/anime/${id}`);
  return json.data ?? null;
}

export async function kitsuSearch(kind, text, { limit = 10 } = {}) {
  const json = await kitsuGet(`/${kind}`, {
    'filter[text]': text,
    'page[limit]': limit,
  });
  return json.data ?? [];
}
