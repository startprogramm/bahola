import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { extractHandwrittenFromSubmission, extractAllTextFromSubmission } from "@/lib/services/ocr-service";
import { gradeSubmissionWithText, formatFeedbackAsMarkdown, QuestionMarkInfo } from "@/lib/services/grading-service";
import { deductCredit } from "@/lib/credits";
import { getFileBuffer } from "@/lib/storage";
import { enqueueGradingTask } from "@/lib/ai-grading-queue";

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

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { submissionIds } = body;

    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
      return NextResponse.json(
        { error: "submissionIds must be a non-empty array" },
        { status: 400 }
      );
    }

    // Verify all submissions belong to teacher's classes and get full details
    const submissions = await prisma.submission.findMany({
      where: {
        id: { in: submissionIds },
        assessment: {
          class: {
            OR: [
              { teacherId: session.user.id },
              {
                enrollments: {
                  some: {
                    studentId: session.user.id,
                    role: "TEACHER",
                  },
                },
              },
            ],
          },
        },
      },
      include: {
        assessment: {
          select: {
            id: true,
            totalMarks: true,
            markScheme: true,
            questionPaper: true,
            questionMarks: true,
            ocrType: true,
            feedbackLanguage: true,
            customPrompt: true,
            class: {
              select: { teacherId: true },
            },
          },
        },
      },
    });

    if (submissions.length !== submissionIds.length) {
      return NextResponse.json(
        { error: "One or more submissions not found or unauthorized" },
        { status: 403 }
      );
    }

    // Filter out submissions that are already processing
    const validSubmissions = submissions.filter((s) => s.status !== "PROCESSING");

    if (validSubmissions.length === 0) {
      return NextResponse.json(
        { error: "All selected submissions are already being processed" },
        { status: 400 }
      );
    }

    // Deduct credits atomically upfront for each submission
    // Use class teacher (owner) for credit deduction, not the requesting user
    let creditsDeducted = 0;
    const creditTeacherIds: Map<string, string> = new Map(); // submissionId -> teacherId
    for (const submission of validSubmissions) {
      const classTeacherId = submission.assessment.class.teacherId;
      creditTeacherIds.set(submission.id, classTeacherId);
      const creditResult = await deductCredit(classTeacherId, `AI graded submission ${submission.id}`);
      if (!creditResult.success) {
        // Refund all previously deducted credits
        if (creditsDeducted > 0) {
          // Group refunds by teacher
          const refundCounts: Record<string, number> = {};
          for (const [subId] of Array.from(creditTeacherIds.entries()).slice(0, creditsDeducted)) {
            const tid = creditTeacherIds.get(subId)!;
            refundCounts[tid] = (refundCounts[tid] || 0) + 1;
          }
          for (const [tid, count] of Object.entries(refundCounts)) {
            try {
              await prisma.user.update({
                where: { id: tid },
                data: { credits: { increment: count } },
              });
            } catch (refundErr) {
              console.error(`Failed to refund ${count} credits for teacher ${tid}:`, refundErr);
            }
          }
        }
        return NextResponse.json(
          { error: "Insufficient credits. Please upgrade your plan to continue grading." },
          { status: 402 }
        );
      }
      creditsDeducted++;
    }

    // Update all valid submissions to PROCESSING status
    await prisma.submission.updateMany({
      where: {
        id: { in: validSubmissions.map((s) => s.id) },
      },
      data: {
        status: "PROCESSING",
        gradingProgress: 10,
      },
    });

    const queueFullIds: string[] = [];

    // Queue each submission for async AI grading
    for (const submission of validSubmissions) {
      const classTeacherId = creditTeacherIds.get(submission.id)!;
      const queueResult = enqueueGradingTask(submission.id, async () => {
        await processSubmissionWithAI(submission.id, submission, classTeacherId, true);
      });

      if (!queueResult.accepted && queueResult.reason === "queue-full") {
        queueFullIds.push(submission.id);
      }
    }

    if (queueFullIds.length > 0) {
      await prisma.submission.updateMany({
        where: {
          id: { in: queueFullIds },
        },
        data: {
          status: "ERROR",
          gradingProgress: 0,
          feedback: "Grading queue is full right now. Please retry in a minute.",
        },
      });
      // Refund credits for queue-full submissions
      const refundCounts: Record<string, number> = {};
      for (const subId of queueFullIds) {
        const tid = creditTeacherIds.get(subId)!;
        refundCounts[tid] = (refundCounts[tid] || 0) + 1;
      }
      for (const [tid, count] of Object.entries(refundCounts)) {
        try {
          await prisma.user.update({
            where: { id: tid },
            data: { credits: { increment: count } },
          });
        } catch (refundErr) {
          console.error(`Failed to refund ${count} credits for teacher ${tid}:`, refundErr);
        }
      }
    }

    const queuedCount = validSubmissions.length - queueFullIds.length;

    return NextResponse.json({
      success: true,
      count: queuedCount,
      rejectedCount: queueFullIds.length,
      message:
        queueFullIds.length > 0
          ? `${queuedCount} submission${queuedCount !== 1 ? "s" : ""} queued. ${queueFullIds.length} could not be queued because the queue is full.`
          : `${queuedCount} submission${queuedCount !== 1 ? "s" : ""} queued for AI grading`,
    });
  } catch (error) {
    console.error("Error starting bulk grading:", error);
    return NextResponse.json(
      { error: "Failed to start bulk grading" },
      { status: 500 }
    );
  }
}

