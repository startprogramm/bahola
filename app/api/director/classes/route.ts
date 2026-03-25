import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";
import { generateClassCode } from "@/lib/utils";
import { getRandomBannerId } from "@/lib/class-banners";
import { cached, isCacheHit, invalidateByPrefix } from "@/lib/director/server-cache";

/**
 * GET /api/director/classes
 * Per-class stats with optional filters: ?grade=8&subject=Matematika&search=
 * Uses a single SQL aggregation query instead of loading all submissions.
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;

  const url = req.nextUrl;
  const idFilter = url.searchParams.get("id");
  const gradeFilter = url.searchParams.get("grade");
  const subjectFilter = url.searchParams.get("subject");
  const search = url.searchParams.get("search");

  const schoolId = school.id;
  const cacheKey = `director:classes:${schoolId}`;

  // Single SQL query: per-class aggregated stats — cached, filters applied in JS
  type ClassRow = {
    id: string;
    name: string;
    subject: string | null;
    teacher_id: string | null;
    teacher_name: string | null;
    student_count: number;
    assessment_count: number;
    graded_count: number;
    pending_count: number;
    avg_pct: number | null;
    pass_count: number;
  };

  const rows = await cached(cacheKey, () => prisma.$queryRaw<ClassRow[]>`
    SELECT
      c.id,
      c.name,
      c.subject,
      u.id        AS teacher_id,
      u.name      AS teacher_name,
      COALESCE(ec.cnt, 0)::int AS student_count,
      COALESCE(ac.cnt, 0)::int AS assessment_count,
      COUNT(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0 THEN 1 END)::int AS graded_count,
      COUNT(CASE WHEN s.status = 'PENDING' THEN 1 END)::int AS pending_count,
      AVG(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0
               THEN s.score::float / s."maxScore" END) AS avg_pct,
      COUNT(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0
                      AND s.score::float / s."maxScore" >= 0.85 THEN 1 END)::int AS pass_count
    FROM classes c
    LEFT JOIN users u ON u.id = c."teacherId"
    LEFT JOIN (SELECT "classId", COUNT(*)::int AS cnt FROM enrollments WHERE role = 'STUDENT' GROUP BY "classId") ec ON ec."classId" = c.id
    LEFT JOIN (SELECT "classId", COUNT(*)::int AS cnt FROM assessments GROUP BY "classId") ac ON ac."classId" = c.id
    LEFT JOIN assessments a ON a."classId" = c.id
    LEFT JOIN submissions s ON s."assessmentId" = a.id
    WHERE c."schoolId" = ${schoolId}
      AND c.archived = false
    GROUP BY c.id, u.id, u.name, ec.cnt, ac.cnt
    ORDER BY c.name
  `, 3 * 60_000); // 3 min TTL

  // Apply JS-level filters (id, subject, search, grade)
  const filtered = rows.filter((r) => {
    if (idFilter && r.id !== idFilter) return false;
    if (subjectFilter && r.subject !== subjectFilter) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (gradeFilter) {
      const m = r.name.match(/^(\d+)/);
      if (!m || m[1] !== gradeFilter) return false;
    }
    return true;
  });

  const result = filtered.map((r) => {
    const graded = r.graded_count;
    const pending = r.pending_count;
    const total = graded + pending;
    const avgScore = r.avg_pct !== null ? Math.round(r.avg_pct * 100) : null;
    const passRate = graded > 0 ? Math.round((r.pass_count / graded) * 100) : null;
    const missingRate = total > 0 ? Math.round((pending / total) * 100) : 0;

    const gradeMatch = r.name.match(/^(\d+)/);
    const grade = gradeMatch ? parseInt(gradeMatch[1]) : 0;

    return {
      id: r.id,
      name: r.name,
      subject: r.subject,
      grade,
      teacher: r.teacher_id ? { id: r.teacher_id, name: r.teacher_name ?? "" } : null,
      studentCount: r.student_count,
      assessmentCount: r.assessment_count,
      avgScore,
      passRate,
      missingRate,
      totalGraded: graded,
      totalPending: pending,
    };
  });

  const response = NextResponse.json({ classes: result });
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
  return response;
}

/**
 * POST /api/director/classes
 * Director creates a class assigned to a specific teacher.
 * Body: { teacherId, name, subject? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;

  const body = await req.json();
  const { teacherId, name, subject, grade, subclasses } = body;

  if (!teacherId || !name) {
    return NextResponse.json(
      { error: "teacherId and name are required" },
      { status: 400 }
    );
  }

  // Verify teacher belongs to this school
  const teacherMembership = await prisma.schoolMembership.findFirst({
    where: { userId: teacherId, schoolId: school.id, role: "TEACHER", status: "active" },
    select: { id: true },
  });

  if (!teacherMembership) {
    return NextResponse.json(
      { error: "Teacher not found in this school" },
      { status: 404 }
    );
  }

  // Generate unique class code
  let code = generateClassCode();
  let existingClass = await prisma.class.findUnique({
    where: { code },
    select: { id: true },
  });
  while (existingClass) {
    code = generateClassCode();
    existingClass = await prisma.class.findUnique({
      where: { code },
      select: { id: true },
    });
  }

  const newClass = await prisma.class.create({
    data: {
      name,
      subject: subject || null,
      code,
      teacherId,
      schoolId: school.id,
      bannerStyle: getRandomBannerId(),
    },
    select: {
      id: true,
      name: true,
      subject: true,
      code: true,
      teacherId: true,
      schoolId: true,
      createdAt: true,
    },
  });

  // Enroll students of the specified grade (if provided)
  if (grade) {
    const where: any = { schoolId: school.id, role: "STUDENT", status: "active", grade: String(grade) };
    if (subclasses && Array.isArray(subclasses) && subclasses.length > 0) {
      where.subclass = { in: subclasses };
    }
    const students = await prisma.schoolMembership.findMany({
      where,
      select: { userId: true },
    });
    if (students.length > 0) {
      await prisma.enrollment.createMany({
        data: students.map(s => ({ studentId: s.userId, classId: newClass.id })),
        skipDuplicates: true,
      });
    }
  }

  // Invalidate caches affected by new class
  invalidateByPrefix(`director:classes:${school.id}`);
  invalidateByPrefix(`director:kpis:${school.id}`);

  return NextResponse.json(
    { message: "Class created successfully", class: newClass },
    { status: 201 }
  );
}
