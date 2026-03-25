import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

// ── Cache for isDirectorOfSchool (saves ~300-500ms per call after first hit) ──
const directorCheckCache = new Map<string, { result: boolean; ts: number }>();
const DIRECTOR_CHECK_TTL = 30_000; // 30s

/**
 * Checks if a user is a DIRECTOR of the given school.
 * Results cached in-memory for 30s.
 */
export async function isDirectorOfSchool(userId: string, schoolId: string | null): Promise<boolean> {
  if (!schoolId) return false;

  const cacheKey = `${userId}:${schoolId}`;
  const cached = directorCheckCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < DIRECTOR_CHECK_TTL) {
    return cached.result;
  }

  const membership = await prisma.schoolMembership.findFirst({
    where: { userId, schoolId, role: "DIRECTOR", status: "active" },
    select: { id: true },
  });
  const result = !!membership;

  directorCheckCache.set(cacheKey, { result, ts: Date.now() });

  if (directorCheckCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of directorCheckCache) {
      if (now - v.ts > DIRECTOR_CHECK_TTL) directorCheckCache.delete(k);
    }
  }

  return result;
}

// ── In-memory auth cache (saves ~2s per API call on high-latency DB) ──
interface AuthCacheEntry {
  session: NonNullable<Awaited<ReturnType<typeof getAuthSession>>>;
  school: NonNullable<Awaited<ReturnType<typeof prisma.school.findUnique>>>;
  userId: string;
  ts: number;
}
const authCache = new Map<string, AuthCacheEntry>();
const AUTH_CACHE_TTL = 30_000; // 30s

/**
 * Verifies the current user is a DIRECTOR and returns their school.
 * Results are cached in-memory for 30s to avoid repeated DB round-trips
 * (each round-trip costs ~1s due to DB geo-latency).
 */
export async function requireDirector() {
  const session = await getAuthSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const uid = session.user.id;
  const cached = authCache.get(uid);
  if (cached && Date.now() - cached.ts < AUTH_CACHE_TTL) {
    return { session: cached.session, school: cached.school, userId: cached.userId };
  }

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, role: true, schoolId: true },
  });

  if (!user || user.role !== "DIRECTOR") {
    return { error: NextResponse.json({ error: "Forbidden: Director role required" }, { status: 403 }) };
  }

  if (!user.schoolId) {
    return { error: NextResponse.json({ error: "No school assigned" }, { status: 404 }) };
  }

  const school = await prisma.school.findUnique({
    where: { id: user.schoolId },
  });

  if (!school || !school.isActive) {
    return { error: NextResponse.json({ error: "School not found" }, { status: 404 }) };
  }

  authCache.set(uid, { session, school, userId: user.id, ts: Date.now() });

  // Evict stale entries periodically
  if (authCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of authCache) {
      if (now - v.ts > AUTH_CACHE_TTL) authCache.delete(k);
    }
  }

  return { session, school, userId: user.id };
}

/**
 * Invalidate the in-memory auth cache for a specific user (or all users).
 * Call this after mutations that change school data (name, etc.) so that
 * subsequent API calls re-read from the database.
 */
export function invalidateDirectorAuthCache(userId?: string) {
  if (userId) {
    authCache.delete(userId);
  } else {
    authCache.clear();
  }
}
