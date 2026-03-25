import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";

/**
 * GET /api/director/class-vs-grade?classId=xxx
 * Compare a class's average to its grade-level average (same subject across the grade)
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;

  const classId = req.nextUrl.searchParams.get("classId");
  if (!classId) {
    return NextResponse.json({ error: "classId required" }, { status: 400 });
  }

  const cls = await prisma.class.findFirst({
    where: { id: classId, schoolId: school.id },
    select: { id: true, name: true, subject: true },
  });
  if (!cls) return NextResponse.json({ error: "Class not found" }, { status: 404 });

  // Extract grade from class name
  const gradeMatch = cls.name.match(/^(\d+)-sinf/);
  const grade = gradeMatch ? parseInt(gradeMatch[1]) : 0;

  // This class's average
  const classSubmissions = await prisma.submission.findMany({
    where: {
      status: "GRADED",
      maxScore: { gt: 0 },
      assessment: { classId },
    },
    select: { score: true, maxScore: true },
  });

  const classAvg = classSubmissions.length > 0
    ? Math.round(
        classSubmissions.reduce((sum, s) => sum + ((s.score ?? 0) / (s.maxScore ?? 1)) * 100, 0) /
          classSubmissions.length
      )
    : null;

  // Grade-level average (all classes of same subject in same grade)
  const gradeClasses = await prisma.class.findMany({
    where: {
      schoolId: school.id,
      subject: cls.subject,
      name: { startsWith: `${grade}-sinf` },
      archived: false,
    },
    select: { id: true, name: true },
  });

  const gradeSubmissions = await prisma.submission.findMany({
    where: {
      status: "GRADED",
      maxScore: { gt: 0 },
      assessment: { classId: { in: gradeClasses.map((c) => c.id) } },
    },
    select: { score: true, maxScore: true },
  });

  const gradeAvg = gradeSubmissions.length > 0
    ? Math.round(
        gradeSubmissions.reduce((sum, s) => sum + ((s.score ?? 0) / (s.maxScore ?? 1)) * 100, 0) /
          gradeSubmissions.length
      )
    : null;

  // School-wide average for same subject
  const schoolSubmissions = await prisma.submission.findMany({
    where: {
      status: "GRADED",
      maxScore: { gt: 0 },
      assessment: { class: { schoolId: school.id, subject: cls.subject } },
    },
    select: { score: true, maxScore: true },
  });

  const schoolAvg = schoolSubmissions.length > 0
    ? Math.round(
        schoolSubmissions.reduce((sum, s) => sum + ((s.score ?? 0) / (s.maxScore ?? 1)) * 100, 0) /
          schoolSubmissions.length
      )
    : null;

  const response = NextResponse.json({
    className: cls.name,
    subject: cls.subject,
    grade,
    classAvg,
    gradeAvg,
    schoolAvg,
    classCount: gradeClasses.length,
  });
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
  return response;
}
