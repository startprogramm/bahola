import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";
import { cached, isCacheHit } from "@/lib/director/server-cache";

/**
 * GET /api/director/performance
 * Monthly avg score grouped by grade + subclass + subject.
 * Uses a single SQL GROUP BY query instead of loading all submissions.
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;
  const schoolId = school.id;

  const gradeFilter = req.nextUrl.searchParams.get("grade");
  const gradeNum = gradeFilter ? parseInt(gradeFilter) : null;
  const fromParam = req.nextUrl.searchParams.get("from"); // "YYYY-MM"
  const toParam   = req.nextUrl.searchParams.get("to");   // "YYYY-MM"

  const fromDate = fromParam ? new Date(fromParam + "-01T00:00:00.000Z") : null;
  const toDate = (() => {
    if (!toParam) return null;
    const d = new Date(toParam + "-01T00:00:00.000Z");
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d;
  })();

  const dateFromFilter = fromDate ? Prisma.sql`AND COALESCE(s."gradedAt", s."createdAt") >= ${fromDate}` : Prisma.sql``;
  const dateToFilter   = toDate   ? Prisma.sql`AND COALESCE(s."gradedAt", s."createdAt") <  ${toDate}`   : Prisma.sql``;

  const cacheKey = `director:perf:${schoolId}:${gradeFilter || ""}:${fromParam || ""}:${toParam || ""}`;

  type PerfRow = {
    grade: string;
    thread: string;
    subject: string;
    month: string;
    avg_score: number;
    cnt: number;
  };

  const rows = await cached(cacheKey, () => prisma.$queryRaw<PerfRow[]>`
    SELECT
      m.grade,
      m.subclass                                                          AS thread,
      COALESCE(c.subject, 'Boshqa')                                      AS subject,
      TO_CHAR(COALESCE(s."gradedAt", s."createdAt"), 'YYYY-MM')          AS month,
      ROUND(AVG(s.score::float / s."maxScore" * 100)::numeric, 1)::float AS avg_score,
      COUNT(*)::int                                                       AS cnt
    FROM submissions s
    JOIN assessments a  ON a.id         = s."assessmentId"
    JOIN classes c      ON c.id         = a."classId"
    JOIN school_memberships m
                        ON m."userId"   = s."studentId"
                       AND m."schoolId" = c."schoolId"
    WHERE c."schoolId" = ${schoolId}
      AND c.archived   = false
      AND s.status     = 'GRADED'
      AND s.score      IS NOT NULL
      AND s."maxScore" > 0
      AND m.role       = 'STUDENT'
      AND m.grade      IS NOT NULL
      AND m.subclass   IS NOT NULL
      ${dateFromFilter}
      ${dateToFilter}
    GROUP BY m.grade, m.subclass, c.subject,
             TO_CHAR(COALESCE(s."gradedAt", s."createdAt"), 'YYYY-MM')
    ORDER BY month, m.grade, m.subclass, c.subject
  `, 5 * 60_000); // 5 min TTL

  // Group into series (grade-thread-subject) with monthly data
  const threadMap = new Map<
    string,
    { grade: number; thread: string; subject: string; monthly: Map<string, { sum: number; count: number }> }
  >();
  const allMonths = new Set<string>();

  for (const row of rows) {
    const grade = parseInt(row.grade);
    if (isNaN(grade)) continue;
    // Apply grade filter in JS
    if (gradeNum !== null && grade !== gradeNum) continue;

    const key = `${grade}-${row.thread}-${row.subject}`;
    if (!threadMap.has(key)) {
      threadMap.set(key, { grade, thread: row.thread, subject: row.subject, monthly: new Map() });
    }
    threadMap.get(key)!.monthly.set(row.month, { sum: row.avg_score * row.cnt, count: row.cnt });
    allMonths.add(row.month);
  }

  const sortedMonths = Array.from(allMonths).sort();

  const series = Array.from(threadMap.entries()).map(([key, t]) => ({
    key,
    label: `${t.grade}${t.thread} - ${t.subject}`,
    grade: t.grade,
    thread: t.thread,
    subject: t.subject,
    data: sortedMonths.map((month) => {
      const m = t.monthly.get(month);
      return {
        month,
        avgScore: m ? Math.round((m.sum / m.count) * 10) / 10 : null,
        count: m ? m.count : 0,
      };
    }),
  }));

  series.sort((a, b) => a.grade - b.grade || a.thread.localeCompare(b.thread) || a.subject.localeCompare(b.subject));

  const availableGrades = Array.from(new Set(series.map((s) => s.grade))).sort((a, b) => a - b);

  const response = NextResponse.json({ series, months: sortedMonths, availableGrades });
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
  return response;
}
