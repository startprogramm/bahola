/**
 * Grading Router — Shared three-tier grading logic
 *
 * Determines the optimal grading path for a submission and executes it:
 *   Tier 1: Per-question visual grading (questionMarks configured, MS/QP files)
 *   Tier 2: Holistic visual grading (MS/QP files, no per-question breakdown)
 *   Tier 3: Text OCR fallback (text-only mark scheme, no files)
 *
 * Used by both the upload route (initial submission) and the ai-grade route (re-grade).
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { extractAllTextFromSubmission } from "@/lib/services/ocr-service";
import { gradeSubmissionWithText, formatFeedbackAsMarkdown, type QuestionMarkInfo } from "@/lib/services/grading-service";
import { uploadLocalUrlsToGemini, uploadBufferToGemini, type GeminiFileRef } from "@/lib/services/gemini-files-service";
import { getOrCreateBatchCache, type AssessmentFileRefs } from "@/lib/services/gemini-cache-service";
import { mapStudentPages, applyConfidenceFallback } from "@/lib/services/mapper-service";
import { gradeSubmissionMultimodal, gradeSubmissionHolisticCached, type PerQuestionInput } from "@/lib/services/multimodal-grading-service";

export interface GradingRouterInput {
  submissionId: string;
  /** Pre-loaded image buffers (already in memory from upload or fetched from disk) */
  buffers: { buffer: Buffer; mimeType: string }[];
  /** The assessment record — must include all grading-related fields */
  assessment: {
    id: string;
    markScheme: string | null;
    markSchemeFileUrls: string | null;
    questionPaper: string | null;
    questionPaperFileUrls: string | null;
    questionMarks: string | null;
    totalMarks: number;
    ocrType: string | null;
    feedbackLanguage: string | null;
    customPrompt: string | null;
    markSchemeGeminiIds: string | null;
    questionPaperGeminiIds: string | null;
    geminiFileIdsExpiresAt: Date | null;
    geminiBatchCacheId: string | null;
    geminiBatchCacheExpiresAt: Date | null;
  };
  teacherId: string;
  creditDeducted: boolean;
  /** If provided, use safeUpdate pattern (returns false if submission was deleted) */
  useSafeUpdate?: boolean;
  /** Override feedback language (e.g. from upload form) */
  feedbackLanguageOverride?: string;
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

/** Wrapper that either uses safe update or direct update based on config */
async function updateSubmission(
  submissionId: string,
  data: Parameters<typeof prisma.submission.update>[0]["data"],
  useSafe: boolean
): Promise<boolean> {
  if (useSafe) {
    return safeUpdateSubmission(submissionId, data);
  }
  await prisma.submission.update({ where: { id: submissionId }, data });
  return true;
}

/**
 * Route and execute grading for a submission through the appropriate tier.
 * Throws on failure — caller is responsible for ERROR status + credit refund.
 */
