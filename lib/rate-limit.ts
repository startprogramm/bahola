type RateLimitBucket = {
  count: number;
  resetAt: number;
};

declare global {
  var __rateLimitBuckets: Map<string, RateLimitBucket> | undefined;
}

const bucketStore = globalThis.__rateLimitBuckets ?? new Map<string, RateLimitBucket>();
if (!globalThis.__rateLimitBuckets) {
  globalThis.__rateLimitBuckets = bucketStore;
}

const MAX_BUCKETS = 20_000;

function cleanupExpiredBuckets(now: number) {
  if (bucketStore.size < MAX_BUCKETS) return;

  for (const [key, bucket] of bucketStore.entries()) {
    if (bucket.resetAt <= now) {
      bucketStore.delete(key);
    }
    if (bucketStore.size <= MAX_BUCKETS * 0.8) {
      break;
    }
  }
}

export type RateLimitResult = {
  limited: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const parsedLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
  const parsedWindowMs = Number.isFinite(windowMs) ? Math.floor(windowMs) : 60_000;
  const safeLimit = Math.max(1, parsedLimit);
  const safeWindowMs = Math.max(1_000, parsedWindowMs);
  cleanupExpiredBuckets(now);

  const existing = bucketStore.get(key);
  const bucket =
    !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + safeWindowMs }
      : existing;

  bucket.count += 1;
  bucketStore.set(key, bucket);

  const limited = bucket.count > safeLimit;
  const remaining = Math.max(0, safeLimit - bucket.count);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.resetAt - now) / 1000)
  );

  return { limited, remaining, retryAfterSeconds };
}
