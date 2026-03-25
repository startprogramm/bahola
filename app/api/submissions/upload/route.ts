import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { routeAndGradeSubmission } from "@/lib/services/grading-router";
import { uploadFile, uploadFileWithLimit, generateFilename, getFileBuffer, convertDocToPdf } from "@/lib/storage";
import { deductCredit } from "@/lib/credits";
import { getUserFileLimit } from "@/lib/subscription";
import { enqueueGradingTask } from "@/lib/ai-grading-queue";
import { invalidateClassDetailCache } from "@/lib/server-cache";
import fsPromises from "fs/promises";
import pathModule from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const QUEUED_AI_FEEDBACK = "__QUEUED_AI__";
const QUEUED_MANUAL_FEEDBACK = "__QUEUED_MANUAL__";

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
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
  };
  return mimeTypes[ext.toLowerCase()] || "image/jpeg";
}

function isDocFile(mimeType: string, filename?: string): boolean {
  return (
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    (filename?.toLowerCase().endsWith(".doc") ?? false) ||
    (filename?.toLowerCase().endsWith(".docx") ?? false)
  );
}

/**
 * Split a PDF into individual page JPEG images using pdftoppm.
 * Returns an array of { buffer, mimeType, url } for each page.
 */
async function splitPdfToPageImages(
  pdfBuffer: Buffer,
  baseFilename: string
): Promise<{ buffer: Buffer; mimeType: string; url: string }[]> {
  const tmpDir = await fsPromises.mkdtemp(pathModule.join(os.tmpdir(), "pdfsplit-"));
  try {
    const pdfPath = pathModule.join(tmpDir, "input.pdf");
    await fsPromises.writeFile(pdfPath, pdfBuffer);

    const outputPrefix = pathModule.join(tmpDir, "page");
    await execFileAsync("pdftoppm", ["-jpeg", "-r", "150", "-jpegopt", "quality=85", pdfPath, outputPrefix], {
      timeout: 120_000,
    });

    const files = (await fsPromises.readdir(tmpDir))
      .filter((f) => f.startsWith("page") && f.endsWith(".jpg"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)/)?.[1] || "0");
        const numB = parseInt(b.match(/(\d+)/)?.[1] || "0");
        return numA - numB;
      });

    if (files.length === 0) return [];

    // Upload each page image
    const results: { buffer: Buffer; mimeType: string; url: string }[] = [];
    // Strip extension from base to create per-page filenames
    const baseStem = baseFilename.replace(/\.[^.]+$/, "");
    for (let i = 0; i < files.length; i++) {
      const pageBuffer = await fsPromises.readFile(pathModule.join(tmpDir, files[i]));
      const pageFilename = `${baseStem}-p${i}.jpg`;
      const url = await uploadFile(pageBuffer, pageFilename, "image/jpeg");
      results.push({ buffer: pageBuffer, mimeType: "image/jpeg", url });
    }
    return results;
  } finally {
    await fsPromises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function POST(request: NextRequest) {
  let creditDeducted = false;
  let creditTeacherId = "";

  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Determine if user is the class teacher after we load the assessment
    let isTeacher = false;

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const assessmentId = formData.get("assessmentId") as string;
    let studentId = formData.get("studentId") as string;
    const reuseImageUrlsStr = formData.get("reuseImageUrls") as string | null;

    // Get feedback language from form
    const feedbackLanguageOverride = formData.get("feedbackLanguage") as string | null;
    const useAIGradingStr = formData.get("useAIGrading") as string | null;
    const useAIGrading = useAIGradingStr !== "false"; // Default to true

    // Parse reuse URLs if provided
    let reuseImageUrls: string[] = [];
    if (reuseImageUrlsStr) {
      try {
        reuseImageUrls = JSON.parse(reuseImageUrlsStr);
      } catch {
        return NextResponse.json({ error: "Invalid reuseImageUrls format" }, { status: 400 });
      }
    }

    // Must have either files or reuse URLs
    const hasFiles = files && files.length > 0;
    const hasReuseUrls = reuseImageUrls.length > 0;

    if (!hasFiles && !hasReuseUrls) {
      return NextResponse.json({ error: "No files uploaded and no previous images to reuse" }, { status: 400 });
    }

    if (!assessmentId) {
      return NextResponse.json(
        { error: "Assessment ID required" },
        { status: 400 }
      );
    }

    if (!studentId) {
      return NextResponse.json(
        { error: "Student ID required" },
        { status: 400 }
      );
    }

    // Verify assessment exists and teacher owns the class
    // Only select the fields we need for validation and grading
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        classId: true,
        status: true,
        totalMarks: true,
        markScheme: true,
        markSchemeFileUrls: true,
        questionPaper: true,
        questionPaperFileUrls: true,
        questionMarks: true,
        ocrType: true,
        feedbackLanguage: true,
        customPrompt: true,
        showAIFeedback: true,
        showTextInput: true,
        studentsCanUpload: true,
        studentsSeeMarkScheme: true,
        studentsSeeQP: true,
        markSchemeGeminiIds: true,
        questionPaperGeminiIds: true,
        geminiFileIdsExpiresAt: true,
        geminiBatchCacheId: true,
        geminiBatchCacheExpiresAt: true,
        class: {
          select: {
            teacherId: true,
            enrollments: {
              where: { studentId: studentId },
              select: { id: true },
            },
          },
        },
      },
    });

    if (!assessment) {
      return NextResponse.json(
        { error: "Assessment not found" },
        { status: 404 }
      );
    }

    // Determine if user has teacher-level access (owner/co-teacher/director)
    isTeacher = await isUserClassTeacher(session.user.id, assessment.classId);

    // For non-teachers, they can only submit for themselves
    if (!isTeacher) {
      studentId = session.user.id;
    }

    // Verify permission: teacher owns the class OR student is submitting for themselves
    if (!isTeacher && studentId !== session.user.id) {
      return NextResponse.json(
        { error: "You don't have permission to submit for this assessment" },
        { status: 401 }
      );
    }

    // Students can only upload if the teacher has enabled it
    if (!isTeacher && !assessment.studentsCanUpload) {
      return NextResponse.json(
        { error: "Student uploads are disabled for this assessment" },
        { status: 403 }
      );
    }

    // Students cannot resubmit unless studentsCanUpload is true AND the existing
    // submission is in a terminal state (GRADED or ERROR).
    let isStudentResubmit = false;
    if (!isTeacher) {
      const existingSubmission = await prisma.submission.findUnique({
        where: { studentId_assessmentId: { studentId, assessmentId } },
        select: { id: true, status: true },
      });
      if (existingSubmission) {
        isStudentResubmit = true;
        const isTerminal = existingSubmission.status === "GRADED" || existingSubmission.status === "ERROR";
        if (!assessment.studentsCanUpload || !isTerminal) {
          return NextResponse.json(
            { error: "You have already submitted. Only your teacher can resubmit on your behalf." },
            { status: 403 }
          );
        }
      }
    }

    // Verify student is enrolled in the class
    if (assessment.class.enrollments.length === 0) {
      return NextResponse.json(
        { error: "Student is not enrolled in this class" },
        { status: 400 }
      );
    }

    // Allow queueing when assessment is still preparing (DRAFT), but block CLOSED.
    if (assessment.status === "CLOSED") {
      return NextResponse.json(
        { error: "This assessment is not accepting submissions" },
        { status: 400 }
      );
    }
    const assessmentNotReady = assessment.status !== "ACTIVE";

    // AI grading is only possible if enabled in assessment AND requested during upload.
    // Students cannot trigger re-grading of their own marks — only teachers can.
    // When a student resubmits, the submission goes to PENDING for manual teacher review.
    const effectiveUseAIGrading = isStudentResubmit
      ? false
      : assessment.showAIFeedback && useAIGrading;

    // Deduct credit upfront (atomic) to prevent race conditions with concurrent submissions.
    creditTeacherId = assessment.class.teacherId;
    if (effectiveUseAIGrading && !assessmentNotReady) {
      const creditResult = await deductCredit(creditTeacherId, `Grading submission for assessment ${assessmentId}`);
      if (!creditResult.success) {
        return NextResponse.json(
          { error: "Insufficient credits. Please upgrade your plan to continue grading." },
          { status: 402 }
        );
      }
      creditDeducted = true;
    }

    // Temporary storage for processing
    const reuseBuffers: { buffer: Buffer; mimeType: string; url: string }[] = [];
    const newFileBuffers: { buffer: Buffer; mimeType: string; url: string }[] = [];

    // 1. Process reused images (parallel)
    if (hasReuseUrls) {
      console.log(`Reusing ${reuseImageUrls.length} existing images for resubmission`);

      const reuseResults = await Promise.allSettled(
        reuseImageUrls.map(async (url) => {
          const buffer = await getFileBuffer(url);
          const ext = url.substring(url.lastIndexOf(".")).toLowerCase();
          const mimeType = getMimeTypeFromExtension(ext);
          return { buffer, mimeType, url };
        })
      );

      for (const result of reuseResults) {
        if (result.status === "rejected") {
          // File no longer exists on disk — skip it silently, don't abort the upload
          console.warn("Reuse file not found, skipping:", result.reason?.message || result.reason);
          continue;
        }
        // Split reused PDFs into page images
        if (result.value.mimeType === "application/pdf") {
          try {
            const pages = await splitPdfToPageImages(result.value.buffer, result.value.url);
            if (pages.length > 0) {
              reuseBuffers.push(...pages);
            } else {
              reuseBuffers.push(result.value);
            }
          } catch {
            reuseBuffers.push(result.value);
          }
        } else {
          reuseBuffers.push(result.value);
        }
      }
    }

    // 2. Process new files (parallel)
    if (hasFiles) {
      // Get user file size limit based on subscription tier
      const fileLimit = await getUserFileLimit(session.user.id);

      // Read all file buffers in parallel
      const fileReads = await Promise.all(
        files.map(async (file) => ({
          file,
          buffer: Buffer.from(await file.arrayBuffer()),
        }))
      );

      // Upload and convert all files in parallel
      const uploadResults = await Promise.allSettled(
        fileReads.map(async ({ file, buffer }, i) => {
          const filename = generateFilename(`submissions/${studentId}-${assessmentId}`, file.name, i);
          const { url: blobUrl, buffer: processedBuffer } = await uploadFileWithLimit(buffer, filename, file.type, fileLimit);

          // Convert Word docs to PDF for both storage URL and AI processing
          if (isDocFile(file.type, file.name)) {
            const pdfUrl = await convertDocToPdf(blobUrl);
            if (pdfUrl) {
              const pdfBuffer = await getFileBuffer(pdfUrl);
              return { buffer: pdfBuffer, mimeType: "application/pdf", url: pdfUrl };
            }
            // Fallback: use original doc buffer
            return { buffer: processedBuffer, mimeType: file.type, url: blobUrl };
          }
          return { buffer: processedBuffer, mimeType: file.type, url: blobUrl };
        })
      );

      // Collect results in order, fail on any rejection
      for (const result of uploadResults) {
        if (result.status === "rejected") {
          const error = result.reason;
          // Refund credit if deducted since we're aborting
          if (creditDeducted) {
            await prisma.user.update({ where: { id: creditTeacherId }, data: { credits: { increment: 1 } } });
            creditDeducted = false;
          }
          return NextResponse.json(
            { error: error instanceof Error ? error.message : "File upload failed" },
            { status: 400 }
          );
        }
        newFileBuffers.push(result.value);
      }
    }

    // 2b. Split any PDF files into individual page images
    // Track how each original file index maps to expanded indices
    const fileExpansionMap = new Map<number, number[]>();
    const expandedBuffers: typeof newFileBuffers = [];
    for (let origIdx = 0; origIdx < newFileBuffers.length; origIdx++) {
      const entry = newFileBuffers[origIdx];
      const startIdx = expandedBuffers.length;
      if (entry.mimeType === "application/pdf") {
        try {
          const pages = await splitPdfToPageImages(entry.buffer, entry.url);
          if (pages.length > 0) {
            expandedBuffers.push(...pages);
          } else {
            expandedBuffers.push(entry); // fallback: keep PDF as-is
          }
        } catch (err) {
          console.warn("PDF page split failed, keeping as single file:", err);
          expandedBuffers.push(entry);
        }
      } else {
        expandedBuffers.push(entry);
      }
      const endIdx = expandedBuffers.length;
      fileExpansionMap.set(origIdx, Array.from({ length: endIdx - startIdx }, (_, i) => startIdx + i));
    }
    // Replace with expanded results
    newFileBuffers.length = 0;
    newFileBuffers.push(...expandedBuffers);

    // 3. Construct final order
    let imageUrls: string[] = [];
    const buffers: { buffer: Buffer; mimeType: string }[] = [];
    
    // Check for explicit page order from frontend
    const pageOrderStr = formData.get("pageOrder") as string | null;
    
    if (pageOrderStr) {
      try {
        const pageOrder = JSON.parse(pageOrderStr) as { type: 'file' | 'reuse', index: number }[];
        
        for (const item of pageOrder) {
          if (item.type === 'reuse') {
            const data = reuseBuffers[item.index];
            if (data) {
              imageUrls.push(data.url);
              buffers.push({ buffer: data.buffer, mimeType: data.mimeType });
            }
          } else if (item.type === 'file') {
            // A single original file may have expanded into multiple pages (PDF splitting)
            const expandedIndices = fileExpansionMap.get(item.index);
            if (expandedIndices) {
              for (const idx of expandedIndices) {
                const data = newFileBuffers[idx];
                if (data) {
                  imageUrls.push(data.url);
                  buffers.push({ buffer: data.buffer, mimeType: data.mimeType });
                }
              }
            } else {
              // Fallback: direct index lookup
              const data = newFileBuffers[item.index];
              if (data) {
                imageUrls.push(data.url);
                buffers.push({ buffer: data.buffer, mimeType: data.mimeType });
              }
            }
          }
        }
      } catch (e) {
        console.warn("Failed to parse pageOrder, falling back to default order", e);
        // Fallback: Reuse then New
        reuseBuffers.forEach(b => {
          imageUrls.push(b.url);
          buffers.push({ buffer: b.buffer, mimeType: b.mimeType });
        });
        newFileBuffers.forEach(b => {
          imageUrls.push(b.url);
          buffers.push({ buffer: b.buffer, mimeType: b.mimeType });
        });
      }
    } else {
      // Default: Reuse then New
      reuseBuffers.forEach(b => {
        imageUrls.push(b.url);
        buffers.push({ buffer: b.buffer, mimeType: b.mimeType });
      });
      newFileBuffers.forEach(b => {
        imageUrls.push(b.url);
        buffers.push({ buffer: b.buffer, mimeType: b.mimeType });
      });
    }

    // Guard: ensure we have at least one file to process
    if (imageUrls.length === 0) {
      // Refund credit if deducted since we're aborting
      if (creditDeducted) {
        await prisma.user.update({ where: { id: creditTeacherId }, data: { credits: { increment: 1 } } });
        creditDeducted = false;
      }
      return NextResponse.json(
        { error: "No files to upload. Previous files may have been removed from the server." },
        { status: 400 }
      );
    }

    // Atomic delete + create to prevent race conditions on resubmission
    const submission = await prisma.$transaction(async (tx) => {
      await tx.submission.deleteMany({
        where: { studentId, assessmentId },
      });

      return tx.submission.create({
        data: {
          imageUrls: JSON.stringify(imageUrls),
          status: assessmentNotReady ? "PROCESSING" : effectiveUseAIGrading ? "PROCESSING" : "PENDING",
          gradingProgress: assessmentNotReady ? 5 : effectiveUseAIGrading ? 10 : 0,
          feedback: assessmentNotReady
            ? (effectiveUseAIGrading ? QUEUED_AI_FEEDBACK : QUEUED_MANUAL_FEEDBACK)
            : null,
          studentId: studentId,
          assessmentId,
          maxScore: assessment.totalMarks > 0 ? assessment.totalMarks : null,
        },
      });
    });

    // Use feedback language override if provided, otherwise fall back to assessment default
    const effectiveFeedbackLanguage = feedbackLanguageOverride || assessment.feedbackLanguage || "english";

    // Process grading asynchronously (only if AI grading is enabled)
    if (effectiveUseAIGrading && !assessmentNotReady) {
      const queueResult = enqueueGradingTask(submission.id, async () => {
        try {
          await routeAndGradeSubmission({
            submissionId: submission.id,
            buffers,
            assessment,
            teacherId: assessment.class.teacherId,
            creditDeducted,
            useSafeUpdate: true,
            feedbackLanguageOverride: effectiveFeedbackLanguage,
          });
        } catch (error) {
          // If the submission was deleted mid-processing, don't log a scary error
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025"
          ) {
            console.warn(`Submission ${submission.id} was deleted (resubmitted), aborting grading.`);
            return;
          }

          console.error(`Error processing submission ${submission.id}:`, error);

          let userMessage = "An error occurred while processing your submission.";
          const errorMsg = error instanceof Error ? error.message : "";

          if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('rate limit') || errorMsg.includes('quota')) {
            userMessage = "Rate limit: The AI service is temporarily overloaded. Please wait a minute and try again.";
          } else if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNRESET') || errorMsg.includes('ENOTFOUND') || errorMsg.includes('timeout')) {
            userMessage = "Connection error: Unable to reach the grading service. Please check your internet connection and try again.";
          } else if (errorMsg.includes('API key')) {
            userMessage = "Configuration error: The grading service is not properly configured. Please contact your administrator.";
          } else if (errorMsg.includes('parse') || errorMsg.includes('JSON')) {
            userMessage = "Processing error: The grading service returned an unexpected response. Please try again.";
          }

          await safeUpdateSubmission(submission.id, {
            status: "ERROR",
            feedback: userMessage,
            gradingProgress: 0,
          });

          if (creditDeducted) {
            try {
              await prisma.user.update({
                where: { id: assessment.class.teacherId },
                data: { credits: { increment: 1 } },
              });
              console.log(`Refunded 1 credit to teacher ${assessment.class.teacherId} after failed grading`);
            } catch (refundErr) {
              console.error(`Failed to refund credit to teacher ${assessment.class.teacherId}:`, refundErr);
            }
          }
        }
      });

      if (!queueResult.accepted && queueResult.reason === "queue-full") {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            status: "ERROR",
            gradingProgress: 0,
            feedback:
              "Grading queue is full right now. Please retry in a minute.",
          },
        });

        // Refund credit since grading won't run
        if (creditDeducted) {
          await prisma.user.update({
            where: { id: assessment.class.teacherId },
            data: { credits: { increment: 1 } },
          });
        }

        return NextResponse.json(
          { error: "Grading queue is full. Please retry in a minute." },
          { status: 503 }
        );
      }
    } else {
      console.log(`Submission ${submission.id} saved for manual grading (no AI processing)`);
    }

    invalidateClassDetailCache(assessment.classId);

    return NextResponse.json(
      {
        message: assessmentNotReady
          ? "Submission is processing and queued. It will continue automatically when assessment preparation finishes."
          : effectiveUseAIGrading
          ? "Submission uploaded successfully"
          : "Submission saved for manual grading",
        submission: {
          id: submission.id,
          status: submission.status,
          useAIGrading: effectiveUseAIGrading,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error uploading submission:", error);

    // Refund credit if deducted but submission/grading failed to start
    if (creditDeducted && creditTeacherId) {
      try {
        await prisma.user.update({
          where: { id: creditTeacherId },
          data: { credits: { increment: 1 } },
        });
        console.log(`Refunded 1 credit to teacher ${creditTeacherId} after upload failure`);
      } catch (refundErr) {
        console.error(`Failed to refund credit to teacher ${creditTeacherId}:`, refundErr);
      }
    }

    return NextResponse.json(
      { error: "Failed to upload submission" },
      { status: 500 }
    );
  }
}

/**
 * Safely update a submission, returning false if the record was deleted
 * (e.g. by a concurrent resubmission). Callers should abort processing
 * when this returns false.
 */
async function safeUpdateSubmission(
  submissionId: string,
  data: Parameters<typeof prisma.submission.update>[0]["data"]
): Promise<boolean> {
  try {
    await prisma.submission.update({ where: { id: submissionId }, data });
    return true;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      console.warn(`Submission ${submissionId} was deleted (resubmitted), aborting grading.`);
      return false;
    }
    throw error;
  }
}

