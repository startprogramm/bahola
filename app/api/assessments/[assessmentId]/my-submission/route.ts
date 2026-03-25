import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assessmentId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { assessmentId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const submission = await prisma.submission.findUnique({
      where: {
        studentId_assessmentId: {
          studentId: session.user.id,
          assessmentId,
        },
      },
      include: {
        assessment: {
          select: {
            id: true,
            title: true,
            markScheme: true,
            markSchemePdfUrl: true,
            markSchemeFileUrls: true, // Include mark scheme images
            totalMarks: true,
            showAIFeedback: true,
            showTextInput: true,
            studentsSeeMarkScheme: true,
            studentsSeeQP: true,
            class: {
              select: { id: true, name: true },
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

    // Check if viewer is a teacher for this class
    const isTeacher = await isUserClassTeacher(session.user.id, submission.assessment.class.id);

    // Security: Hide extracted text from students
    submission.extractedText = null;

    return NextResponse.json({ submission, isTeacher }, {
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
