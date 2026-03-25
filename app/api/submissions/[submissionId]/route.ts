import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { unlink } from "fs/promises";
import path from "path";
import { invalidateClassDetailCache } from "@/lib/server-cache";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { submissionId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const submission = await prisma.submission.findUnique({
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
        questionResults: {
          orderBy: { questionNumber: "asc" },
        },
      },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    // Check access - class admin (owner/co-teacher/director) or submitting student
    const isClassOwner = submission.assessment.class.teacherId === session.user.id;
    const isTeacher = isClassOwner || await isUserClassTeacher(session.user.id, submission.assessment.classId);
    const isOwner = submission.studentId === session.user.id;
    let isCoTeacher = false;
    let isDirector = false;

    if (isTeacher && !isClassOwner) {
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_classId: {
            studentId: session.user.id,
            classId: submission.assessment.classId,
          },
        },
        select: { role: true },
      });
      isCoTeacher = enrollment?.role === "TEACHER";
    }

    // Check if user is the school director
    if (!isTeacher && !isOwner && submission.assessment.class.school?.directorId === session.user.id) {
      isDirector = true;
    }

    // Teachers enrolled as students can view any submission in the class (read-only)
    let isTeacherRoleViewer = false;
    if (!isTeacher && !isOwner && !isDirector) {
      if (session.user.role === "TEACHER") {
        const enrollment = await prisma.enrollment.findUnique({
          where: {
            studentId_classId: {
              studentId: session.user.id,
              classId: submission.assessment.classId,
            },
          },
          select: { id: true },
        });
        isTeacherRoleViewer = !!enrollment;
      }
      if (!isTeacherRoleViewer) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const hasTeacherView = isTeacher || isTeacherRoleViewer || isDirector;

    // Security: Hide extracted text from students (but show to teacher-role viewers)
    if (!hasTeacherView && submission) {
      submission.extractedText = null;
    }

    const viewerRole =
      isClassOwner
        ? "OWNER"
        : isCoTeacher
          ? "CO_TEACHER"
          : isDirector
            ? "DIRECTOR"
            : "STUDENT";

    return NextResponse.json({
      submission: {
        ...submission,
        viewerRole,
        viewerCanManage: isTeacher || isDirector,
        viewerCanViewTeacherData: hasTeacherView,
      },
    }, {
      headers: {
        "Cache-Control": "private, max-age=5, stale-while-revalidate=15",
      },
    });
  } catch (error) {
    console.error("Error fetching submission:", error);
    return NextResponse.json(
      { error: "Failed to fetch submission" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { submissionId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        studentId: true,
        imageUrls: true,
        assessment: {
          select: {
            classId: true,
            status: true,
            class: {
              select: { teacherId: true },
            },
          },
        },
      },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    // Check access - teacher, co-teacher, or the student who submitted can delete
    const isDeleteClassOwner = submission.assessment.class.teacherId === session.user.id;
    const isDeleteTeacher = isDeleteClassOwner || await isUserClassTeacher(session.user.id, submission.assessment.classId);
    const isDeleteOwner = submission.studentId === session.user.id;

    if (!isDeleteTeacher && !isDeleteOwner) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Students can only delete if assessment is still active
    if (isDeleteOwner && !isDeleteTeacher && submission.assessment.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Cannot delete submission - assessment is no longer active" },
        { status: 400 }
      );
    }

    // Try to delete the uploaded files
    if (submission.imageUrls) {
      try {
        const imageUrls: string[] = JSON.parse(submission.imageUrls);
        for (const imageUrl of imageUrls) {
          try {
            // Delete files from the uploads directory, preserving subdirectory structure
            const relativePath = imageUrl.replace(/^\/uploads\//, "");
            const filePath = path.join(process.cwd(), "public", "uploads", relativePath);
            await unlink(filePath);
          } catch (fileError) {
            // File might not exist, continue anyway
            console.warn("Could not delete file:", imageUrl, fileError);
          }
        }
      } catch (parseError) {
        console.warn("Could not parse imageUrls:", parseError);
      }
    }

    // Delete the submission
    await prisma.submission.delete({
      where: { id: submissionId },
    });

    return NextResponse.json({ message: "Submission deleted successfully" });
  } catch (error) {
    console.error("Error deleting submission:", error);
    return NextResponse.json(
      { error: "Failed to delete submission" },
      { status: 500 }
    );
  }
}

// PATCH - Teacher adjusts score
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { submissionId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { score, reason } = body;

    if (score === undefined || score === null) {
      return NextResponse.json(
        { error: "Score is required" },
        { status: 400 }
      );
    }

    if (!reason || reason.trim() === "") {
      return NextResponse.json(
        { error: "Reason for adjustment is required" },
        { status: 400 }
      );
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        score: true,
        maxScore: true,
        originalScore: true,
        studentId: true,
        assessment: {
          select: {
            classId: true,
            totalMarks: true,
            class: {
              select: { teacherId: true },
            },
          },
        },
      },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    // Only the teacher or co-teacher of this class can adjust scores
    const isPatchOwner = submission.assessment.class.teacherId === session.user.id;
    if (!isPatchOwner) {
      const hasAccess = await isUserClassTeacher(session.user.id, submission.assessment.classId);
      if (!hasAccess) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Validate score is within range
    const effectiveMaxScore = submission.maxScore || submission.assessment.totalMarks || 100;
    if (score < 0 || score > effectiveMaxScore) {
      return NextResponse.json(
        { error: `Score must be between 0 and ${effectiveMaxScore}` },
        { status: 400 }
      );
    }

    // Store original score if this is the first adjustment
    const originalScore = submission.originalScore ?? submission.score;
    const scoreBefore = submission.score ?? 0;

    // Use a transaction to update the submission and create history record
    await prisma.$transaction([
      prisma.submission.update({
        where: { id: submissionId },
        data: {
          score: score,
          originalScore: originalScore,
          adjustedBy: session.user.id,
          adjustmentReason: reason.trim(),
          adjustedAt: new Date(),
          reportReason: null,
          reportedAt: null,
        },
      }),
      prisma.scoreAdjustment.create({
        data: {
          submissionId,
          adjustedBy: session.user.id,
          scoreBefore,
          scoreAfter: score,
          changes: JSON.stringify([{
            questionIndex: -1,
            questionTitle: "Overall Score",
            pointsBefore: scoreBefore,
            pointsAfter: score,
            maxPoints: effectiveMaxScore,
            reason: reason.trim(),
          }]),
        },
      }),
    ]);

    // Fetch the updated submission with adjustments included
    const updatedSubmission = await prisma.submission.findUnique({
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
            title: true,
            markScheme: true,
            markSchemePdfUrl: true,
            markSchemeFileUrls: true,
            totalMarks: true,
            class: {
              select: {
                name: true,
                teacherId: true,
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

    invalidateClassDetailCache(submission.assessment.classId);

    return NextResponse.json({ submission: updatedSubmission });
  } catch (error) {
    console.error("Error adjusting score:", error);
    return NextResponse.json(
      { error: "Failed to adjust score" },
      { status: 500 }
    );
  }
}
