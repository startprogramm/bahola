import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";
import { cached, isCacheHit } from "@/lib/director/server-cache";

/**
 * GET /api/director/kpis
 * All KPIs in ONE query using CTEs — critical because each DB round-trip
 * costs ~1s due to geo-latency (server=Uzbekistan, DB=Mumbai).
 */
export async function GET(_req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;
  const schoolId = school.id;
  const cacheKey = `director:kpis:${schoolId}`;

  type KpiRow = {
    total_submissions: number;
    graded_count: number;
    pending_count: number;
    pass_count: number;
    at_risk_count: number;
    student_count: number;
    teacher_count: number;
    class_count: number;
  };

  type ClassAvgRow = {
    id: string; name: string; subject: string | null; avg: number;
    recent_avg: number | null; old_avg: number | null;
  };

  type GradeRow = { grade: number; avg: number; count: number; class_count: number };

  const data = await cached(cacheKey, async () => {
    // Single CTE query: totals + at-risk + membership counts
    // Plus two data queries run in parallel
    const [kpiRows, classAvgs, gradeAvgs] = await Promise.all([
      prisma.$queryRaw<KpiRow[]>`
        WITH school_subs AS (
          SELECT s.id, s.status, s.score, s."maxScore", s."studentId",
                 s."createdAt", s."gradedAt"
          FROM submissions s
          JOIN assessments a ON a.id = s."assessmentId"
          JOIN classes c ON c.id = a."classId"
          WHERE c."schoolId" = ${schoolId}
        ),
        totals AS (
          SELECT
            COUNT(*)::int AS total_submissions,
            COUNT(CASE WHEN status = 'GRADED' AND "maxScore" > 0 THEN 1 END)::int AS graded_count,
            COUNT(CASE WHEN status = 'PENDING' THEN 1 END)::int AS pending_count,
            COUNT(CASE WHEN status = 'GRADED' AND "maxScore" > 0
                            AND score::float / "maxScore" >= 0.85 THEN 1 END)::int AS pass_count
          FROM school_subs
        ),
        at_risk AS (
          SELECT COUNT(*)::int AS at_risk_count
          FROM (
            SELECT "studentId"
            FROM school_subs
            WHERE status = 'GRADED' AND "maxScore" > 0
            GROUP BY "studentId"
            HAVING AVG(score::float / "maxScore") < 0.4
          ) x
        ),
        counts AS (
          SELECT
            (SELECT COUNT(*)::int FROM school_memberships WHERE "schoolId" = ${schoolId} AND role = 'STUDENT' AND status = 'active') AS student_count,
            (SELECT COUNT(*)::int FROM school_memberships WHERE "schoolId" = ${schoolId} AND role = 'TEACHER' AND status = 'active') AS teacher_count,
            (SELECT COUNT(*)::int FROM classes WHERE "schoolId" = ${schoolId} AND archived = false) AS class_count
        )
        SELECT t.*, a.at_risk_count, c.student_count, c.teacher_count, c.class_count
        FROM totals t, at_risk a, counts c
      `,

      prisma.$queryRaw<ClassAvgRow[]>`
        SELECT
          c.id, c.name, c.subject,
          ROUND(AVG(s.score::float / s."maxScore" * 100))::int AS avg,
          ROUND(AVG(CASE WHEN COALESCE(s."gradedAt", s."createdAt") >= NOW() - INTERVAL '30 days'
                         THEN s.score::float / s."maxScore" * 100 END))::int AS recent_avg,
          ROUND(AVG(CASE WHEN COALESCE(s."gradedAt", s."createdAt") < NOW() - INTERVAL '30 days'
                         THEN s.score::float / s."maxScore" * 100 END))::int AS old_avg
        FROM classes c
        JOIN assessments a ON a."classId" = c.id
        JOIN submissions s ON s."assessmentId" = a.id
        WHERE c."schoolId" = ${schoolId}
          AND c.archived = false
          AND s.status = 'GRADED' AND s."maxScore" > 0
        GROUP BY c.id
        HAVING COUNT(s.id) > 0
        ORDER BY avg DESC
      `,

      prisma.$queryRaw<GradeRow[]>`
        SELECT
          CAST(SUBSTRING(c.name FROM '^\d+') AS int) AS grade,
          ROUND(AVG(s.score::float / s."maxScore" * 100))::int AS avg,
          COUNT(s.id)::int AS count,
          COUNT(DISTINCT c.id)::int AS class_count
        FROM classes c
        JOIN assessments a ON a."classId" = c.id
        JOIN submissions s ON s."assessmentId" = a.id
        WHERE c."schoolId" = ${schoolId}
          AND c.archived = false
          AND s.status = 'GRADED' AND s."maxScore" > 0
          AND c.name ~ '^\d+'
        GROUP BY CAST(SUBSTRING(c.name FROM '^\d+') AS int)
        ORDER BY grade
      `,
    ]);

    const kpi = kpiRows[0];
    const passRate = kpi.graded_count > 0
      ? Math.round((kpi.pass_count / kpi.graded_count) * 100) : 0;
    const missingRate = kpi.total_submissions > 0
      ? Math.round((kpi.pending_count / kpi.total_submissions) * 100) : 0;

    const toEntry = (r: ClassAvgRow) => ({
      id: r.id, name: r.name, subject: r.subject, avg: r.avg,
      change: r.recent_avg !== null && r.old_avg !== null
        ? Math.round(r.recent_avg - r.old_avg) : null,
    });

    return {
      passRate,
      missingRate,
      atRiskCount: kpi.at_risk_count,
      topImproved: classAvgs.slice(0, 5).map(toEntry),
      topDeclined: classAvgs.slice(-5).reverse().map(toEntry),
      gradeAverages: gradeAvgs.map((r) => ({
        grade: r.grade, avg: r.avg, count: r.count, classCount: r.class_count,
      })),
      studentCount: kpi.student_count,
      teacherCount: kpi.teacher_count,
      classCount: kpi.class_count,
      totalGraded: kpi.graded_count,
      totalSubmissions: kpi.total_submissions,
    };
  }, 5 * 60_000); // 5 min TTL

  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
  return response;
}
