import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";
import { cached, isCacheHit } from "@/lib/director/server-cache";
import { toCambridgeGrade } from "@/lib/director/cambridge";

/**
 * GET /api/director/cambridge
 * Cambridge AS/A Level aggregated data for grades 9-11.
 */
export async function GET(_req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;
  const schoolId = school.id;
  const cacheKey = `director:cambridge:${schoolId}`;

  type KpiRow = {
    total_students: number;
    total_graded: number;
    avg_pct: number;
    astar_b_count: number;
    astar_c_count: number;
    u_count: number;
  };

  type GradeBreakdownRow = {
    grade: number;
    student_count: number;
    graded_count: number;
    avg_pct: number;
  };

  type DistributionRow = {
    cambridge_grade: string;
    count: number;
  };

  type SubjectRow = {
    subject: string;
    grade: number;
    graded_count: number;
    avg_pct: number;
  };

  type StudentRow = {
    id: string;
    name: string;
    grade: number;
    avg_pct: number;
    graded_count: number;
  };

  const data = await cached(cacheKey, async () => {
    const [kpiRows, gradeBreakdown, distributionRows, subjectRows, studentRows] = await Promise.all([
      // Q1 — KPIs
      prisma.$queryRaw<KpiRow[]>`
        WITH cambridge_classes AS (
          SELECT c.id
          FROM classes c
          WHERE c."schoolId" = ${schoolId}
            AND c.archived = false
            AND c.name ~ '^\d+'
            AND CAST(SUBSTRING(c.name FROM '^\d+') AS int) IN (9, 10, 11)
        ),
        graded AS (
          SELECT s.score, s."maxScore",
                 ROUND(s.score::float / s."maxScore" * 100)::int AS pct
          FROM submissions s
          JOIN assessments a ON a.id = s."assessmentId"
          WHERE a."classId" IN (SELECT id FROM cambridge_classes)
            AND s.status = 'GRADED' AND s."maxScore" > 0
        )
        SELECT
          (SELECT COUNT(DISTINCT e."studentId")::int
           FROM enrollments e WHERE e."classId" IN (SELECT id FROM cambridge_classes)) AS total_students,
          COUNT(*)::int AS total_graded,
          COALESCE(ROUND(AVG(pct)), 0)::int AS avg_pct,
          COUNT(CASE WHEN pct >= 70 THEN 1 END)::int AS astar_b_count,
          COUNT(CASE WHEN pct >= 60 THEN 1 END)::int AS astar_c_count,
          COUNT(CASE WHEN pct < 40 THEN 1 END)::int AS u_count
        FROM graded
      `,

      // Q2 — Per-grade breakdown
      prisma.$queryRaw<GradeBreakdownRow[]>`
        SELECT
          CAST(SUBSTRING(c.name FROM '^\d+') AS int) AS grade,
          COUNT(DISTINCT e."studentId")::int AS student_count,
          COUNT(DISTINCT CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0 THEN s.id END)::int AS graded_count,
          COALESCE(ROUND(AVG(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0
            THEN s.score::float / s."maxScore" * 100 END)), 0)::int AS avg_pct
        FROM classes c
        LEFT JOIN enrollments e ON e."classId" = c.id
        LEFT JOIN assessments a ON a."classId" = c.id
        LEFT JOIN submissions s ON s."assessmentId" = a.id
        WHERE c."schoolId" = ${schoolId}
          AND c.archived = false
          AND c.name ~ '^\d+'
          AND CAST(SUBSTRING(c.name FROM '^\d+') AS int) IN (9, 10, 11)
        GROUP BY CAST(SUBSTRING(c.name FROM '^\d+') AS int)
        ORDER BY grade
      `,

      // Q3 — Grade distribution (A*-U)
      prisma.$queryRaw<DistributionRow[]>`
        WITH graded AS (
          SELECT ROUND(s.score::float / s."maxScore" * 100)::int AS pct
          FROM submissions s
          JOIN assessments a ON a.id = s."assessmentId"
          JOIN classes c ON c.id = a."classId"
          WHERE c."schoolId" = ${schoolId}
            AND c.archived = false
            AND c.name ~ '^\d+'
            AND CAST(SUBSTRING(c.name FROM '^\d+') AS int) IN (9, 10, 11)
            AND s.status = 'GRADED' AND s."maxScore" > 0
        )
        SELECT
          CASE
            WHEN pct >= 90 THEN 'A*'
            WHEN pct >= 80 THEN 'A'
            WHEN pct >= 70 THEN 'B'
            WHEN pct >= 60 THEN 'C'
            WHEN pct >= 50 THEN 'D'
            WHEN pct >= 40 THEN 'E'
            ELSE 'U'
          END AS cambridge_grade,
          COUNT(*)::int AS count
        FROM graded
        GROUP BY cambridge_grade
      `,

      // Q4 — Per-subject stats
      prisma.$queryRaw<SubjectRow[]>`
        SELECT
          c.subject,
          CAST(SUBSTRING(c.name FROM '^\d+') AS int) AS grade,
          COUNT(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0 THEN 1 END)::int AS graded_count,
          COALESCE(ROUND(AVG(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0
            THEN s.score::float / s."maxScore" * 100 END)), 0)::int AS avg_pct
        FROM classes c
        JOIN assessments a ON a."classId" = c.id
        JOIN submissions s ON s."assessmentId" = a.id
        WHERE c."schoolId" = ${schoolId}
          AND c.archived = false
          AND c.name ~ '^\d+'
          AND CAST(SUBSTRING(c.name FROM '^\d+') AS int) IN (9, 10, 11)
          AND c.subject IS NOT NULL
        GROUP BY c.subject, CAST(SUBSTRING(c.name FROM '^\d+') AS int)
        ORDER BY c.subject, grade
      `,

      // Q5 — Student rankings
      prisma.$queryRaw<StudentRow[]>`
        SELECT
          u.id, u.name,
          CAST(SUBSTRING(c.name FROM '^\d+') AS int) AS grade,
          ROUND(AVG(s.score::float / s."maxScore" * 100))::int AS avg_pct,
          COUNT(s.id)::int AS graded_count
        FROM users u
        JOIN enrollments e ON e."studentId" = u.id
        JOIN classes c ON c.id = e."classId"
        JOIN assessments a ON a."classId" = c.id
        JOIN submissions s ON s."assessmentId" = a.id AND s."studentId" = u.id
        WHERE c."schoolId" = ${schoolId}
          AND c.archived = false
          AND c.name ~ '^\d+'
          AND CAST(SUBSTRING(c.name FROM '^\d+') AS int) IN (9, 10, 11)
          AND s.status = 'GRADED' AND s."maxScore" > 0
        GROUP BY u.id, u.name, CAST(SUBSTRING(c.name FROM '^\d+') AS int)
        ORDER BY avg_pct DESC
      `,
    ]);

    const kpi = kpiRows[0] || { total_students: 0, total_graded: 0, avg_pct: 0, astar_b_count: 0, astar_c_count: 0, u_count: 0 };
    const totalGraded = kpi.total_graded || 1; // avoid div by zero

    // Build distribution map with all grades
    const distribution: Record<string, number> = { "A*": 0, A: 0, B: 0, C: 0, D: 0, E: 0, U: 0 };
    for (const row of distributionRows) {
      distribution[row.cambridge_grade] = row.count;
    }

    return {
      kpis: {
        totalStudents: kpi.total_students,
        totalGraded: kpi.total_graded,
        avgPct: kpi.avg_pct,
        avgGrade: toCambridgeGrade(kpi.avg_pct),
        aStarBRate: Math.round((kpi.astar_b_count / totalGraded) * 100),
        aStarCRate: Math.round((kpi.astar_c_count / totalGraded) * 100),
        uRate: Math.round((kpi.u_count / totalGraded) * 100),
        gradeBreakdown: gradeBreakdown.map(r => ({
          grade: r.grade,
          studentCount: r.student_count,
          gradedCount: r.graded_count,
          avgPct: r.avg_pct,
          cambridgeGrade: toCambridgeGrade(r.avg_pct),
        })),
      },
      distribution,
      subjects: subjectRows
        .filter(r => r.subject)
        .map(r => ({
          subject: r.subject,
          grade: r.grade,
          gradedCount: r.graded_count,
          avgPct: r.avg_pct,
          cambridgeGrade: toCambridgeGrade(r.avg_pct),
        })),
      students: studentRows.map(r => ({
        id: r.id,
        name: r.name,
        grade: r.grade,
        avgPct: r.avg_pct,
        cambridgeGrade: toCambridgeGrade(r.avg_pct),
        gradedCount: r.graded_count,
      })),
    };
  }, 5 * 60_000);

  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
  return response;
}
