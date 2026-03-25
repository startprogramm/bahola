import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import prisma, { isSuperAdmin } from "@/lib/prisma";
import { isDirectorOfSchool } from "@/lib/director/auth";
import { cached } from "@/lib/server-cache";
import ClassDetailClient from "./class-detail-client";

/**
 * Server component wrapper for the class detail page.
 * Fetches class data via Prisma on the server (SSR) and passes it
 * as `initialData` to the client component, eliminating the
 * client-side fetch waterfall (useEffect -> API -> render).
 */

async function getClassDetailData(userId: string, userRole: string | undefined, classId: string) {
  return cached(`classDetail:${classId}:${userId}`, async () => {
    // Fetch enrollment and full class data in parallel
    const [enrollment, classDataFull] = await Promise.all([
      prisma.enrollment.findUnique({
        where: { studentId_classId: { studentId: userId, classId } },
        select: { role: true },
      }),
      prisma.class.findUnique({
        where: { id: classId },
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          subject: true,
          headerColor: true,
          bannerStyle: true,
          classAvatar: true,
          createdAt: true,
          updatedAt: true,
          teacherId: true,
          schoolId: true,
          teacher: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          enrollments: {
            select: {
              id: true,
              role: true,
              joinedAt: true,
              studentId: true,
              student: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true,
                },
              },
            },
            orderBy: { joinedAt: "desc" },
          },
        },
      }),
    ]);

    if (!classDataFull) return null;

    const isClassOwner = classDataFull.teacherId === userId;
    const isCoTeacher = enrollment?.role === "TEACHER";
    const isEnrolledStudent = enrollment?.role === "STUDENT";

    // Only check director status if not already authorized
    let isDirector = false;
    if (!isClassOwner && !isCoTeacher && !isEnrolledStudent) {
      isDirector = await isDirectorOfSchool(userId, classDataFull.schoolId);
    }

    if (!isClassOwner && !isCoTeacher && !isEnrolledStudent && !isDirector) {
      return null; // Unauthorized
    }

    // Superadmin check
    const isSA = (isCoTeacher || isEnrolledStudent) && await isSuperAdmin(userId);

    // Teachers enrolled as students can still view grades
    const isTeacherRoleUser = isEnrolledStudent && userRole === "TEACHER";

    const viewerRole =
      isClassOwner
        ? "OWNER"
        : isCoTeacher
          ? "CO_TEACHER"
          : isDirector
            ? "DIRECTOR"
            : "STUDENT";
    const viewerCanManage = isClassOwner || isCoTeacher || isDirector || isSA;
    const viewerCanViewTeacherData = isClassOwner || isCoTeacher || isDirector || isSA || isTeacherRoleUser;
    const viewerCanInteractWithStream = true;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Strip schoolId from response
    const { schoolId: _schoolId, ...classDataClean } = classDataFull;

    let assessments: any[] = [];

    // Shared views query
    const viewsPromise = prisma.assessmentView.findMany({
      where: {
        userId,
        assessment: { classId, createdAt: { gt: sevenDaysAgo } },
      },
      select: { assessmentId: true },
    });

    if (viewerCanViewTeacherData) {
      const [teacherAssessments, recentViews] = await Promise.all([
        prisma.assessment.findMany({
          where: { classId },
          select: {
            id: true,
            title: true,
            totalMarks: true,
            dueDate: true,
            status: true,
            createdAt: true,
            _count: { select: { submissions: true } },
            submissions: {
              where: { status: "GRADED" },
              select: { id: true },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        viewsPromise,
      ]);

      const viewedIds = new Set(recentViews.map((v) => v.assessmentId));
      assessments = teacherAssessments.map((assessment) => ({
        ...assessment,
        gradedSubmissionsCount: assessment.submissions.length,
        submissions: [],
        isNew: new Date(assessment.createdAt) > sevenDaysAgo && !viewedIds.has(assessment.id),
      }));
    } else {
      const [studentAssessments, recentViews] = await Promise.all([
        prisma.assessment.findMany({
          where: { classId },
          include: {
            _count: { select: { submissions: true } },
            submissions: {
              where: { studentId: userId },
              select: {
                id: true,
                status: true,
                score: true,
                maxScore: true,
                createdAt: true,
                gradedAt: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        viewsPromise,
      ]);

      const viewedIds = new Set(recentViews.map((v) => v.assessmentId));
      assessments = studentAssessments.map((a: any) => ({
        ...a,
        isNew: new Date(a.createdAt) > sevenDaysAgo && !viewedIds.has(a.id),
      }));
    }

    return {
      ...classDataClean,
      viewerRole,
      viewerCanManage,
      viewerCanViewTeacherData,
      viewerCanInteractWithStream,
      assessments,
    };
  }, 86_400_000); // 24h — invalidated on change, not on timer
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const session = await getAuthSession();
  if (!session?.user?.id) redirect("/login");

  const { classId } = await params;
  let initialData = null;

  try {
    const data = await getClassDetailData(session.user.id, session.user.role, classId);
    if (data) {
      // Serialize dates to strings for client component (matching API response format)
      initialData = JSON.parse(JSON.stringify(data));
    }
  } catch (error) {
    console.error("Error fetching class detail on server:", error);
    // Fall through — client will fetch via API as fallback
  }

  return (
    <ClassDetailClient
      initialData={initialData}
      classId={classId}
    />
  );
}