export async function routeAndGradeSubmission(input: GradingRouterInput): Promise<void> {
  const {
    submissionId,
    buffers,
    assessment,
    teacherId,
    creditDeducted,
    useSafeUpdate = false,
    feedbackLanguageOverride,
  } = input;

  const feedbackLanguage = feedbackLanguageOverride || assessment.feedbackLanguage || "english";
  const markSchemeText = assessment.markScheme || "";
  const totalMarks = assessment.totalMarks;

  // Parse question marks — used to auto-select grading path
  let questionMarks: QuestionMarkInfo[] = [];
  if (assessment.questionMarks) {
    try {
      questionMarks = JSON.parse(assessment.questionMarks);
    } catch {
      console.warn("Failed to parse question marks JSON");
    }
  }

  const markSchemeFileUrls = JSON.parse(assessment.markSchemeFileUrls || "[]") as string[];
  const questionPaperFileUrls = JSON.parse(assessment.questionPaperFileUrls || "[]") as string[];
  const hasCacheableFiles = markSchemeFileUrls.length > 0 || questionPaperFileUrls.length > 0;

  // ── Tier 1: Per-question visual grading (question marks configured) ──────
  if (questionMarks.length > 0 && hasCacheableFiles) {
    console.log(`[Multimodal] Starting per-question grading for submission ${submissionId}`);
    await processMultimodalGrading(submissionId, buffers, assessment, feedbackLanguage, totalMarks, useSafeUpdate);
    return;
  }

  // ── Tier 2: Holistic visual grading (MS/QP files, no question breakdown) ─
  if (hasCacheableFiles) {
    console.log(`[Holistic] Starting holistic cached grading for submission ${submissionId}`);
    await processHolisticGrading(submissionId, buffers, assessment, feedbackLanguage, totalMarks, useSafeUpdate);
    return;
  }

  // ── Tier 3: Text OCR fallback (text-only mark scheme, no files) ──────────
  console.log(`AI grading submission ${submissionId}: extracting all text...`);

  if (!await updateSubmission(submissionId, { gradingProgress: 25 }, useSafeUpdate)) return;

  const ocrResult = await extractAllTextFromSubmission(buffers);

  if (!await updateSubmission(submissionId, {
    extractedText: ocrResult.text,
    gradingProgress: 50,
  }, useSafeUpdate)) return;

  console.log(`AI grading submission ${submissionId} with Gemini (language: ${feedbackLanguage})...`);

  if (!await updateSubmission(submissionId, { gradingProgress: 75 }, useSafeUpdate)) return;

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
  const finalMaxScore = totalMarks > 0 ? totalMarks : gradingResult.maxScore;
  const finalScore = Math.min(gradingResult.score, finalMaxScore);

  await updateSubmission(submissionId, {
    score: finalScore,
    maxScore: finalMaxScore,
    feedback: formattedFeedback,
    status: "GRADED",
    gradingProgress: 100,
    gradedAt: new Date(),
  }, useSafeUpdate);

  console.log(`AI grading complete for ${submissionId}: ${finalScore}/${finalMaxScore}`);
}

/**
 * Tier 1: Per-question visual grading with mapper + ECF.
 */
