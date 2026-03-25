import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { invalidateClassDetailCache } from "@/lib/server-cache";

/**
 * POST /api/submissions/[submissionId]/grade
 * Manually grade a submission (for PENDING submissions)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { submissionId } = await params;
    const { score, feedback } = await request.json();

    if (typeof score !== "number" || score < 0) {
      return NextResponse.json({ error: "Invalid score" }, { status: 400 });
    }

    // Find the submission
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assessment: {
          select: {
            totalMarks: true,
            classId: true,
            class: {
              select: { teacherId: true },
            },
          },
        },
      },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Verify the teacher owns this class
    if (submission.assessment.class.teacherId !== session.user.id) {
      const hasAccess = await isUserClassTeacher(session.user.id, submission.assessment.classId);
      if (!hasAccess) {
        return NextResponse.json({ error: "You don't have permission to grade this submission" }, { status: 403 });
      }
    }

    // Block grading only if submission is currently being processed
    if (submission.status === "PROCESSING") {
      return NextResponse.json({ error: "This submission is currently being processed" }, { status: 400 });
    }

    // Validate score against max
    const maxScore = submission.maxScore || submission.assessment.totalMarks || 100;
    if (score > maxScore) {
      return NextResponse.json({ error: `Score cannot exceed ${maxScore}` }, { status: 400 });
    }

    // Update the submission with manual grade
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        score,
        feedback: feedback || "Manually graded by teacher.",
        status: "GRADED",
        gradedAt: new Date(),
      },
    });

    invalidateClassDetailCache(submission.assessment.classId);

    // Re-fetch with the full shape the GET route returns so the client
    // receives all fields it needs (avatar, adjustments, viewerCanManage, etc.)
    const fullSubmission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        assessment: {
          select: {
            id: true,
            classId: true,
            title: true,
            markScheme: true,
            markSchemePdfUrl: true,
            markSchemeFileUrls: true,
            totalMarks: true,
            class: {
              select: {
                name: true,
                teacherId: true,
                schoolId: true,
                school: { select: { directorId: true } },
              },
            },
          },
        },
        adjustments: {
          orderBy: { adjustedAt: "desc" },
          include: {
            adjuster: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!fullSubmission) {
      return NextResponse.json({ error: "Submission not found after update" }, { status: 404 });
    }

    // Compute viewer fields the same way the GET route does
    const isClassOwner = fullSubmission.assessment.class.teacherId === session.user.id;
    const isTeacher = isClassOwner || await isUserClassTeacher(session.user.id, fullSubmission.assessment.classId);
    let isCoTeacher = false;

    if (isTeacher && !isClassOwner) {
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_classId: {
            studentId: session.user.id,
            classId: fullSubmission.assessment.classId,
          },
        },
        select: { role: true },
      });
      isCoTeacher = enrollment?.role === "TEACHER";
    }

    const isDirector =
      !isTeacher &&
      fullSubmission.assessment.class.school?.directorId === session.user.id;

    const viewerRole = isClassOwner
      ? "OWNER"
      : isCoTeacher
        ? "CO_TEACHER"
        : isDirector
          ? "DIRECTOR"
          : "STUDENT";

    return NextResponse.json({
      submission: {
        ...fullSubmission,
        viewerRole,
        viewerCanManage: isTeacher || isDirector,
        viewerCanViewTeacherData: isTeacher || isDirector,
      },
    });
  } catch (error) {
    console.error("Error grading submission:", error);
    return NextResponse.json({ error: "Failed to grade submission" }, { status: 500 });
  }
}
