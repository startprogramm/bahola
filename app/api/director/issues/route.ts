import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";
import { cached, isCacheHit } from "@/lib/director/server-cache";

interface Issue {
  id: string;
  type: "low_score" | "high_missing" | "declining" | "at_risk_students" | "grading_delay";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  classId?: string;
  className?: string;
  teacherName?: string;
  value: number;
  studentIds?: string[];
}

/**
 * GET /api/director/issues
 * All 4 issue queries run in parallel via Promise.all.
 * Each is 1 DB round-trip (~1s geo-latency), so parallel = ~1s total vs ~4s serial.
 */
export async function GET(_req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;
  const schoolId = school.id;
  const cacheKey = `director:issues:${schoolId}`;

  type ClassStatRow = {
    class_id: string; class_name: string; teacher_name: string;
    graded_count: number; pending_count: number; avg_pct: number | null;
  };
  type DecliningRow = {
    class_id: string; class_name: string; teacher_name: string;
    first_avg: number | null; second_avg: number | null;
  };
  type AtRiskRow = {
    class_id: string; class_name: string; teacher_name: string; student_id: string;
  };
  type DelayRow = { class_id: string; class_name: string; teacher_name: string; delay_count: number };

  const data = await cached(cacheKey, async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    // Run all 4 queries in parallel — each ~1s, total ~1s instead of ~4s
    const [classStats, declining, atRiskRows, delays] = await Promise.all([
      prisma.$queryRaw<ClassStatRow[]>`
        SELECT
          c.id AS class_id, c.name AS class_name, u.name AS teacher_name,
          COUNT(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0 THEN 1 END)::int AS graded_count,
          COUNT(CASE WHEN s.status = 'PENDING' THEN 1 END)::int AS pending_count,
          AVG(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0
                   THEN s.score::float / s."maxScore" END) AS avg_pct
        FROM classes c
        LEFT JOIN users u ON u.id = c."teacherId"
        LEFT JOIN assessments a ON a."classId" = c.id
        LEFT JOIN submissions s ON s."assessmentId" = a.id
        WHERE c."schoolId" = ${schoolId} AND c.archived = false
        GROUP BY c.id, u.name
      `,

      prisma.$queryRaw<DecliningRow[]>`
        WITH ranked_assessments AS (
          SELECT a.id, a."classId",
                 ROW_NUMBER() OVER (PARTITION BY a."classId" ORDER BY a."createdAt") AS rn,
                 COUNT(*) OVER (PARTITION BY a."classId") AS total_count
          FROM assessments a
          JOIN classes c ON c.id = a."classId"
          WHERE c."schoolId" = ${schoolId} AND c.archived = false
        ),
        halves AS (
          SELECT ra."classId",
                 CASE WHEN ra.rn <= ra.total_count / 2 THEN 'first' ELSE 'second' END AS half,
                 AVG(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0
                          THEN s.score::float / s."maxScore" END) AS avg_pct
          FROM ranked_assessments ra
          JOIN submissions s ON s."assessmentId" = ra.id
          WHERE ra.total_count >= 4
          GROUP BY ra."classId", half
        )
        SELECT c.id AS class_id, c.name AS class_name, u.name AS teacher_name,
               MAX(CASE WHEN h.half = 'first'  THEN h.avg_pct END) AS first_avg,
               MAX(CASE WHEN h.half = 'second' THEN h.avg_pct END) AS second_avg
        FROM halves h
        JOIN classes c ON c.id = h."classId"
        LEFT JOIN users u ON u.id = c."teacherId"
        GROUP BY c.id, u.name
        HAVING MAX(CASE WHEN h.half = 'first' THEN h.avg_pct END) -
               MAX(CASE WHEN h.half = 'second' THEN h.avg_pct END) > 0.10
      `,

      prisma.$queryRaw<AtRiskRow[]>`
        SELECT DISTINCT c.id AS class_id, c.name AS class_name,
               u.name AS teacher_name, s."studentId" AS student_id
        FROM submissions s
        JOIN assessments a ON a.id = s."assessmentId"
        JOIN classes c ON c.id = a."classId"
        LEFT JOIN users u ON u.id = c."teacherId"
        WHERE c."schoolId" = ${schoolId} AND c.archived = false
          AND s.status = 'GRADED' AND s."maxScore" > 0
        GROUP BY c.id, u.name, s."studentId"
        HAVING AVG(s.score::float / s."maxScore") < 0.4
      `,

      prisma.$queryRaw<DelayRow[]>`
        SELECT c.id AS class_id, c.name AS class_name, u.name AS teacher_name,
               COUNT(s.id)::int AS delay_count
        FROM submissions s
        JOIN assessments a ON a.id = s."assessmentId"
        JOIN classes c ON c.id = a."classId"
        LEFT JOIN users u ON u.id = c."teacherId"
        WHERE c."schoolId" = ${schoolId}
          AND s.status = 'PENDING' AND s."createdAt" < ${fiveDaysAgo}
        GROUP BY c.id, u.name
        HAVING COUNT(s.id) >= 5
      `,
    ]);

    const issues: Issue[] = [];
    let issueIdx = 0;

    // Process class stats
    for (const cls of classStats) {
      const avgPct = cls.avg_pct !== null ? cls.avg_pct * 100 : null;
      const total = cls.graded_count + cls.pending_count;
      const missingPct = total > 0 ? (cls.pending_count / total) * 100 : 0;

      if (avgPct !== null && avgPct < 40) {
        issues.push({
          id: `issue-${issueIdx++}`, type: "low_score", severity: "critical",
          title: `${cls.class_name}: o'rtacha bal juda past`,
          description: `Sinf o'rtachasi ${Math.round(avgPct)}% — 40% dan past`,
          classId: cls.class_id, className: cls.class_name, teacherName: cls.teacher_name,
          value: Math.round(avgPct),
        });
      }
      if (missingPct > 25 && total > 5) {
        issues.push({
          id: `issue-${issueIdx++}`, type: "high_missing", severity: "warning",
          title: `${cls.class_name}: ko'p ishlar topshirilmagan`,
          description: `${Math.round(missingPct)}% ishlar topshirilmagan (${cls.pending_count} ta)`,
          classId: cls.class_id, className: cls.class_name, teacherName: cls.teacher_name,
          value: Math.round(missingPct),
        });
      }
    }

    // Process declining
    for (const row of declining) {
      if (row.first_avg === null || row.second_avg === null) continue;
      const decline = Math.round((row.first_avg - row.second_avg) * 100);
      issues.push({
        id: `issue-${issueIdx++}`, type: "declining", severity: "warning",
        title: `${row.class_name}: natijalar pasaymoqda`,
        description: `So'nggi ishlarda ${decline}% pasayish kuzatildi`,
        classId: row.class_id, className: row.class_name, teacherName: row.teacher_name,
        value: decline,
      });
    }

    // Process at-risk
    const atRiskByClass = new Map<string, { name: string; teacher: string; ids: string[] }>();
    for (const row of atRiskRows) {
      if (!atRiskByClass.has(row.class_id)) {
        atRiskByClass.set(row.class_id, { name: row.class_name, teacher: row.teacher_name, ids: [] });
      }
      atRiskByClass.get(row.class_id)!.ids.push(row.student_id);
    }
    for (const [classId, data] of atRiskByClass) {
      if (data.ids.length > 3) {
        issues.push({
          id: `issue-${issueIdx++}`, type: "at_risk_students",
          severity: data.ids.length > 10 ? "critical" : "warning",
          title: `${data.name}: ${data.ids.length} ta xavfli o'quvchi`,
          description: `${data.ids.length} ta o'quvchining o'rtacha bali 40% dan past`,
          classId, className: data.name, teacherName: data.teacher,
          value: data.ids.length, studentIds: data.ids.slice(0, 20),
        });
      }
    }

    // Process delays
    for (const row of delays) {
      issues.push({
        id: `issue-${issueIdx++}`, type: "grading_delay", severity: "warning",
        title: `${row.class_name}: ishlar tekshirilmagan`,
        description: `${row.delay_count} ta ish 5 kundan ko'proq vaqtdan beri baholanmagan. O'qituvchi: ${row.teacher_name}`,
        classId: row.class_id, className: row.class_name, teacherName: row.teacher_name,
        value: row.delay_count,
      });
    }

    const severityOrder = { critical: 0, warning: 1, info: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return { issues };
  }, 2 * 60_000); // 2 min TTL

  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
  response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
  return response;
}
