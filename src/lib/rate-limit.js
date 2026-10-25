/**
 * Tiny semaphore used to cap concurrent in-flight requests per provider,
 * so we stay well under each provider's published rate limits.
 */
export class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
  }

  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with retry + exponential backoff. Honors Retry-After on 429/5xx
 * so we never hammer a provider that tells us to slow down.
 */
export async function fetchWithRetry(url, options = {}, { retries = 4, baseDelay = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '0') * 1000;
        const delay = retryAfter || baseDelay * 2 ** attempt;
        if (attempt < retries) {
          await sleep(delay);
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(baseDelay * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError ?? new Error('fetch failed');
}
