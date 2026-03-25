/**
 * Shared subscription data hook with request deduplication.
 * Multiple components can call useSubscriptionData() and only ONE
 * network request is made. Results are cached via cachedFetch (5min TTL + ETag).
 */

import { useEffect, useState } from "react";
import { cachedFetch, invalidateCache } from "@/lib/fetch-cache";

const SUBSCRIPTION_URL = "/api/subscription";
const listeners = new Set<(data: any) => void>();
let latestData: any = null;

/** Invalidate the cache (call after credit changes, purchases, etc.) */
export function invalidateSubscriptionCache() {
  invalidateCache(SUBSCRIPTION_URL);
  latestData = null;
}

export function useSubscriptionData() {
  const [data, setData] = useState<any>(latestData);
  const [loading, setLoading] = useState(!latestData);

  useEffect(() => {
    const update = (d: any) => setData(d);
    listeners.add(update);

    cachedFetch(SUBSCRIPTION_URL)
      .then((d) => {
        latestData = d;
        setData(d);
        setLoading(false);
        // Notify other consumers
        for (const fn of listeners) fn(d);
      })
      .catch(() => setLoading(false));

    return () => {
      listeners.delete(update);
    };
  }, []);

  return { data, loading };
}
