/**
 * LRU + TTL in-memory cache, zero external dependencies.
 * Only factual metadata and short-TTL provider responses are cached.
 * See docs/COPYRIGHT-SAFE.md for the full reasoning.
 */
export class MemoryCache {
  constructor({ ttl = 600_000, maxItems = 5000 } = {}) {
    this.ttl = ttl;
    this.maxItems = maxItems;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expires) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key, value, ttl = this.ttl) {
    if (this.map.size >= this.maxItems) {
      this.map.delete(this.map.keys().next().value);
    }
    this.map.set(key, { value, expires: Date.now() + ttl });
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}

export const cache = new MemoryCache({
  ttl: Number(process.env.CACHE_TTL ?? 600) * 1000,
  maxItems: Number(process.env.CACHE_MAX_ITEMS ?? 5000),
});
