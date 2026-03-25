import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { isDirectorOfSchool } from "@/lib/director/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { classId } = await params;

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify class exists and authorize class admins (owner/co-teacher/director)
    const [classData, hasAccessCheck] = await Promise.all([
      prisma.class.findUnique({
        where: { id: classId },
        select: { teacherId: true, schoolId: true },
      }),
      isUserClassTeacher(session.user.id, classId)
    ]);

    if (!classData) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Allow class owner, co-teachers, linked directors, or teachers enrolled as students
    if (classData.teacherId !== session.user.id && !hasAccessCheck) {
      // Check if user is a director of the class's school
      const isDirector = await isDirectorOfSchool(session.user.id, classData.schoolId);
      if (!isDirector) {
        // Teachers enrolled as students can view grades (read-only)
        const isTeacherViewing = session.user.role === "TEACHER";
        const enrollment = isTeacherViewing
          ? await prisma.enrollment.findUnique({
              where: { studentId_classId: { studentId: session.user.id, classId } },
              select: { id: true },
            })
          : null;
        if (!enrollment) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
      }
    }

    // Fetch all assessments, enrolled students, and submissions in parallel
    const [assessments, enrollments, submissions] = await Promise.all([
      prisma.assessment.findMany({
        where: { classId, status: { not: "DRAFT" } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          totalMarks: true,
          dueDate: true,
          createdAt: true,
        },
      }),
      prisma.enrollment.findMany({
        where: { classId, role: "STUDENT" },
        include: {
          student: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
        orderBy: { student: { name: "asc" } },
      }),
      prisma.submission.findMany({
        where: { assessment: { classId } },
        select: {
          studentId: true,
          assessmentId: true,
          score: true,
          maxScore: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    const enrolledStudents = enrollments.map((e) => e.student);
    const enrolledStudentIds = new Set(enrolledStudents.map((s) => s.id));

    // Find students who left but still have submissions (preserve their grades)
    const leftStudentIds = new Set<string>();
    for (const sub of submissions) {
      if (!enrolledStudentIds.has(sub.studentId)) {
        leftStudentIds.add(sub.studentId);
      }
    }
    let leftStudents: { id: string; name: string; email: string | null; avatar: string | null }[] = [];
    if (leftStudentIds.size > 0) {
      leftStudents = await prisma.user.findMany({
        where: { id: { in: Array.from(leftStudentIds) } },
        select: { id: true, name: true, email: true, avatar: true },
      });
    }

    const students = [...enrolledStudents, ...leftStudents];

    // Build a lookup: { `${studentId}-${assessmentId}`: submission }
    const submissionMap: Record<string, { score: number | null; maxScore: number | null; status: string; submittedAt: string | null }> = {};
    for (const sub of submissions) {
      const key = `${sub.studentId}-${sub.assessmentId}`;
      const existing = submissionMap[key];
      const shouldReplace =
        !existing ||
        !existing.submittedAt ||
        sub.createdAt.getTime() > new Date(existing.submittedAt).getTime();

      if (!shouldReplace) continue;

      submissionMap[key] = {
        score: sub.score,
        maxScore: sub.maxScore,
        status: sub.status,
        submittedAt: sub.createdAt.toISOString(),
      };
    }

    // Compute actual maxScore per assessment.
    // AI grading sets submission.maxScore to the real total determined from the mark scheme.
    // assessment.totalMarks was historically hardcoded to 100 (not teacher-set), so we ALWAYS
    // prefer the AI-derived maxScore from graded submissions. We only fall back to totalMarks
    // when no graded submissions exist yet (and totalMarks > 0 meaning teacher explicitly set it).
    // totalMarks = 0 is the new sentinel meaning "auto / let AI decide".
    const submissionMaxScoreMap: Record<string, number> = {};
    for (const sub of submissions) {
      if (sub.status === "GRADED" && sub.maxScore && sub.maxScore > 0) {
        const existing = submissionMaxScoreMap[sub.assessmentId];
        if (!existing || sub.maxScore > existing) {
          submissionMaxScoreMap[sub.assessmentId] = sub.maxScore;
        }
      }
    }

    const enrichedAssessments = assessments.map((a) => ({
      ...a,
      // AI-derived maxScore takes priority. Fall back to teacher-set totalMarks.
      // When totalMarks = 0 (auto-detect) and no graded submissions, use 100 as safe default.
      actualMaxScore:
        submissionMaxScoreMap[a.id] ??
        (a.totalMarks > 0 ? a.totalMarks : 100),
    }));

    return NextResponse.json({
      assessments: enrichedAssessments,
      students,
      submissionMap,
    }, {
      headers: {
        "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    console.error("Grades API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
