/**
 * In-memory server-side cache for director API routes.
 *
 * Persisted on globalThis to survive Next.js dev hot-reloads.
 * Max 500 entries with FIFO eviction. In-flight request dedup
 * prevents thundering-herd on concurrent identical requests.
 */

interface CacheEntry<T = unknown> {
  data: T;
  ts: number;
  ttl: number;
}

const MAX_ENTRIES = 500;

// Survive Next.js dev hot-reload
const g = globalThis as typeof globalThis & {
  __directorCache?: Map<string, CacheEntry>;
  __directorInflight?: Map<string, Promise<unknown>>;
};

if (!g.__directorCache) g.__directorCache = new Map();
if (!g.__directorInflight) g.__directorInflight = new Map();

const cache = g.__directorCache;
const inflight = g.__directorInflight;

/**
 * Execute `fn` with caching. Returns cached data if within TTL,
 * deduplicates concurrent identical requests, and stores result.
 */
export async function cached<T>(key: string, fn: () => Promise<T>, ttlMs: number): Promise<T> {
  // Check cache
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < entry.ttl) {
    return entry.data as T;
  }

  // Deduplicate in-flight requests
  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = fn().then((data) => {
    // Evict if at capacity (FIFO: delete oldest entries)
    if (cache.size >= MAX_ENTRIES) {
      const keysIter = cache.keys();
      const toDelete = cache.size - MAX_ENTRIES + 1;
      for (let i = 0; i < toDelete; i++) {
        const oldest = keysIter.next().value;
        if (oldest) cache.delete(oldest);
      }
    }
    cache.set(key, { data, ts: Date.now(), ttl: ttlMs });
    inflight.delete(key);
    return data;
  }).catch((err) => {
    inflight.delete(key);
    throw err;
  });

  inflight.set(key, promise);
  return promise;
}

/** Returns true if `key` is currently a cache hit (not expired). */
export function isCacheHit(key: string): boolean {
  const entry = cache.get(key);
  return !!entry && Date.now() - entry.ts < entry.ttl;
}

/** Invalidate all cache entries whose key starts with `prefix`. */
export function invalidateByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Invalidate a single cache entry. */
export function invalidateKey(key: string): void {
  cache.delete(key);
}
