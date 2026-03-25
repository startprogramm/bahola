import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";
import { cached, isCacheHit } from "@/lib/director/server-cache";

/**
 * GET /api/director/teachers/usage
 * Both queries run in parallel (saves ~1s geo-latency).
 */
export async function GET(_req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;
  const schoolId = school.id;
  const cacheKey = `director:teachers-usage:${schoolId}`;

  type TeacherStatRow = {
    id: string; name: string; email: string; avatar: string | null;
    subscription: string | null; credits: number;
    submissions_graded: number; assessments_created: number; credits_used: number;
  };

  type ClassRow = {
    id: string; name: string; subject: string | null;
    teacher_id: string; student_count: number; assessment_count: number;
    description: string | null;
  };

  const data = await cached(cacheKey, async () => {
    // Run both queries in parallel — query 2 filters by schoolId instead of teacherIds
    const [teacherRows, classRows] = await Promise.all([
      prisma.$queryRaw<TeacherStatRow[]>`
        SELECT
          u.id, u.name, u.email, u.avatar, u.subscription, u.credits,
          COUNT(DISTINCT CASE WHEN s.status = 'GRADED' THEN s.id END)::int AS submissions_graded,
          COUNT(DISTINCT a.id)::int AS assessments_created,
          COALESCE(ct_agg.total, 0)::int AS credits_used
        FROM school_memberships m
        JOIN users u ON u.id = m."userId"
        LEFT JOIN classes c ON c."teacherId" = u.id AND c."schoolId" = ${schoolId} AND c.archived = false
        LEFT JOIN assessments a ON a."classId" = c.id
        LEFT JOIN submissions s ON s."assessmentId" = a.id
        LEFT JOIN (
          SELECT "userId", SUM(ABS(amount))::int AS total
          FROM credit_transactions WHERE type = 'USAGE' GROUP BY "userId"
        ) ct_agg ON ct_agg."userId" = u.id
        WHERE m."schoolId" = ${schoolId} AND m.role = 'TEACHER' AND m.status = 'active'
        GROUP BY u.id, u.name, u.email, u.avatar, u.subscription, u.credits, ct_agg.total
        ORDER BY submissions_graded DESC
      `,

      prisma.$queryRaw<ClassRow[]>`
        SELECT
          c.id, c.name, c.subject, c.description,
          c."teacherId" AS teacher_id,
          COUNT(DISTINCT e."studentId")::int AS student_count,
          COUNT(DISTINCT a.id)::int AS assessment_count
        FROM classes c
        LEFT JOIN enrollments e ON e."classId" = c.id AND e.role = 'STUDENT'
        LEFT JOIN assessments a ON a."classId" = c.id
        WHERE c."schoolId" = ${schoolId} AND c.archived = false
        GROUP BY c.id, c.name, c.subject, c.description, c."teacherId"
        ORDER BY c.name
      `,
    ]);

    if (teacherRows.length === 0) {
      return { teachers: [] };
    }

    // Group classes by teacher (filter to only teachers in membership)
    const teacherIdSet = new Set(teacherRows.map((t) => t.id));
    const classById = new Map(classRows.map((c) => [c.id, c]));
    const classesByTeacher = new Map<string, ClassRow[]>();
    for (const cls of classRows) {
      if (!teacherIdSet.has(cls.teacher_id)) continue;
      if (!classesByTeacher.has(cls.teacher_id)) classesByTeacher.set(cls.teacher_id, []);
      classesByTeacher.get(cls.teacher_id)!.push(cls);
    }

    // Also include co-teacher classes (Enrollment with role TEACHER)
    const coTeacherRows = await prisma.enrollment.findMany({
      where: {
        studentId: { in: [...teacherIdSet] },
        role: "TEACHER",
      },
      select: { studentId: true, classId: true },
    });
    for (const ct of coTeacherRows) {
      const cls = classById.get(ct.classId);
      if (!cls) continue;
      if (!classesByTeacher.has(ct.studentId)) classesByTeacher.set(ct.studentId, []);
      const existing = classesByTeacher.get(ct.studentId)!;
      if (!existing.some((c) => c.id === cls.id)) {
        existing.push(cls);
      }
    }

    const teachers = teacherRows.map((t) => {
      const classes = classesByTeacher.get(t.id) || [];
      const subjects = [...new Set(classes.map((c) => c.subject).filter(Boolean))];
      return {
        id: t.id, name: t.name, email: t.email, avatar: t.avatar,
        subscription: t.subscription, credits: t.credits, creditsUsed: t.credits_used,
        subjects, classCount: classes.length,
        classes: classes.map((c) => ({
          id: c.id, name: c.name, subject: c.subject,
          studentCount: c.student_count, assessmentCount: c.assessment_count,
        })),
        assessmentsCreated: t.assessments_created, submissionsGraded: t.submissions_graded,
      };
    });

    return { teachers };
  }, 5 * 60_000); // 5 min TTL

  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
  response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
  return response;
}
