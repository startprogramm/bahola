import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { invalidateClassDetailCache } from "@/lib/server-cache";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { classId } = await params;

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the user is the teacher of this class
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true },
    });

    if (!classData) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    if (classData.teacherId !== session.user.id) {
      const hasAccess = await isUserClassTeacher(session.user.id, classId);
      if (!hasAccess) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    const body = await request.json();
    const { studentId, assessmentId, score, maxScore: clientMaxScore } = body;

    if (!studentId || !assessmentId || score === undefined || score === null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const parsedScore = Number(score);
    if (isNaN(parsedScore) || parsedScore < 0) {
      return NextResponse.json({ error: "Invalid score" }, { status: 400 });
    }

    // Verify the assessment belongs to this class
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, classId },
      select: { id: true, totalMarks: true },
    });

    if (!assessment) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    const resolvedMaxScore = clientMaxScore && clientMaxScore > 0
      ? clientMaxScore
      : assessment.totalMarks > 0
        ? assessment.totalMarks
        : 100;

    // Find the existing submission or create one
    const existing = await prisma.submission.findFirst({
      where: { studentId, assessmentId },
      select: { id: true, score: true, maxScore: true, status: true, originalScore: true },
    });

    let updated;
    if (existing) {
      // Update the submission score, preserving originalScore for audit trail
      updated = await prisma.submission.update({
        where: { id: existing.id },
        data: {
          score: parsedScore,
          maxScore: existing.maxScore && existing.maxScore > 0 ? existing.maxScore : resolvedMaxScore,
          status: "GRADED",
          ...(existing.originalScore === null || existing.originalScore === undefined
            ? { originalScore: existing.score ?? parsedScore }
            : {}),
          adjustedBy: session.user.id,
        },
        select: { id: true, score: true, maxScore: true, status: true },
      });
    } else {
      // Create a new manual submission for this student
      updated = await prisma.submission.create({
        data: {
          studentId,
          assessmentId,
          imageUrls: "[]",
          score: parsedScore,
          maxScore: resolvedMaxScore,
          status: "GRADED",
          gradedAt: new Date(),
          adjustedBy: session.user.id,
        },
        select: { id: true, score: true, maxScore: true, status: true },
      });
    }

    invalidateClassDetailCache(classId);

    return NextResponse.json({ success: true, submission: updated });
  } catch (error) {
    console.error("Set score API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
