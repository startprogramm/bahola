import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { submissionId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { reason } = await request.json();

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: "Reason is required" }, { status: 400 });
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, studentId: true, status: true, reportedAt: true },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    if (submission.studentId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (submission.status !== "GRADED") {
      return NextResponse.json({ error: "Only graded submissions can be reported" }, { status: 400 });
    }

    if (submission.reportedAt) {
      return NextResponse.json({ error: "Already reported" }, { status: 400 });
    }

    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        reportReason: reason.trim(),
        reportedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reporting submission:", error);
    return NextResponse.json({ error: "Failed to report" }, { status: 500 });
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
        reportedAt: true,
        assessment: {
          select: {
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

    if (submission.assessment.class.teacherId !== session.user.id) {
      const hasAccess = await isUserClassTeacher(session.user.id, submission.assessment.classId);
      if (!hasAccess) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    if (!submission.reportedAt) {
      return NextResponse.json({ error: "No report to dismiss" }, { status: 400 });
    }

    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        reportReason: null,
        reportedAt: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error dismissing report:", error);
    return NextResponse.json({ error: "Failed to dismiss report" }, { status: 500 });
  }
}
