"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface UseCachedFetchOptions {
  staleTime?: number; // ms before data is considered stale (default 5 min)
  enabled?: boolean;  // whether to fetch (default true)
  keepPreviousData?: boolean; // keep showing old data while new URL loads
}

interface UseCachedFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function getSessionScope() {
  if (typeof document === "undefined") return "server";

  const cookieNames = [
    "__Secure-next-auth.session-token",
    "next-auth.session-token",
    "__Secure-authjs.session-token",
    "authjs.session-token",
  ];

  for (const name of cookieNames) {
    const prefix = `${name}=`;
    const match = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(prefix));
    if (match) {
      const value = match.slice(prefix.length);
      if (value) return value;
    }
  }

  return "anon";
}

// Global in-memory cache shared across all hook instances
const cache = new Map<string, CacheEntry<any>>();
// Dedup in-flight requests
const inflight = new Map<string, Promise<any>>();
// Subscribers: url -> Set of refetch callbacks (so invalidateCache can trigger refetches)
const subscribers = new Map<string, Set<() => void>>();

// Read cache synchronously (used by useState initializers to avoid skeleton flash)
function readCache<T>(url: string | null, enabled: boolean): { data: T | null; loading: boolean } {
  if (!url || !enabled) return { data: null, loading: false };
  const entry = cache.get(url);
  if (entry) return { data: entry.data as T, loading: false };
  return { data: null, loading: true };
}

export function useCachedFetch<T = any>(
  url: string | null,
  options?: UseCachedFetchOptions
): UseCachedFetchResult<T> {
  const { staleTime = 300_000, enabled = true, keepPreviousData = false } = options || {};
  const cacheKey = url ? `${url}::${getSessionScope()}` : null;

  // Initialize from cache synchronously — no skeleton flash for cached data
  const [data, setData] = useState<T | null>(() => readCache<T>(cacheKey, enabled).data);
  const [loading, setLoading] = useState<boolean>(() => readCache<T>(cacheKey, enabled).loading);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const doFetch = useCallback(
    async (isBackground: boolean) => {
      if (!url || !cacheKey) return;
      if (!isBackground) setLoading(true);
      setError(null);

      try {
        // Deduplicate concurrent requests to the same URL
        let promise = inflight.get(cacheKey);
        if (!promise) {
          const t0 = performance.now();
          promise = fetch(url, {
            cache: "no-store",
            credentials: "same-origin",
          }).then(async (r) => {
            if (!r.ok) {
              let detail = "";
              try {
                const contentType = r.headers.get("content-type") || "";
                if (contentType.includes("application/json")) {
                  const body = await r.json() as { error?: unknown; message?: unknown };
                  if (typeof body.error === "string") detail = body.error;
                  else if (typeof body.message === "string") detail = body.message;
                } else {
                  const text = (await r.text()).trim();
                  if (text) detail = text.slice(0, 120);
                }
              } catch {
                // Ignore response parsing errors and keep status-only message.
              }
              const shortUrl = url.length > 120 ? `${url.slice(0, 117)}...` : url;
              throw new Error(
                detail
                  ? `HTTP ${r.status} (${detail}) ${shortUrl}`
                  : `HTTP ${r.status} ${shortUrl}`
              );
            }
            const json = await r.json();
            const ms = Math.round(performance.now() - t0);
            const shortUrl = url.replace(/\?.*/, url.includes("?") ? "?" + url.split("?")[1].slice(0, 60) : "");
            console.log(`[fetch] ${ms}ms ${shortUrl}`);
            return json;
          });
          inflight.set(cacheKey, promise);
          promise.then(
            () => inflight.delete(cacheKey),
            () => inflight.delete(cacheKey)
          );
        }

        const result = await promise;
        cache.set(cacheKey, { data: result, timestamp: Date.now() });
        if (mountedRef.current) {
          setData(result);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Fetch failed");
          setLoading(false);
        }
      }
    },
    [cacheKey, url]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Subscribe to cache invalidations so other components calling
  // invalidateCache() can trigger a refetch in this hook instance.
  useEffect(() => {
    if (!cacheKey || !enabled) return;
    const set = subscribers.get(cacheKey) || new Set();
    const handler = () => {
      if (mountedRef.current) doFetch(false);
    };
    set.add(handler);
    subscribers.set(cacheKey, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) subscribers.delete(cacheKey);
    };
  }, [cacheKey, enabled, doFetch]);

  useEffect(() => {
    if (!cacheKey || !enabled) {
      setLoading(false);
      return;
    }

    const cached = cache.get(cacheKey);
    if (cached) {
      setData(cached.data);
      const age = Date.now() - cached.timestamp;
      if (age > staleTime) {
        // Stale — return cached data instantly, revalidate in background
        setLoading(false);
        doFetch(true);
      } else {
        setLoading(false);
      }
    } else {
      // URL changed and no cache — need to fetch
      if (!keepPreviousData) setData(null);
      doFetch(false);
    }
  }, [cacheKey, enabled, staleTime, doFetch, keepPreviousData]);

  const refetch = useCallback(() => {
    if (cacheKey) {
      cache.delete(cacheKey);
      doFetch(false);
    }
  }, [cacheKey, doFetch]);

  return { data, loading, error, refetch };
}

/** Invalidate cache entries matching a URL prefix and notify active hooks to refetch */
export function invalidateCache(urlPrefix?: string) {
  const affectedUrls: string[] = [];
  if (!urlPrefix) {
    affectedUrls.push(...cache.keys());
    cache.clear();
  } else {
    for (const key of cache.keys()) {
      if (key.startsWith(urlPrefix)) {
        cache.delete(key);
        affectedUrls.push(key);
      }
    }
  }
  // Notify all active useCachedFetch hooks watching invalidated URLs
  for (const url of affectedUrls) {
    const set = subscribers.get(url);
    if (set) {
      for (const handler of set) handler();
    }
  }
}
