import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import prisma, { isSuperAdmin } from "@/lib/prisma";
import { isDirectorOfSchool } from "@/lib/director/auth";
import { cached } from "@/lib/server-cache";
import InsightsClient from "./insights-client";

/**
 * Server component wrapper for the assessment insights page.
 * Fetches assessment data + analytics summary via Prisma on the server (SSR)
 * and passes them as initialData / initialSummary to the client component,
 * eliminating the client-side fetch waterfall.
 */

async function getInsightsData(userId: string, userRole: string | undefined, assessmentId: string) {
  return cached(`assessment:${assessmentId}:${userId}`, async () => {
    // 1. Fetch basic assessment info for permission checks
    const assessmentBasic = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        classId: true,
        class: {
          select: {
            teacherId: true,
            schoolId: true,
          },
        },
      },
    });

    if (!assessmentBasic) return null;

    // 2. Check permissions in parallel
    const [realEnrollment, isSA] = await Promise.all([
      prisma.enrollment.findUnique({
        where: { studentId_classId: { studentId: userId, classId: assessmentBasic.classId } },
        select: { role: true },
      }),
      isSuperAdmin(userId),
    ]);

    const isClassOwner = assessmentBasic.class.teacherId === userId;
    const isCoTeacher = realEnrollment?.role === "TEACHER";
    const isEnrolledStudent = realEnrollment?.role === "STUDENT";

    // Only check director status if not already authorized
    let isDirector = false;
    if (!isClassOwner && !isCoTeacher && !isEnrolledStudent) {
      isDirector = await isDirectorOfSchool(userId, assessmentBasic.class.schoolId);
    }

    if (!isClassOwner && !isCoTeacher && !isEnrolledStudent && !isDirector && !isSA) {
      return null; // Unauthorized
    }

    const isTeacherRoleUser = isEnrolledStudent && userRole === "TEACHER";
    const viewerCanViewTeacherData = isClassOwner || isCoTeacher || isDirector || isSA || isTeacherRoleUser;

    // 3. Fetch full assessment data with submissions
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        title: true,
        totalMarks: true,
        dueDate: true,
        status: true,
        createdAt: true,
        analyticsSummary: true,
        class: {
          select: {
            id: true,
            name: true,
            teacherId: true,
            teacher: {
              select: { id: true, name: true },
            },
          },
        },
        submissions: {
          select: {
            id: true,
            score: true,
            maxScore: true,
            feedback: true,
            status: true,
            gradingProgress: true,
            createdAt: true,
            student: {
              select: { id: true, name: true, email: true },
            },
          },
          ...(viewerCanViewTeacherData
            ? { orderBy: { createdAt: "desc" as const } }
            : { where: { studentId: userId } }),
        },
      },
    });

    if (!assessment) return null;

    const viewerRole =
      isClassOwner || isSA
        ? "OWNER"
        : isCoTeacher
          ? "CO_TEACHER"
          : isDirector
            ? "DIRECTOR"
            : "STUDENT";

    return {
      assessment: {
        id: assessment.id,
        title: assessment.title,
        description: null,
        totalMarks: assessment.totalMarks,
        dueDate: assessment.dueDate,
        status: assessment.status,
        createdAt: assessment.createdAt,
        class: {
          id: assessment.class.id,
          name: assessment.class.name,
          teacher: {
            id: assessment.class.teacher.id,
            name: assessment.class.teacher.name,
          },
        },
        submissions: assessment.submissions.map((s) => ({
          id: s.id,
          score: s.score,
          maxScore: s.maxScore,
          feedback: s.feedback,
          status: s.status,
          gradingProgress: s.gradingProgress,
          createdAt: s.createdAt,
          student: {
            id: s.student.id,
            name: s.student.name,
            email: s.student.email,
          },
        })),
        viewerRole,
        viewerCanManage: isClassOwner || isCoTeacher || isDirector || isSA,
        viewerCanViewTeacherData,
      },
      analyticsSummary: assessment.analyticsSummary ?? null,
    };
  }, 86_400_000); // 24h — invalidated on change, not on timer
}

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const session = await getAuthSession();
  if (!session?.user?.id) redirect("/login");

  const { assessmentId } = await params;
  let initialData = null;
  let initialSummary: string | null = null;

  try {
    const data = await getInsightsData(session.user.id, session.user.role, assessmentId);
    if (data) {
      // Serialize dates to strings for client component (matching API response format)
      initialData = JSON.parse(JSON.stringify(data.assessment));
      initialSummary = data.analyticsSummary;
    }
  } catch (error) {
    console.error("Error fetching insights data on server:", error);
    // Fall through — client will fetch via API as fallback
  }

  return (
    <InsightsClient
      initialData={initialData}
      initialSummary={initialSummary}
      assessmentId={assessmentId}
    />
  );
}
