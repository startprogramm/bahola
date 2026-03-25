import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { routeAndGradeSubmission } from "@/lib/services/grading-router";
import { deductCredit } from "@/lib/credits";
import { getFileBuffer } from "@/lib/storage";
import { enqueueGradingTask } from "@/lib/ai-grading-queue";
import { invalidateClassDetailCache } from "@/lib/server-cache";

/**
 * Get MIME type from file extension
 */
function getMimeTypeFromExtension(ext: string): string {
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".svg": "image/svg+xml",
  };
  return mimeTypes[ext.toLowerCase()] || "image/jpeg";
}

/**
 * POST /api/submissions/[submissionId]/ai-grade
 * Trigger AI grading for a submission (can be used on PENDING or already GRADED)
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

    // Find the submission with assessment details
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assessment: {
          select: {
            id: true,
            totalMarks: true,
            classId: true,
            markScheme: true,
            markSchemeFileUrls: true,
            questionPaper: true,
            questionPaperFileUrls: true,
            questionMarks: true,
            ocrType: true,
            feedbackLanguage: true,
            customPrompt: true,
            markSchemeGeminiIds: true,
            questionPaperGeminiIds: true,
            geminiFileIdsExpiresAt: true,
            geminiBatchCacheId: true,
            geminiBatchCacheExpiresAt: true,
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

    // Check if submission is being processed
    if (submission.status === "PROCESSING") {
      return NextResponse.json({ error: "This submission is already being processed" }, { status: 400 });
    }

    // Deduct credit atomically upfront (prevents race condition with check-then-act)
    const creditTeacherId = submission.assessment.class.teacherId;
    const creditResult = await deductCredit(creditTeacherId, `AI graded submission ${submissionId}`);
    if (!creditResult.success) {
      return NextResponse.json(
        { error: "Insufficient credits. Please upgrade your plan to continue grading." },
        { status: 402 }
      );
    }

    // Update status to PROCESSING
    await prisma.submission.update({
      where: { id: submissionId },
      data: { status: "PROCESSING", gradingProgress: 10 },
    });

    const queueResult = enqueueGradingTask(submissionId, async () => {
      try {
        // Fetch image buffers from stored URLs
        const imageUrls = JSON.parse(submission.imageUrls || "[]") as string[];
        const buffers: { buffer: Buffer; mimeType: string }[] = [];
        for (const url of imageUrls) {
          const buffer = await getFileBuffer(url);
          const ext = url.substring(url.lastIndexOf(".")).toLowerCase();
          const mimeType = getMimeTypeFromExtension(ext);
          buffers.push({ buffer, mimeType });
        }

        await routeAndGradeSubmission({
          submissionId,
          buffers,
          assessment: submission.assessment,
          teacherId: creditTeacherId,
          creditDeducted: true,
        });
      } catch (error) {
        console.error(`Error in AI grading submission ${submissionId}:`, error);

        let userMessage = "An error occurred while processing your submission.";
        const errorMsg = error instanceof Error ? error.message : "";

        if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNRESET')) {
          userMessage = "Connection error: Unable to reach the grading service. Please try again.";
        } else if (errorMsg.includes('API key')) {
          userMessage = "Configuration error: The grading service is not properly configured.";
        } else if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('rate limit')) {
          userMessage = "Rate limit: The AI service is temporarily overloaded. Please wait a minute and try again.";
        }

        try {
          await prisma.submission.update({
            where: { id: submissionId },
            data: {
              status: "ERROR",
              feedback: userMessage,
              gradingProgress: 0,
            },
          });
        } catch (updateErr) {
          console.warn(`Could not update submission ${submissionId} to ERROR:`, updateErr);
        }

        // Refund credit since grading failed
        try {
          await prisma.user.update({
            where: { id: creditTeacherId },
            data: { credits: { increment: 1 } },
          });
        } catch (refundErr) {
          console.error(`Failed to refund credit for teacher ${creditTeacherId}:`, refundErr);
        }
      }
    });

    if (!queueResult.accepted && queueResult.reason === "queue-full") {
      // Refund credit since grading won't happen
      try {
        await prisma.user.update({
          where: { id: creditTeacherId },
          data: { credits: { increment: 1 } },
        });
      } catch (refundErr) {
        console.error(`Failed to refund credit for teacher ${creditTeacherId}:`, refundErr);
      }

      await prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: "ERROR",
          gradingProgress: 0,
          feedback: "Grading queue is full right now. Please retry in a minute.",
        },
      });

      return NextResponse.json(
        { error: "Grading queue is full. Please retry in a minute." },
        { status: 503 }
      );
    }

    invalidateClassDetailCache(submission.assessment.classId);

    return NextResponse.json({
      message: "AI grading started",
      submission: { id: submissionId, status: "PROCESSING" }
    });
  } catch (error) {
    console.error("Error starting AI grading:", error);
    return NextResponse.json({ error: "Failed to start AI grading" }, { status: 500 });
  }
}
