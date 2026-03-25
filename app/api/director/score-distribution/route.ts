import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";
import { cached, isCacheHit } from "@/lib/director/server-cache";

/**
 * GET /api/director/score-distribution
 *
 * All modes use SQL GROUP BY to count submissions per 10-point bucket —
 * no raw row loading regardless of school size.
 *
 * Params:
 *   selections — JSON [{grade, subclasses[]}]  → multi-series (ExploreTab)
 *   subclass   — "A,B,C"                       → grouped by subclass (class detail)
 *   classId    — single class filter
 *   grade      — name prefix filter ("8" → "8A", "8B", …)
 *   subject    — subject filter
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;
  const schoolId = school.id;

  const selectionsParam = req.nextUrl.searchParams.get("selections");
  const subjectParam    = req.nextUrl.searchParams.get("subject");
  const classId         = req.nextUrl.searchParams.get("classId");
  const subclassParam   = req.nextUrl.searchParams.get("subclass");
  const gradeParam      = req.nextUrl.searchParams.get("grade");
  const perGradeParam   = req.nextUrl.searchParams.get("perGrade");
  const fromParam       = req.nextUrl.searchParams.get("from"); // "YYYY-MM"
  const toParam         = req.nextUrl.searchParams.get("to");   // "YYYY-MM"

  // Date range: "YYYY-MM" → start of that month (from) / start of next month (to, exclusive)
  const fromDate = fromParam ? new Date(fromParam + "-01T00:00:00.000Z") : null;
  const toDate = (() => {
    if (!toParam) return null;
    const d = new Date(toParam + "-01T00:00:00.000Z");
    d.setUTCMonth(d.getUTCMonth() + 1); // exclusive: start of month after toParam
    return d;
  })();

  // Reusable optional SQL fragments
  const classFilter   = classId     ? Prisma.sql`AND c.id      = ${classId}`                    : Prisma.sql``;
  const gradeFilter   = gradeParam  ? Prisma.sql`AND c.name LIKE ${gradeParam + "%"}`            : Prisma.sql``;
  const subjectFilter = subjectParam ? Prisma.sql`AND c.subject = ${subjectParam}`               : Prisma.sql``;
  const dateFromFilter = fromDate ? Prisma.sql`AND COALESCE(s."gradedAt", s."createdAt") >= ${fromDate}` : Prisma.sql``;
  const dateToFilter   = toDate   ? Prisma.sql`AND COALESCE(s."gradedAt", s."createdAt") <  ${toDate}`   : Prisma.sql``;

  // Cache key includes all params
  const subjectsParam2 = req.nextUrl.searchParams.get("subjects") || "";
  const cacheKey = `director:score-dist:${schoolId}:${perGradeParam || ""}:${selectionsParam || ""}:${subjectParam || ""}:${classId || ""}:${subclassParam || ""}:${gradeParam || ""}:${fromParam || ""}:${toParam || ""}:${subjectsParam2}`;

  // Helper: build empty bucket array
  const makeBuckets = () =>
    Array.from({ length: 10 }, (_, i) => ({
      label: `${i * 10}-${(i + 1) * 10}%`,
      min: i * 10,
      max: (i + 1) * 10,
      count: 0,
    }));

  // Helper: fill bucket array from SQL rows
  type BucketRow = { bucket: number; count: number };
  function fillBuckets(rows: BucketRow[]) {
    const b = makeBuckets();
    for (const r of rows) {
      if (r.bucket >= 0 && r.bucket < 10) b[r.bucket].count = r.count;
    }
    return b;
  }

  const data = await cached(cacheKey, async () => {
    // ── 0. Per-grade mode: server discovers all grades, returns one series each ─
    if (perGradeParam === "1") {
      type GradeBucketRow = { grade: string; bucket: number; count: number };
      const rows = await prisma.$queryRaw<GradeBucketRow[]>`
        SELECT
          m.grade,
          LEAST(FLOOR(s.score::float / s."maxScore" * 10), 9)::int AS bucket,
          COUNT(*)::int                                              AS count
        FROM submissions s
        JOIN assessments a  ON a.id         = s."assessmentId"
        JOIN classes c      ON c.id         = a."classId"
        JOIN school_memberships m
                            ON m."userId"   = s."studentId"
                           AND m."schoolId" = c."schoolId"
        WHERE c."schoolId" = ${schoolId}
          AND s.status     = 'GRADED'
          AND s."maxScore" > 0
          AND m.role       = 'STUDENT'
          AND m.grade      IS NOT NULL
          ${dateFromFilter}
          ${dateToFilter}
        GROUP BY m.grade, bucket
        ORDER BY m.grade, bucket
      `;

      const gradesSet = new Map<string, ReturnType<typeof makeBuckets>>();
      for (const r of rows) {
        if (!gradesSet.has(r.grade)) gradesSet.set(r.grade, makeBuckets());
        const b = gradesSet.get(r.grade)!;
        if (r.bucket >= 0 && r.bucket < 10) b[r.bucket].count += r.count;
      }
      const series = Array.from(gradesSet.entries())
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([grade, buckets]) => ({ label: `${grade}-sinf`, buckets }));
      return { series };
    }

    // ── 1. Multi-series mode (ExploreTab grade/subclass selections) ────────────
    if (selectionsParam) {
      let selections: { grade: string; subclasses: string[] }[];
      try {
        selections = JSON.parse(selectionsParam);
      } catch {
        return { __error: true, status: 400, body: { error: "Invalid selections JSON" } } as const;
      }
      if (selections.length === 0) {
        return { series: [] };
      }

      const grades = [...new Set(selections.map((s) => s.grade))];

      // Multi-subject split mode: when caller passes &subjects=A,B
      const subjectsParam = req.nextUrl.searchParams.get("subjects");
      const subjectsList = subjectsParam ? subjectsParam.split(",").map((s) => s.trim()).filter(Boolean) : null;
      const needsSubjectSplit = subjectsList && subjectsList.length > 1;

      if (needsSubjectSplit) {
        const hasSubclasses = selections.some((sel) => sel.subclasses.length > 0);

        if (hasSubclasses) {
          type GSSubBucketRow = { grade: string; subclass: string; subject: string; bucket: number; count: number };
          const rows = await prisma.$queryRaw<GSSubBucketRow[]>`
            SELECT
              m.grade,
              m.subclass,
              COALESCE(c.subject, 'Boshqa')                              AS subject,
              LEAST(FLOOR(s.score::float / s."maxScore" * 10), 9)::int  AS bucket,
              COUNT(*)::int                                              AS count
            FROM submissions s
            JOIN assessments a  ON a.id         = s."assessmentId"
            JOIN classes c      ON c.id         = a."classId"
            JOIN school_memberships m
                                ON m."userId"   = s."studentId"
                               AND m."schoolId" = c."schoolId"
            WHERE c."schoolId" = ${schoolId}
              AND s.status     = 'GRADED'
              AND s."maxScore" > 0
              AND m.role       = 'STUDENT'
              AND m.grade      IN (${Prisma.join(grades)})
              AND m.subclass   IS NOT NULL
              AND c.subject    IN (${Prisma.join(subjectsList!)})
              ${dateFromFilter}
              ${dateToFilter}
            GROUP BY m.grade, m.subclass, c.subject, bucket
            ORDER BY m.grade, m.subclass, c.subject, bucket
          `;

          const series: { label: string; buckets: ReturnType<typeof makeBuckets> }[] = [];
          for (const sel of selections) {
            for (const sc of sel.subclasses) {
              for (const subj of subjectsList!) {
                const scRows = rows.filter((r) => r.grade === sel.grade && r.subclass === sc && r.subject === subj);
                const buckets = makeBuckets();
                for (const r of scRows) {
                  if (r.bucket >= 0 && r.bucket < 10) buckets[r.bucket].count = r.count;
                }
                series.push({ label: `${sel.grade}${sc} — ${subj}`, buckets });
              }
            }
          }
          return { series };
        } else {
          type GradeSubjectBucketRow = { grade: string; subject: string; bucket: number; count: number };
          const rows = await prisma.$queryRaw<GradeSubjectBucketRow[]>`
            SELECT
              m.grade,
              COALESCE(c.subject, 'Boshqa')                              AS subject,
              LEAST(FLOOR(s.score::float / s."maxScore" * 10), 9)::int  AS bucket,
              COUNT(*)::int                                              AS count
            FROM submissions s
            JOIN assessments a  ON a.id         = s."assessmentId"
            JOIN classes c      ON c.id         = a."classId"
            JOIN school_memberships m
                                ON m."userId"   = s."studentId"
                               AND m."schoolId" = c."schoolId"
            WHERE c."schoolId" = ${schoolId}
              AND s.status     = 'GRADED'
              AND s."maxScore" > 0
              AND m.role       = 'STUDENT'
              AND m.grade      IN (${Prisma.join(grades)})
              AND c.subject    IN (${Prisma.join(subjectsList!)})
              ${dateFromFilter}
              ${dateToFilter}
            GROUP BY m.grade, c.subject, bucket
            ORDER BY m.grade, c.subject, bucket
          `;

          const series: { label: string; buckets: ReturnType<typeof makeBuckets> }[] = [];
          for (const subj of subjectsList!) {
            const buckets = makeBuckets();
            const subjRows = rows.filter((r) => r.subject === subj);
            for (const r of subjRows) {
              if (r.bucket >= 0 && r.bucket < 10) buckets[r.bucket].count += r.count;
            }
            series.push({ label: subj, buckets });
          }
          return { series };
        }
      }

      // One SQL query: bucket counts grouped by grade + subclass
      type GradeSubclassBucketRow = { grade: string; subclass: string; bucket: number; count: number };
      const rows = await prisma.$queryRaw<GradeSubclassBucketRow[]>`
        SELECT
          m.grade,
          m.subclass,
          LEAST(FLOOR(s.score::float / s."maxScore" * 10), 9)::int AS bucket,
          COUNT(*)::int                                              AS count
        FROM submissions s
        JOIN assessments a     ON a.id         = s."assessmentId"
        JOIN classes c         ON c.id         = a."classId"
        JOIN school_memberships m
                               ON m."userId"   = s."studentId"
                              AND m."schoolId" = c."schoolId"
        WHERE c."schoolId" = ${schoolId}
          AND s.status     = 'GRADED'
          AND s."maxScore" > 0
          AND m.role       = 'STUDENT'
          AND m.grade      IN (${Prisma.join(grades)})
          AND m.subclass   IS NOT NULL
          ${subjectFilter}
          ${dateFromFilter}
          ${dateToFilter}
        GROUP BY m.grade, m.subclass, bucket
        ORDER BY m.grade, m.subclass, bucket
      `;

      const series: { label: string; buckets: ReturnType<typeof makeBuckets> }[] = [];

      for (const sel of selections) {
        const gradeRows = rows.filter((r) => r.grade === sel.grade);

        if (sel.subclasses.length === 0) {
          const merged = new Map<number, number>();
          for (const r of gradeRows) {
            merged.set(r.bucket, (merged.get(r.bucket) ?? 0) + r.count);
          }
          const buckets = makeBuckets();
          for (const [b, cnt] of merged) {
            if (b >= 0 && b < 10) buckets[b].count = cnt;
          }
          series.push({ label: `${sel.grade}-sinf`, buckets });
        } else {
          for (const sc of sel.subclasses) {
            const scRows = gradeRows.filter((r) => r.subclass === sc);
            const buckets = makeBuckets();
            for (const r of scRows) {
              if (r.bucket >= 0 && r.bucket < 10) buckets[r.bucket].count = r.count;
            }
            series.push({ label: `${sel.grade}${sc}`, buckets });
          }
        }
      }

      return { series };
    }

    // ── 2. Subclass-grouped mode (class detail page) ───────────────────────────
    if (subclassParam) {
      const subclasses = subclassParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (subclasses.length === 0) {
        return { groups: [], total: 0, classId: classId || null };
      }

      type SubclassBucketRow = { subclass: string; bucket: number; count: number };
      const rows = await prisma.$queryRaw<SubclassBucketRow[]>`
        SELECT
          m.subclass,
          LEAST(FLOOR(s.score::float / s."maxScore" * 10), 9)::int AS bucket,
          COUNT(*)::int                                              AS count
        FROM submissions s
        JOIN assessments a     ON a.id         = s."assessmentId"
        JOIN classes c         ON c.id         = a."classId"
        JOIN school_memberships m
                               ON m."userId"   = s."studentId"
                              AND m."schoolId" = c."schoolId"
        WHERE c."schoolId" = ${schoolId}
          AND s.status     = 'GRADED'
          AND s."maxScore" > 0
          AND m.role       = 'STUDENT'
          AND m.subclass   IN (${Prisma.join(subclasses)})
          ${classFilter}
          ${gradeFilter}
          ${subjectFilter}
          ${dateFromFilter}
          ${dateToFilter}
        GROUP BY m.subclass, bucket
        ORDER BY m.subclass, bucket
      `;

      let total = 0;
      const groups = subclasses.map((sc) => {
        const scRows = rows.filter((r) => r.subclass === sc);
        const buckets = makeBuckets();
        for (const r of scRows) {
          if (r.bucket >= 0 && r.bucket < 10) {
            buckets[r.bucket].count = r.count;
            total += r.count;
          }
        }
        return { subclass: sc, buckets };
      });

      return { groups, total, classId: classId || null };
    }

    // ── 3. Simple aggregate mode (school-wide, single class, grade or subject) ──
    const rows = await prisma.$queryRaw<BucketRow[]>`
      SELECT
        LEAST(FLOOR(s.score::float / s."maxScore" * 10), 9)::int AS bucket,
        COUNT(*)::int                                              AS count
      FROM submissions s
      JOIN assessments a ON a.id = s."assessmentId"
      JOIN classes c     ON c.id = a."classId"
      WHERE c."schoolId" = ${schoolId}
        AND s.status     = 'GRADED'
        AND s."maxScore" > 0
        ${classFilter}
        ${gradeFilter}
        ${subjectFilter}
        ${dateFromFilter}
        ${dateToFilter}
      GROUP BY bucket
      ORDER BY bucket
    `;

    const buckets = fillBuckets(rows);
    const total   = rows.reduce((sum, r) => sum + r.count, 0);

    return { buckets, total, classId: classId || null };
  }, 5 * 60_000); // 5 min TTL

  // Handle error case from invalid JSON
  if (data && typeof data === "object" && "__error" in data) {
    return NextResponse.json(data.body, { status: data.status });
  }

  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
  return response;
}
