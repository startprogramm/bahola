import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { extractAllTextFromSubmission } from "@/lib/services/ocr-service";
import { gradeSubmissionWithText, formatFeedbackAsMarkdown, QuestionMarkInfo } from "@/lib/services/grading-service";
import { hasCredits, deductCredit } from "@/lib/credits";
import { getFileBuffer } from "@/lib/storage";
import { enqueueGradingTask } from "@/lib/ai-grading-queue";
import { invalidateClassDetailCache } from "@/lib/server-cache";

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
 * POST /api/assessments/[assessmentId]/batch-grade
 * Enqueue AI grading for all PENDING + ERROR submissions in an assessment.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assessmentId: string }> }
) {
  try {
    const session = await getAuthSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { assessmentId } = await params;

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        title: true,
        totalMarks: true,
        classId: true,
        markScheme: true,
        questionPaper: true,
        questionMarks: true,
        ocrType: true,
        feedbackLanguage: true,
        customPrompt: true,
        class: { select: { teacherId: true } },
      },
    });

    if (!assessment) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    // Verify teacher access
    if (assessment.class.teacherId !== session.user.id) {
      const hasAccess = await isUserClassTeacher(session.user.id, assessment.classId);
      if (!hasAccess) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Find all submissions that need grading (PENDING or ERROR)
    const submissions = await prisma.submission.findMany({
      where: {
        assessmentId,
        status: { in: ["PENDING", "ERROR"] },
      },
      select: { id: true, imageUrls: true },
    });

    if (submissions.length === 0) {
      return NextResponse.json({ enqueued: 0, message: "No submissions to grade" });
    }

    // Use class owner's credits (consistent with upload and ai-grade routes)
    const creditTeacherId = assessment.class.teacherId;

    // Deduct credits atomically upfront to prevent race conditions
    let creditsDeducted = 0;
    for (const _sub of submissions) {
      const creditResult = await deductCredit(creditTeacherId, `Batch grading assessment ${assessment.id}`);
      if (!creditResult.success) {
        // Refund all previously deducted credits
        if (creditsDeducted > 0) {
          try {
            await prisma.user.update({
              where: { id: creditTeacherId },
              data: { credits: { increment: creditsDeducted } },
            });
          } catch (refundErr) {
            console.error(`Failed to refund ${creditsDeducted} credits for teacher ${creditTeacherId}:`, refundErr);
          }
        }
        return NextResponse.json(
          { error: `Insufficient credits. Need ${submissions.length} credits for ${submissions.length} submissions.` },
          { status: 402 }
        );
      }
      creditsDeducted++;
    }

    // Mark all as PROCESSING and enqueue
    let enqueued = 0;
    let skipped = 0;

    await prisma.submission.updateMany({
      where: { id: { in: submissions.map((s) => s.id) } },
      data: { status: "PROCESSING", gradingProgress: 10 },
    });

    for (const sub of submissions) {
      const result = enqueueGradingTask(sub.id, async () => {
        await processSubmissionBatch(sub.id, assessment, creditTeacherId, true);
      });
      if (result.accepted) {
        enqueued++;
      } else {
        skipped++;
        // Reset status if couldn't enqueue
        await prisma.submission.update({
          where: { id: sub.id },
          data: { status: "PENDING", gradingProgress: 0 },
        });
        // Refund 1 credit for this skipped submission
        try {
          await prisma.user.update({
            where: { id: creditTeacherId },
            data: { credits: { increment: 1 } },
          });
        } catch (refundErr) {
          console.error(`Failed to refund credit for skipped submission:`, refundErr);
        }
      }
    }

    invalidateClassDetailCache(assessment.classId);

    return NextResponse.json({
      enqueued,
      skipped,
      total: submissions.length,
      message: `${enqueued} submission${enqueued !== 1 ? "s" : ""} queued for AI grading`,
    });
  } catch (error) {
    console.error("Batch grade error:", error);
    return NextResponse.json({ error: "Failed to start batch grading" }, { status: 500 });
  }
}

async function processSubmissionBatch(
  submissionId: string,
  assessment: {
    id: string;
    totalMarks: number;
    markScheme: string | null;
    questionPaper: string | null;
    questionMarks: string | null;
    ocrType: string | null;
    feedbackLanguage: string | null;
    customPrompt: string | null;
  },
  teacherId: string,
  creditDeducted: boolean = false
) {
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { imageUrls: true, extractedText: true },
    });
    if (!submission) return;

    const imageUrls = JSON.parse(submission.imageUrls || "[]") as string[];

    // Fetch image buffers
    const buffers: { buffer: Buffer; mimeType: string }[] = [];
    for (const url of imageUrls) {
      try {
        const buffer = await getFileBuffer(url);
        const ext = url.substring(url.lastIndexOf(".")).toLowerCase();
        buffers.push({ buffer, mimeType: getMimeTypeFromExtension(ext) });
      } catch {
        throw new Error(`Failed to load image: ${url}`);
      }
    }

    const feedbackLanguage = assessment.feedbackLanguage || "english";
    const markSchemeText = assessment.markScheme || "";
    const totalMarks = assessment.totalMarks;

    let questionMarks: QuestionMarkInfo[] = [];
    if (assessment.questionMarks) {
      try { questionMarks = JSON.parse(assessment.questionMarks); } catch {}
    }

    // OCR
    await prisma.submission.update({
      where: { id: submissionId },
      data: { gradingProgress: 25 },
    });

    const ocrResult = await extractAllTextFromSubmission(buffers);

    await prisma.submission.update({
      where: { id: submissionId },
      data: { extractedText: ocrResult.text, gradingProgress: 50 },
    });

    // Grade
    await prisma.submission.update({
      where: { id: submissionId },
      data: { gradingProgress: 75 },
    });

    const gradingResult = await gradeSubmissionWithText(
      ocrResult.text,
      markSchemeText,
      totalMarks,
      questionMarks.length > 0 ? questionMarks : undefined,
      feedbackLanguage,
      assessment.customPrompt,
      assessment.questionPaper
    );

    const formattedFeedback = formatFeedbackAsMarkdown(gradingResult, feedbackLanguage);

    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        score: gradingResult.score,
        maxScore: totalMarks,
        feedback: formattedFeedback,
        status: "GRADED",
        gradingProgress: 100,
        gradedAt: new Date(),
      },
    });

    console.log(`[Batch] Graded ${submissionId}: ${gradingResult.score}/${totalMarks}`);
  } catch (error) {
    console.error(`[Batch] Error grading ${submissionId}:`, error);

    let userMessage = "An error occurred while processing your submission.";
    const errorMsg = error instanceof Error ? error.message : "";
    if (errorMsg.includes("fetch failed") || errorMsg.includes("ECONNRESET")) {
      userMessage = "Connection error: Unable to reach the grading service. Please try again.";
    }

    await prisma.submission.update({
      where: { id: submissionId },
      data: { status: "ERROR", feedback: userMessage, gradingProgress: 0 },
    });

    // Refund credit since grading failed (credit was deducted upfront)
    if (creditDeducted) {
      try {
        await prisma.user.update({
          where: { id: teacherId },
          data: { credits: { increment: 1 } },
        });
        console.log(`[Batch] Refunded 1 credit to teacher ${teacherId} after failed grading`);
      } catch (refundErr) {
        console.error(`[Batch] Failed to refund credit to teacher ${teacherId}:`, refundErr);
      }
    }
  }
}