/**
 * Process single submission with AI grading (same logic as ai-grade route)
 */
async function processSubmissionWithAI(
  submissionId: string,
  submission: any,
  teacherId: string,
  creditDeducted: boolean = false
) {
  try {
    const imageUrls = JSON.parse(submission.imageUrls || "[]") as string[];

    // Fetch image buffers
    const buffers: { buffer: Buffer; mimeType: string }[] = [];
    for (const url of imageUrls) {
      try {
        const buffer = await getFileBuffer(url);
        const ext = url.substring(url.lastIndexOf(".")).toLowerCase();
        const mimeType = getMimeTypeFromExtension(ext);
        buffers.push({ buffer, mimeType });
      } catch (error) {
        console.error(`Failed to fetch file ${url}:`, error);
        throw new Error(`Failed to load image: ${url}`);
      }
    }

    // Get assessment details
    const assessment = submission.assessment;
    const ocrType = assessment.ocrType || "handwritten";
    const feedbackLanguage = assessment.feedbackLanguage || "english";
    const markSchemeText = assessment.markScheme || "";
    const totalMarks = assessment.totalMarks;

    // Parse question marks if available
    let questionMarks: QuestionMarkInfo[] = [];
    if (assessment.questionMarks) {
      try {
        questionMarks = JSON.parse(assessment.questionMarks);
      } catch {
        console.warn("Failed to parse question marks JSON");
      }
    }

    // Extract text using OCR
    console.log(`AI grading submission ${submissionId}: extracting all text...`);

    // Update progress: Starting OCR
    await prisma.submission.update({
      where: { id: submissionId },
      data: { gradingProgress: 25 },
    });

    const ocrResult = await extractAllTextFromSubmission(buffers);

    // Update submission with extracted text
    await prisma.submission.update({
      where: { id: submissionId },
      data: { extractedText: ocrResult.text, gradingProgress: 50 },
    });

    // Grade using AI
    console.log(`AI grading submission ${submissionId} with Gemini (language: ${feedbackLanguage})...`);

    // Update progress: Starting grading
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
      submission.assessment.customPrompt,
      submission.assessment.questionPaper
    );

    // Format feedback
    const formattedFeedback = formatFeedbackAsMarkdown(gradingResult, feedbackLanguage);

    // Use totalMarks if teacher set it, otherwise trust AI result
    const finalMaxScore = totalMarks > 0 ? totalMarks : gradingResult.maxScore;
    const finalScore = Math.min(gradingResult.score, finalMaxScore);

    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        score: finalScore,
        maxScore: finalMaxScore,
        feedback: formattedFeedback,
        status: "GRADED",
        gradingProgress: 100,
        gradedAt: new Date(),
      },
    });

    console.log(`AI grading complete for ${submissionId}: ${finalScore}/${finalMaxScore}`);
  } catch (error) {
    console.error(`Error in AI grading submission ${submissionId}:`, error);

    // Create user-friendly error message
    let userMessage = "An error occurred while processing your submission.";
    const errorMsg = error instanceof Error ? error.message : "";

    if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNRESET')) {
      userMessage = "Connection error: Unable to reach the grading service. Please try again.";
    } else if (errorMsg.includes('API key')) {
      userMessage = "Configuration error: The grading service is not properly configured.";
    }

    // Update status to ERROR
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
    if (creditDeducted) {
      try {
        await prisma.user.update({
          where: { id: teacherId },
          data: { credits: { increment: 1 } },
        });
      } catch (refundErr) {
        console.error(`Failed to refund credit for teacher ${teacherId}:`, refundErr);
      }
    }
  }
}
