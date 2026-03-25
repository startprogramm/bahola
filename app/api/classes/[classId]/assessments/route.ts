import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isSuperAdmin } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  extractTextFromMultipleMarkSchemeFiles,
  extractTextFromMarkSchemeFile,
  extractAllTextFromSubmission,
  isSupportedMarkSchemeType,
  getExtensionFromMimeType,
} from "@/lib/services/ocr-service";
import { gradeSubmissionWithText, formatFeedbackAsMarkdown, detectLanguage, QuestionMarkInfo } from "@/lib/services/grading-service";
import { uploadFile, uploadFileWithLimit, convertDocToPdf } from "@/lib/storage";
import { getUserFileLimit } from "@/lib/subscription";
import { getFileBuffer } from "@/lib/storage";
import { deductCredit } from "@/lib/credits";
import { enqueueGradingTask } from "@/lib/ai-grading-queue";
import { invalidateClassDetailCache } from "@/lib/server-cache";

const QUEUED_AI_FEEDBACK = "__QUEUED_AI__";
const QUEUED_MANUAL_FEEDBACK = "__QUEUED_MANUAL__";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { classId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the user has teacher-level access to this class
    const [classData, coTeacherEnrollment] = await Promise.all([
      prisma.class.findUnique({
        where: { id: classId },
        select: { id: true, teacherId: true },
      }),
      prisma.enrollment.findFirst({
        where: { classId, studentId: session.user.id, role: "TEACHER" },
        select: { id: true },
      }),
    ]);

    if (!classData) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const isOwner = classData.teacherId === session.user.id;
    const isCoTeacher = !!coTeacherEnrollment;
    const isSA = !isOwner && !isCoTeacher && await isSuperAdmin(session.user.id);
    if (!isOwner && !isCoTeacher && !isSA) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const title = formData.get("title") as string;
    const feedbackLanguageRaw = (formData.get("feedbackLanguage") as string) || "auto";
    const dueDateStr = formData.get("dueDate") as string | null;
    
    // Robust boolean parsing with explicit per-field defaults
    const parseBool = (val: FormDataEntryValue | null, defaultValue = false) => {
      if (val === null) return defaultValue;
      return val === "true" || String(val) === "true";
    };

    const enableMarkSchemeOcr = parseBool(formData.get("enableMarkSchemeOcr"));
    const showTextInput = parseBool(formData.get("showTextInput"));
    const showAIFeedback = parseBool(formData.get("showAIFeedback"));
    const studentsCanUpload = parseBool(formData.get("studentsCanUpload"), false);
    const studentsSeeMarkScheme = parseBool(formData.get("studentsSeeMarkScheme"), true);
    const studentsSeeQP = parseBool(formData.get("studentsSeeQP"), true);

    console.log("Creating assessment with toggles:", {
      studentsCanUpload,
      studentsSeeMarkScheme,
      studentsSeeQP
    });
    const manualMarkSchemeText = (formData.get("markSchemeText") as string) || "";
    const manualQuestionPaperText = (formData.get("questionPaperText") as string) || "";

    // Get custom prompt (can still be used for grading instructions)
    const customPrompt = formData.get("customPrompt") as string | null;

    // Get all mark scheme files (supports multiple files)
    const markSchemeFiles = formData.getAll("markSchemeFiles") as File[];

    // Get assessment/question paper files
    const assessmentFiles = formData.getAll("assessmentFiles") as File[];

    if (!title || title.length < 2) {
      return NextResponse.json(
        { error: "Title must be at least 2 characters" },
        { status: 400 }
      );
    }

    // Get user file size limit based on subscription tier
    const fileLimit = await getUserFileLimit(session.user.id);

    // totalMarks: 0 = auto (AI decides from mark scheme); > 0 = teacher explicitly set
    const totalMarksRaw = formData.get("totalMarks");
    const teacherTotalMarks = totalMarksRaw ? parseInt(String(totalMarksRaw), 10) : 0;
    const totalMarks = isNaN(teacherTotalMarks) || teacherTotalMarks < 0 ? 0 : teacherTotalMarks;

    const assessmentCreateData = {
      title,
      markScheme: manualMarkSchemeText || "",
      markSchemePdfUrl: null,
      markSchemeFileUrls: null,
      questionPaper: manualQuestionPaperText || null,
      questionPaperFileUrls: null,
      totalMarks, // 0 = auto (AI decides), > 0 = teacher-set
      ocrType: "all",
      feedbackLanguage: feedbackLanguageRaw === "auto" ? "english" : (feedbackLanguageRaw.trim() || "english"), // will be overridden after OCR if auto
      dueDate: dueDateStr ? new Date(dueDateStr) : null, // Optional due date
      customPrompt: customPrompt?.trim() || null, // Custom grading instructions
      status: "DRAFT" as const,
      showTextInput,
      showAIFeedback,
      studentsCanUpload,
      studentsSeeMarkScheme,
      studentsSeeQP,
      classId,
    };

    const streamPostData = (assessmentId: string) => ({
      classId,
      authorId: session.user.id,
      content: `New assessment posted: ${title}`,
      attachments: JSON.stringify([{ type: "assessment", id: assessmentId, title }]),
    });

    let assessment;

    if (showAIFeedback) {
      try {
        assessment = await prisma.$transaction(async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: session.user.id },
            select: { credits: true, subscription: true, subscriptionExpiresAt: true },
          });

          if (!user) {
            throw new Error("USER_NOT_FOUND");
          }

          const isExpired = user.subscriptionExpiresAt && user.subscriptionExpiresAt < new Date();
          const hasUnlimitedCredits = (user.subscription === "PRO" || user.subscription === "MAX") && !isExpired;

          if (!hasUnlimitedCredits && user.credits < 1) {
            throw new Error("INSUFFICIENT_CREDITS");
          }

          if (hasUnlimitedCredits) {
            await tx.creditTransaction.create({
              data: {
                userId: session.user.id,
                amount: 0,
                type: "USAGE",
                description: `Created AI assessment ${title} (unlimited plan)`,
                balanceAfter: user.credits,
              },
            });
          } else {
            const updatedUser = await tx.user.update({
              where: { id: session.user.id },
              data: { credits: { decrement: 1 } },
              select: { credits: true },
            });

            await tx.creditTransaction.create({
              data: {
                userId: session.user.id,
                amount: -1,
                type: "USAGE",
                description: `Created AI assessment ${title}`,
                balanceAfter: updatedUser.credits,
              },
            });
          }

          const createdAssessment = await tx.assessment.create({
            data: assessmentCreateData,
          });

          await tx.streamPost.create({
            data: streamPostData(createdAssessment.id),
          });

          return createdAssessment;
        });
      } catch (error) {
        if (error instanceof Error && error.message === "INSUFFICIENT_CREDITS") {
          return NextResponse.json(
            { error: "Insufficient credits. Disable AI feedback or upgrade your plan." },
            { status: 402 }
          );
        }
        if (error instanceof Error && error.message === "USER_NOT_FOUND") {
          return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        throw error;
      }
    } else {
      assessment = await prisma.assessment.create({
        data: assessmentCreateData,
      });

      // Create a stream post about the new assessment
      await prisma.streamPost.create({
        data: streamPostData(assessment.id),
      });
    }

    invalidateClassDetailCache(classId);

    // Process uploads and OCR in the background, then activate assessment and drain queued submissions.
    void processAssessmentAssetsAndActivate({
      assessmentId: assessment.id,
      classId,
      teacherId: classData.teacherId,
      manualMarkSchemeText,
      manualQuestionPaperText,
      enableMarkSchemeOcr,
      markSchemeFiles,
      assessmentFiles,
      fileLimit,
      feedbackLanguageRaw,
    });

    return NextResponse.json(
      { message: "Assessment created successfully", assessment },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating assessment:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create assessment: ${errorMessage}` },
      { status: 500 }
    );
  }
}

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

async function processAssessmentAssetsAndActivate(args: {
  assessmentId: string;
  classId: string;
  teacherId: string;
  manualMarkSchemeText: string;
  manualQuestionPaperText: string;
  enableMarkSchemeOcr: boolean;
  markSchemeFiles: File[];
  assessmentFiles: File[];
  fileLimit: number;
  feedbackLanguageRaw?: string;
}) {
  const {
    assessmentId,
    classId,
    teacherId,
    manualMarkSchemeText,
    manualQuestionPaperText,
    enableMarkSchemeOcr,
    markSchemeFiles,
    assessmentFiles,
    fileLimit,
    feedbackLanguageRaw = "auto",
  } = args;

  try {
    let savedFileUrls: string[] = [];
    let markSchemeText = manualMarkSchemeText || "";

    const validMsFiles = (markSchemeFiles || []).filter((f) => f.size > 0);
    for (const file of validMsFiles) {
      if (!isSupportedMarkSchemeType(file.type)) {
        throw new Error(`Unsupported mark scheme type: ${file.type}`);
      }
    }

    if (validMsFiles.length > 0) {
      const fileBuffers: { buffer: Buffer; mimeType: string; filename: string }[] = [];
      for (let i = 0; i < validMsFiles.length; i++) {
        const file = validMsFiles[i];
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const extension = getExtensionFromMimeType(file.type) || file.name.substring(file.name.lastIndexOf(".")) || ".bin";
        const filename = `markschemes/${classId}-${Date.now()}-${i}${extension}`;
        const { url, buffer: processedBuffer } = await uploadFileWithLimit(buffer, filename, file.type, fileLimit);
        savedFileUrls.push(url);
        fileBuffers.push({ buffer: processedBuffer, mimeType: file.type, filename: file.name });
      }

      // Run OCR and Word-to-PDF conversion in parallel
      const ocrPromise = enableMarkSchemeOcr
        ? (fileBuffers.length === 1
            ? extractTextFromMarkSchemeFile(fileBuffers[0].buffer, fileBuffers[0].mimeType)
            : extractTextFromMultipleMarkSchemeFiles(fileBuffers))
        : Promise.resolve("");

      // Convert any Word docs to PDF for preview (non-blocking)
      const conversionPromises = savedFileUrls.map(async (url) => {
        const lower = url.toLowerCase();
        if (lower.endsWith(".doc") || lower.endsWith(".docx")) {
          const pdfUrl = await convertDocToPdf(url);
          return pdfUrl ? { original: url, pdf: pdfUrl } : null;
        }
        return null;
      });

      const [ocrText, ...conversionResults] = await Promise.all([ocrPromise, ...conversionPromises]);

      if (ocrText) markSchemeText = markSchemeText ? `${markSchemeText}\n\n${ocrText}` : ocrText;

      // Replace Word doc URLs with PDF URLs for preview
      for (const result of conversionResults) {
        if (result) {
          const idx = savedFileUrls.indexOf(result.original);
          if (idx !== -1) {
            savedFileUrls[idx] = result.pdf;
          }
        }
      }
    }

    let assessmentFileUrls: string[] = [];
    let assessmentContent = manualQuestionPaperText || "";
    const validQpFiles = (assessmentFiles || []).filter((f) => f.size > 0);

    for (let i = 0; i < validQpFiles.length; i++) {
      const file = validQpFiles[i];
      if (!isSupportedMarkSchemeType(file.type)) continue;
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const extension = getExtensionFromMimeType(file.type) || file.name.substring(file.name.lastIndexOf(".")) || ".bin";
      const filename = `assessments/${classId}-${Date.now()}-${i}${extension}`;
      const { url, buffer: processedBuffer } = await uploadFileWithLimit(buffer, filename, file.type, fileLimit);
      assessmentFileUrls.push(url);

      if (enableMarkSchemeOcr) {
        try {
          const qpText = await extractTextFromMarkSchemeFile(processedBuffer, file.type);
          if (qpText) {
            assessmentContent = assessmentContent ? `${assessmentContent}\n\n${qpText}` : qpText;
          }
        } catch {
          // continue
        }
      }
    }

    // Determine feedback language: use teacher's explicit choice, or auto-detect from content
    const isAuto = !feedbackLanguageRaw || feedbackLanguageRaw === "auto";
    const textForDetection = assessmentContent || markSchemeText || "";
    let resolvedFeedbackLanguage: string;
    if (isAuto && textForDetection.trim().length >= 20) {
      resolvedFeedbackLanguage = await detectLanguage(textForDetection);
    } else if (isAuto) {
      resolvedFeedbackLanguage = "english";
    } else {
      resolvedFeedbackLanguage = feedbackLanguageRaw.trim().toLowerCase();
    }

    await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        markScheme: markSchemeText || "",
        markSchemePdfUrl: savedFileUrls.length > 0 ? savedFileUrls[0] : null,
        markSchemeFileUrls: savedFileUrls.length > 0 ? JSON.stringify(savedFileUrls) : null,
        questionPaper: assessmentContent || null,
        questionPaperFileUrls: assessmentFileUrls.length > 0 ? JSON.stringify(assessmentFileUrls) : null,
        status: "ACTIVE",
        feedbackLanguage: resolvedFeedbackLanguage,
      },
    });

    await processQueuedSubmissionsForAssessment(assessmentId, teacherId);
  } catch (error) {
    console.error(`Assessment background setup failed for ${assessmentId}:`, error);
    // Still activate the assessment so submissions don't get stuck in DRAFT limbo
    try {
      await prisma.assessment.update({
        where: { id: assessmentId },
        data: { status: "ACTIVE" },
      });
      await processQueuedSubmissionsForAssessment(assessmentId, teacherId);
    } catch (activateErr) {
      console.error(`Failed to activate assessment ${assessmentId} after error:`, activateErr);
    }
  }
}

async function processQueuedSubmissionsForAssessment(assessmentId: string, teacherId: string) {
  const queued = await prisma.submission.findMany({
    where: {
      assessmentId,
      status: {
        in: ["PENDING", "PROCESSING"],
      },
      feedback: {
        in: [QUEUED_AI_FEEDBACK, QUEUED_MANUAL_FEEDBACK],
      },
    },
    select: { id: true, feedback: true },
  });

  for (const item of queued) {
    if (item.feedback === QUEUED_MANUAL_FEEDBACK) {
      void prisma.submission
        .update({
          where: { id: item.id },
          data: {
            status: "PENDING",
            gradingProgress: 0,
            feedback: null,
          },
        })
        .catch((error) => {
          console.error(`Failed to release queued manual submission ${item.id}:`, error);
        });
      continue;
    }

    const queueResult = enqueueGradingTask(item.id, async () => {
      await processQueuedSubmission(item.id, teacherId);
    });

    if (!queueResult.accepted && queueResult.reason === "queue-full") {
      void prisma.submission
        .update({
          where: { id: item.id },
          data: {
            status: "ERROR",
            gradingProgress: 0,
            feedback: "Grading queue is full right now. Please retry in a minute.",
          },
        })
        .catch((error) => {
          console.error(`Failed to mark queue overflow for ${item.id}:`, error);
        });
    }
  }
}

/** Safe update that returns false if submission was deleted (P2025). */
async function safeUpdateQueuedSubmission(
  submissionId: string,
  data: Parameters<typeof prisma.submission.update>[0]["data"]
): Promise<boolean> {
  try {
    await prisma.submission.update({ where: { id: submissionId }, data });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      console.warn(`Queued submission ${submissionId} was deleted, aborting.`);
      return false;
    }
    throw error;
  }
}

async function processQueuedSubmission(submissionId: string, teacherId: string) {
  let creditDeducted = false;
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assessment: {
          select: {
            totalMarks: true,
            markScheme: true,
            questionPaper: true,
            questionMarks: true,
            feedbackLanguage: true,
            customPrompt: true,
          },
        },
      },
    });

    if (!submission) return;

    // Atomic credit deduction upfront (prevents race condition with hasCredits + late deductCredit)
    const creditResult = await deductCredit(teacherId, `Queued grading ${submissionId}`);
    if (!creditResult.success) {
      await safeUpdateQueuedSubmission(submissionId, {
        status: "ERROR",
        gradingProgress: 0,
        feedback: "Insufficient credits. Please upgrade your plan to continue grading.",
      });
      return;
    }
    creditDeducted = true;

    if (!await safeUpdateQueuedSubmission(submissionId, { status: "PROCESSING", gradingProgress: 10, feedback: null })) return;

    const imageUrls = JSON.parse(submission.imageUrls || "[]") as string[];
    const buffers: { buffer: Buffer; mimeType: string }[] = [];
    for (const url of imageUrls) {
      const buffer = await getFileBuffer(url);
      const ext = url.substring(url.lastIndexOf(".")).toLowerCase();
      buffers.push({ buffer, mimeType: getMimeTypeFromExtension(ext) });
    }

    if (!await safeUpdateQueuedSubmission(submissionId, { gradingProgress: 25 })) return;

    const ocrResult = await extractAllTextFromSubmission(buffers);

    if (!await safeUpdateQueuedSubmission(submissionId, { extractedText: ocrResult.text, gradingProgress: 75 })) return;

    let questionMarks: QuestionMarkInfo[] = [];
    if (submission.assessment.questionMarks) {
      try {
        questionMarks = JSON.parse(submission.assessment.questionMarks);
      } catch {
        questionMarks = [];
      }
    }

    const gradingResult = await gradeSubmissionWithText(
      ocrResult.text,
      submission.assessment.markScheme || "",
      submission.assessment.totalMarks,
      questionMarks.length > 0 ? questionMarks : undefined,
      submission.assessment.feedbackLanguage || "english",
      submission.assessment.customPrompt,
      submission.assessment.questionPaper
    );
    const formatted = formatFeedbackAsMarkdown(gradingResult, submission.assessment.feedbackLanguage || "english");

    // Use totalMarks if teacher set it, otherwise trust AI result
    const finalMaxScore = submission.assessment.totalMarks > 0
      ? submission.assessment.totalMarks
      : gradingResult.maxScore;
    // Clamp score to not exceed maxScore
    const finalScore = Math.min(gradingResult.score, finalMaxScore);

    await safeUpdateQueuedSubmission(submissionId, {
      score: finalScore,
      maxScore: finalMaxScore,
      feedback: formatted,
      status: "GRADED",
      gradingProgress: 100,
      gradedAt: new Date(),
    });
  } catch (error) {
    // Silently handle deleted submissions
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      console.warn(`Queued submission ${submissionId} was deleted, aborting.`);
      return;
    }

    console.error(`Queued grading failed for ${submissionId}:`, error);
    await safeUpdateQueuedSubmission(submissionId, {
      status: "ERROR",
      gradingProgress: 0,
      feedback: "Queued grading failed. Please retry AI grading.",
    });

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
