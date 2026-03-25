import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ schoolId: string }> };

/** GET /api/schools/[schoolId]/dashboard - Director stats */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { schoolId } = await params;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, directorId: true },
  });
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });
  if (school.directorId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Run ALL queries in parallel (was sequential: first batch then gradedSubmissions)
  const [studentCount, teacherCount, classCount, assessmentCount, submissionCount, recentSubmissions, gradedSubmissions] =
    await Promise.all([
      prisma.schoolMembership.count({ where: { schoolId, role: "STUDENT", status: "active" } }),
      prisma.schoolMembership.count({ where: { schoolId, role: "TEACHER", status: "active" } }),
      prisma.class.count({ where: { schoolId, archived: false } }),
      prisma.assessment.count({
        where: { class: { schoolId } },
      }),
      prisma.submission.count({
        where: { assessment: { class: { schoolId } } },
      }),
      prisma.submission.findMany({
        where: {
          status: "GRADED",
          assessment: { class: { schoolId } },
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          score: true,
          maxScore: true,
          updatedAt: true,
          student: { select: { id: true, name: true, avatar: true } },
          assessment: {
            select: {
              title: true,
              class: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.submission.findMany({
        where: {
          status: "GRADED",
          assessment: { class: { schoolId } },
          maxScore: { gt: 0 },
        },
        select: { score: true, maxScore: true },
      }),
    ]);

  const avgScore =
    gradedSubmissions.length > 0
      ? gradedSubmissions.reduce((acc, s) => acc + (s.score ?? 0) / (s.maxScore ?? 1), 0) /
        gradedSubmissions.length *
        100
      : null;

  return NextResponse.json({
    stats: {
      students: studentCount,
      teachers: teacherCount,
      classes: classCount,
      assessments: assessmentCount,
      submissions: submissionCount,
      avgScore: avgScore !== null ? Math.round(avgScore) : null,
    },
    recentActivity: recentSubmissions,
  }, {
    headers: {
      "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
    },
  });
}