async function processMultimodalGrading(
  submissionId: string,
  buffers: { buffer: Buffer; mimeType: string }[],
  assessment: GradingRouterInput["assessment"],
  feedbackLanguage: string,
  totalMarks: number,
  useSafeUpdate: boolean
) {
  const assessmentId = assessment.id;
  const now = new Date();

  // ── Step 1: Ensure MS + QP files are uploaded to Gemini Files API ──────────
  const filesExpired =
    !assessment.geminiFileIdsExpiresAt ||
    new Date(assessment.geminiFileIdsExpiresAt) <= now;

  let markSchemeRefs: GeminiFileRef[];
  let questionPaperRefs: GeminiFileRef[];

  if (filesExpired) {
    const markSchemeUrls = JSON.parse(assessment.markSchemeFileUrls || "[]") as string[];
    const questionPaperUrls = JSON.parse(assessment.questionPaperFileUrls || "[]") as string[];

    markSchemeRefs = markSchemeUrls.length > 0
      ? await uploadLocalUrlsToGemini(markSchemeUrls, `ms-${assessmentId}`)
      : [];

    questionPaperRefs = questionPaperUrls.length > 0
      ? await uploadLocalUrlsToGemini(questionPaperUrls, `qp-${assessmentId}`)
      : [];

    const expiresAt = new Date(now.getTime() + 47 * 60 * 60 * 1000);
    await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        markSchemeGeminiIds: JSON.stringify(markSchemeRefs),
        questionPaperGeminiIds: JSON.stringify(questionPaperRefs),
        geminiFileIdsExpiresAt: expiresAt,
      },
    });

    console.log(`[Multimodal] Uploaded ${markSchemeRefs.length} MS + ${questionPaperRefs.length} QP files to Gemini for assessment ${assessmentId}`);
  } else {
    markSchemeRefs = JSON.parse(assessment.markSchemeGeminiIds || "[]");
    questionPaperRefs = JSON.parse(assessment.questionPaperGeminiIds || "[]");
    console.log(`[Multimodal] Reusing ${markSchemeRefs.length} MS + ${questionPaperRefs.length} QP Gemini file refs`);
  }

  // ── Step 2: Get or create context cache ────────────────────────────────────
  const refs: AssessmentFileRefs = {
    markSchemeUris: markSchemeRefs.map((r) => r.uri),
    markSchemeMimes: markSchemeRefs.map((r) => r.mimeType),
    questionPaperUris: questionPaperRefs.map((r) => r.uri),
    questionPaperMimes: questionPaperRefs.map((r) => r.mimeType),
  };

  const cacheName = await getOrCreateBatchCache(assessmentId, refs, assessment.markScheme || "");

  // ── Step 3: Upload student pages to Gemini Files API ────────────────────────
  if (!await updateSubmission(submissionId, { gradingProgress: 20 }, useSafeUpdate)) return;

  const studentPageRefs = await Promise.all(
    buffers.map((b, i) =>
      uploadBufferToGemini(b.buffer, b.mimeType, `student-${submissionId}-p${i + 1}`)
    )
  );
  const studentPageUris = studentPageRefs.map((r) => r.uri);
  const studentPageMimes = studentPageRefs.map((r) => r.mimeType);

  // ── Step 4: Parse question marks ────────────────────────────────────────────
  let questionMarks: QuestionMarkInfo[] = [];
  if (assessment.questionMarks) {
    try {
      questionMarks = JSON.parse(assessment.questionMarks);
    } catch {
      console.warn("[Multimodal] Failed to parse question marks");
    }
  }

  if (questionMarks.length === 0) {
    throw new Error("Multimodal grading requires question marks to be configured on the assessment");
  }

  const questionIds = questionMarks.map((q) => q.question);

  // ── Step 5: Map student pages to questions (Pass 1 — mapper) ────────────────
  if (!await updateSubmission(submissionId, { gradingProgress: 35 }, useSafeUpdate)) return;

  const { pageMap } = await mapStudentPages(studentPageUris, studentPageMimes, questionIds, cacheName);
  const finalPageMap = applyConfidenceFallback(pageMap, studentPageUris.length);

  // ── Step 6: Build per-question grading inputs ────────────────────────────────
  const questions: PerQuestionInput[] = questionMarks.map((q) => ({
    questionId: q.question,
    maxScore: q.marks,
    mapping: finalPageMap[q.question] ?? {
      pages: Array.from({ length: studentPageUris.length }, (_, i) => i + 1),
      note: "all pages (fallback — question not found in mapper output)",
      confidence: 0,
    },
  }));

  // ── Step 7: Per-question visual grading (Pass 2) ─────────────────────────────
  if (!await updateSubmission(submissionId, { gradingProgress: 45 }, useSafeUpdate)) return;

  const gradingResult = await gradeSubmissionMultimodal(
    submissionId,
    studentPageUris,
    studentPageMimes,
    questions,
    cacheName,
    feedbackLanguage,
    async (questionIndex, total) => {
      const progress = 45 + Math.round((questionIndex / total) * 45);
      await updateSubmission(submissionId, { gradingProgress: progress }, useSafeUpdate);
    }
  );

  // ── Step 8: Finalize and persist ────────────────────────────────────────────
  const formattedFeedback = formatFeedbackAsMarkdown(gradingResult, feedbackLanguage);
  const finalMaxScore = totalMarks > 0 ? totalMarks : gradingResult.maxScore;
  const finalScore = Math.min(gradingResult.score, finalMaxScore);

  await updateSubmission(submissionId, {
    score: finalScore,
    maxScore: finalMaxScore,
    feedback: formattedFeedback,
    status: "GRADED",
    gradingProgress: 100,
    gradedAt: new Date(),
    gradingMode: "multimodal",
    pageMap: JSON.stringify(finalPageMap),
  }, useSafeUpdate);

  console.log(`[Multimodal] Grading complete for ${submissionId}: ${finalScore}/${finalMaxScore}`);
}

/**
 * Tier 2: Holistic visual grading using context cache.
 */
