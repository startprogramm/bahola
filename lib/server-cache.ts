/**
 * Server-side in-memory caches for frequently accessed API data.
 * Reduces Supabase DB round-trips (300-500ms each from Uzbekistan to Mumbai).
 */

// Subscription cache: userId -> { payload, timestamp }
const subCache = new Map<string, { payload: any; timestamp: number }>();
const SUB_CACHE_TTL = 120_000; // 2 minutes (mutations invalidate immediately)

export function getSubscriptionCache(userId: string) {
  const entry = subCache.get(userId);
  if (entry && Date.now() - entry.timestamp < SUB_CACHE_TTL) return entry.payload;
  return null;
}

export function setSubscriptionCache(userId: string, payload: any) {
  subCache.set(userId, { payload, timestamp: Date.now() });
}

export function invalidateSubscriptionServerCache(userId?: string) {
  if (userId) subCache.delete(userId);
  else subCache.clear();
}

// School cache: userId -> { data, timestamp }
const schoolCache = new Map<string, { data: any; timestamp: number }>();
const SCHOOL_CACHE_TTL = 120_000; // 2 minutes (mutations invalidate immediately)

export function getSchoolCache(userId: string) {
  const entry = schoolCache.get(userId);
  if (entry && Date.now() - entry.timestamp < SCHOOL_CACHE_TTL) return entry.data;
  return null;
}

export function setSchoolCache(userId: string, data: any) {
  schoolCache.set(userId, { data, timestamp: Date.now() });
}

export function invalidateSchoolServerCache(userId?: string) {
  if (userId) schoolCache.delete(userId);
  else schoolCache.clear();
}

// General-purpose cache with TTL and in-flight dedup
const generalCache = new Map<string, { data: any; ts: number; ttl: number }>();
const generalInflight = new Map<string, Promise<any>>();
const GENERAL_MAX_ENTRIES = 500;

export async function cached<T>(key: string, fn: () => Promise<T>, ttlMs: number): Promise<T> {
  const entry = generalCache.get(key);
  if (entry && Date.now() - entry.ts < entry.ttl) {
    return entry.data as T;
  }

  const pending = generalInflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fn().then((data) => {
    if (generalCache.size >= GENERAL_MAX_ENTRIES) {
      const oldest = generalCache.keys().next().value;
      if (oldest) generalCache.delete(oldest);
    }
    generalCache.set(key, { data, ts: Date.now(), ttl: ttlMs });
    generalInflight.delete(key);
    return data;
  }).catch((err) => {
    generalInflight.delete(key);
    throw err;
  });

  generalInflight.set(key, promise);
  return promise;
}

export function invalidateGeneralCache(prefix?: string) {
  if (!prefix) {
    generalCache.clear();
  } else {
    for (const key of generalCache.keys()) {
      if (key.startsWith(prefix)) generalCache.delete(key);
    }
  }
}

/** Invalidate all server-cached class detail entries for a given classId */
export function invalidateClassDetailCache(classId: string) {
  invalidateGeneralCache(`classDetail:${classId}:`);
}

/** Invalidate all server-cached assessment insights entries for a given assessmentId */
export function invalidateAssessmentInsightsCache(assessmentId: string) {
  invalidateGeneralCache(`assessment:${assessmentId}:`);
}
