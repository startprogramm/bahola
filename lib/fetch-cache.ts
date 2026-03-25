/**
 * Global client-side GET request cache with deduplication and ETag support.
 *
 * - Caches GET responses in memory for a configurable TTL (default 5 min).
 * - Deduplicates concurrent requests to the same URL.
 * - stale-while-revalidate: returns stale data instantly, refreshes in background.
 * - ETag support: sends If-None-Match on revalidation, handles 304 Not Modified.
 * - Auto-clears on hard refresh (browser reload / first navigation).
 * - Call `invalidateCache(url)` or `invalidateCachePrefix(prefix)` after mutations.
 */

interface CacheEntry {
  data: any;
  timestamp: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<any>>();
const DEFAULT_TTL = 1_800_000; // 30 minutes — mutations invalidate on change
const STALE_TTL = 3_600_000; // serve stale for up to 1 hour while revalidating

// Clear cache on hard refresh (browser reload) or first page navigation.
// Deferred to avoid issues with module-level side effects during SSR.
let _hardRefreshChecked = false;
function checkHardRefresh() {
  if (_hardRefreshChecked) return;
  _hardRefreshChecked = true;
  if (typeof window === "undefined") return;
  try {
    const SESSION_KEY = "fetch-cache-session";
    const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const navType = navEntries[0]?.type;
    const isHardRefresh = navType === "reload";
    const isFirstNav = !sessionStorage.getItem(SESSION_KEY);

    if (isHardRefresh || isFirstNav) {
      cache.clear();
    }
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Ignore errors in restricted environments
  }
}

/**
 * Cached fetch for GET requests. Returns cached data immediately if fresh,
 * or stale data + background revalidation if within STALE_TTL.
 * Supports ETag-based conditional requests for bandwidth savings.
 */
export async function cachedFetch(url: string, ttl = DEFAULT_TTL): Promise<any> {
  checkHardRefresh();
  const entry = cache.get(url);
  const now = Date.now();

  // Fresh cache — return immediately
  if (entry && now - entry.timestamp < ttl) {
    return entry.data;
  }

  // Stale cache — return stale data AND revalidate in background
  if (entry && now - entry.timestamp < STALE_TTL) {
    // Fire background revalidation (no await)
    if (!inflight.has(url)) {
      doFetch(url).catch(() => {});
    }
    return entry.data;
  }

  // No cache or too stale — fetch and wait
  return doFetch(url);
}

async function doFetch(url: string): Promise<any> {
  // Deduplicate concurrent requests
  const existing = inflight.get(url);
  if (existing) return existing;

  const entry = cache.get(url);
  const headers: Record<string, string> = {};

  // Send ETag for conditional request — server can return 304 Not Modified
  if (entry?.etag) {
    headers["If-None-Match"] = entry.etag;
  }

  const promise = fetch(url, {
    headers,
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (res) => {
      // 304 Not Modified — data unchanged, refresh cache timestamp
      if (res.status === 304 && entry) {
        cache.set(url, { ...entry, timestamp: Date.now() });
        return entry.data;
      }

      if (!res.ok) return null;

      const data = await res.json();
      const etag = res.headers.get("ETag") || undefined;
      cache.set(url, { data, timestamp: Date.now(), etag });
      return data;
    })
    .catch(() => {
      // On error, return stale data if available
      return cache.get(url)?.data ?? null;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, promise);
  return promise;
}

/** Invalidate a specific URL cache entry */
export function invalidateCache(url: string) {
  cache.delete(url);
}

/** Invalidate all cache entries whose URL starts with the given prefix */
export function invalidateCachePrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/** Invalidate the entire cache */
export function invalidateAllCache() {
  cache.clear();
}

/** Prefetch a URL into cache in the background (fire-and-forget) */
export function prefetch(url: string) {
  checkHardRefresh();
  const entry = cache.get(url);
  // Skip if already fresh in cache or already inflight
  if ((entry && Date.now() - entry.timestamp < DEFAULT_TTL) || inflight.has(url)) return;
  doFetch(url).catch(() => {});
}

/**
 * Dispatch a global event to notify components that class-related data changed.
 * Components (sidebar, classes page) listen for this to refresh their data.
 */
export function notifyClassesChanged() {
  invalidateCachePrefix("/api/classes");
  invalidateCachePrefix("/api/student/classes");
  invalidateCachePrefix("/api/sidebar/classes");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("classes-changed"));
  }
}