async function processHolisticGrading(
  submissionId: string,
  buffers: { buffer: Buffer; mimeType: string }[],
  assessment: GradingRouterInput["assessment"],
  feedbackLanguage: string,
  totalMarks: number,
  useSafeUpdate: boolean
) {
  const assessmentId = assessment.id;
  const now = new Date();

  // ── Step 1: Ensure MS + QP are uploaded to Gemini Files API ─────────────────
  const filesExpired =
    !assessment.geminiFileIdsExpiresAt ||
    new Date(assessment.geminiFileIdsExpiresAt) <= now;

  let markSchemeRefs: GeminiFileRef[];
  let questionPaperRefs: GeminiFileRef[];

  if (filesExpired) {
    const markSchemeUrls = JSON.parse(assessment.markSchemeFileUrls || "[]") as string[];
    const questionPaperUrls = JSON.parse(assessment.questionPaperFileUrls || "[]") as string[];

    markSchemeRefs = markSchemeUrls.length > 0
      ? await uploadLocalUrlsToGemini(markSchemeUrls, `ms-${assessmentId}`)
      : [];
    questionPaperRefs = questionPaperUrls.length > 0
      ? await uploadLocalUrlsToGemini(questionPaperUrls, `qp-${assessmentId}`)
      : [];

    const expiresAt = new Date(now.getTime() + 47 * 60 * 60 * 1000);
    await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        markSchemeGeminiIds: JSON.stringify(markSchemeRefs),
        questionPaperGeminiIds: JSON.stringify(questionPaperRefs),
        geminiFileIdsExpiresAt: expiresAt,
      },
    });
  } else {
    markSchemeRefs = JSON.parse(assessment.markSchemeGeminiIds || "[]");
    questionPaperRefs = JSON.parse(assessment.questionPaperGeminiIds || "[]");
  }

  // ── Step 2: Get or create context cache ─────────────────────────────────────
  const refs: AssessmentFileRefs = {
    markSchemeUris: markSchemeRefs.map((r) => r.uri),
    markSchemeMimes: markSchemeRefs.map((r) => r.mimeType),
    questionPaperUris: questionPaperRefs.map((r) => r.uri),
    questionPaperMimes: questionPaperRefs.map((r) => r.mimeType),
  };

  const cacheName = await getOrCreateBatchCache(assessmentId, refs, assessment.markScheme || "");

  // ── Step 3: Upload student pages ─────────────────────────────────────────────
  if (!await updateSubmission(submissionId, { gradingProgress: 30 }, useSafeUpdate)) return;

  const studentPageRefs = await Promise.all(
    buffers.map((b, i) =>
      uploadBufferToGemini(b.buffer, b.mimeType, `student-${submissionId}-p${i + 1}`)
    )
  );
  const studentPageUris = studentPageRefs.map((r) => r.uri);
  const studentPageMimes = studentPageRefs.map((r) => r.mimeType);

  // ── Step 4: Holistic grading call ────────────────────────────────────────────
  if (!await updateSubmission(submissionId, { gradingProgress: 60 }, useSafeUpdate)) return;

  const gradingResult = await gradeSubmissionHolisticCached(
    studentPageUris,
    studentPageMimes,
    cacheName,
    totalMarks,
    feedbackLanguage
  );

  // ── Step 5: Finalize and persist ─────────────────────────────────────────────
  const formattedFeedback = formatFeedbackAsMarkdown(gradingResult, feedbackLanguage);
  const finalMaxScore = totalMarks > 0 ? totalMarks : gradingResult.maxScore;
  const finalScore = Math.min(gradingResult.score, finalMaxScore);

  await updateSubmission(submissionId, {
    score: finalScore,
    maxScore: finalMaxScore,
    feedback: formattedFeedback,
    status: "GRADED",
    gradingProgress: 100,
    gradedAt: new Date(),
    gradingMode: "holistic",
  }, useSafeUpdate);

  console.log(`[Holistic] Grading complete for ${submissionId}: ${finalScore}/${finalMaxScore}`);
}
