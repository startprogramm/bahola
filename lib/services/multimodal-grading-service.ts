/**
 * Multimodal Grading Service
 *
 * Two grading modes, both backed by the Gemini context cache:
 *
 * 1. gradeSubmissionMultimodal — Per-question visual grading (Pass 2 of the
 *    two-pass pipeline). Requires a mapper PageMap. Sequential within a
 *    student for ECF; parallel across students via the grading queue.
 *    Output: QuestionResult[] in DB + GradingResult for backward compat.
 *
 * 2. gradeSubmissionHolisticCached — Single-call holistic grading for
 *    assessments that have MS/QP files but no per-question mark breakdown.
 *    All student pages are sent in one request; the model grades the whole
 *    submission against the cached mark scheme.
 *    Output: GradingResult only (no QuestionResult records).
 */

import { GoogleGenAI, createPartFromUri } from "@google/genai";
import prisma from "@/lib/prisma";
import { type PageMap } from "./mapper-service";
import { type GradingResult, type QuestionBreakdown } from "./grading-service";

const GRADING_MODEL = process.env.GEMINI_GRADING_MODEL ?? "gemini-3-flash-preview";

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}

export interface PerQuestionInput {
  questionId: string;
  maxScore: number;
  /** From mapper — which pages contain this question's answer */
  mapping: PageMap[string];
}

interface SingleQuestionResult {
  questionId: string;
  score: number;
  maxScore: number;
  status: "correct" | "partial" | "incorrect" | "unanswered";
  deductionReason: string;
  modelLogicCot: string;
  feedback: string;
  containsDiagram: boolean;
  pageNumbers: number[];
}

const THINKING_BUDGET: Record<string, number> = {
  mcq: 0,
  short: 256,
  structured: 256,
  multi_step: 512,
  essay: 1024,
  diagram: 1024,
};

/** Estimate thinking budget based on max marks — more marks = more complex. */
function thinkingBudget(maxScore: number): number {
  if (maxScore <= 1) return 0;
  if (maxScore <= 3) return THINKING_BUDGET.short;
  if (maxScore <= 6) return THINKING_BUDGET.structured;
  if (maxScore <= 10) return THINKING_BUDGET.multi_step;
  return THINKING_BUDGET.essay;
}

/**
 * Grade a single question using the student's page images and the context cache.
 */
async function gradeOneQuestion(
  ai: GoogleGenAI,
  question: PerQuestionInput,
  studentPageUris: string[],
  studentPageMimes: string[],
  cacheName: string,
  previousResults: SingleQuestionResult[],
  feedbackLanguage: string
): Promise<SingleQuestionResult> {
  const { questionId, maxScore, mapping } = question;

  // Select the relevant student pages for this question
  const relevantPageIndices = mapping.pages.map((p) => p - 1); // 0-based
  const parts: any[] = [];

  for (const idx of relevantPageIndices) {
    if (idx >= 0 && idx < studentPageUris.length) {
      parts.push({ text: `--- Student Page ${idx + 1} ---` });
      parts.push(createPartFromUri(studentPageUris[idx], studentPageMimes[idx]));
    }
  }

  // ECF context: inject previous results so the grader can apply carried-forward marks
  let ecfContext = "";
  if (previousResults.length > 0) {
    ecfContext = "\n\nPREVIOUS QUESTION RESULTS (for Error Carried Forward):\n";
    for (const r of previousResults) {
      ecfContext += `${r.questionId}: ${r.score}/${r.maxScore} — ${r.deductionReason || "correct"}\n`;
    }
  }

  const langNote =
    feedbackLanguage === "english"
      ? ""
      : `\nIMPORTANT: Write all "feedback" text in ${feedbackLanguage}. Keep subject-specific terms in English.`;

  parts.push({
    text: `
You are grading ${questionId} (worth ${maxScore} mark${maxScore !== 1 ? "s" : ""}).

ATTENTION: The student's answer for ${questionId} is on page${mapping.pages.length > 1 ? "s" : ""} ${mapping.pages.join(", ")}. ${mapping.note}. Focus ONLY on ${questionId}'s answer. Ignore any other questions visible on these pages.
${ecfContext}
Use the mark scheme and question paper from your context to grade this question accurately. For diagrams, graphs, or geometric constructions, visually inspect the student's drawing against the mark scheme criteria — do NOT describe or guess from text.
${langNote}

Respond ONLY with valid JSON:
{
  "questionId": "${questionId}",
  "score": <integer 0-${maxScore}>,
  "maxScore": ${maxScore},
  "status": "<correct|partial|incorrect|unanswered>",
  "deductionReason": "<brief reason for any marks lost, empty if full marks>",
  "modelLogicCot": "<your reasoning chain, 1-3 sentences>",
  "feedback": "<student-facing feedback>",
  "containsDiagram": <true|false>
}`,
  });

  const response = await ai.models.generateContent({
    model: GRADING_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      cachedContent: cacheName,
      thinkingConfig: { thinkingBudget: thinkingBudget(maxScore) },
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const raw = response.text ?? "";

  try {
    const parsed = JSON.parse(raw) as SingleQuestionResult;
    return {
      questionId: parsed.questionId ?? questionId,
      score: Math.min(Math.max(0, parsed.score ?? 0), maxScore),
      maxScore,
      status: parsed.status ?? "incorrect",
      deductionReason: parsed.deductionReason ?? "",
      modelLogicCot: parsed.modelLogicCot ?? "",
      feedback: parsed.feedback ?? "",
      containsDiagram: parsed.containsDiagram ?? false,
      pageNumbers: mapping.pages,
    };
  } catch {
    console.error(`[Multimodal] Failed to parse grading response for ${questionId}:`, raw.slice(0, 300));
    return {
      questionId,
      score: 0,
      maxScore,
      status: "incorrect",
      deductionReason: "Grading response parse error",
      modelLogicCot: "",
      feedback: "Could not process this question. Please review manually.",
      containsDiagram: false,
      pageNumbers: mapping.pages,
    };
  }
}

/**
 * Run the full per-question grading loop for one submission.
 * Stores QuestionResult records in the DB and returns a GradingResult
 * for backward compatibility with the existing feedback rendering.
 */
export async function gradeSubmissionMultimodal(
  submissionId: string,
  studentPageUris: string[],
  studentPageMimes: string[],
  questions: PerQuestionInput[],
  cacheName: string,
  feedbackLanguage: string,
  onProgress?: (questionIndex: number, total: number) => Promise<void>
): Promise<GradingResult> {
  if (questions.length === 0) {
    throw new Error("No questions provided for multimodal grading");
  }

  const ai = getClient();
  const results: SingleQuestionResult[] = [];

  // Sequential loop — ECF requires each result before grading the next
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];

    const result = await gradeOneQuestion(
      ai,
      question,
      studentPageUris,
      studentPageMimes,
      cacheName,
      results,
      feedbackLanguage
    );

    results.push(result);

    if (onProgress) {
      await onProgress(i + 1, questions.length);
    }
  }

  // Persist QuestionResult records (upsert in case of retry)
  await prisma.$transaction(
    results.map((r) =>
      prisma.questionResult.upsert({
        where: {
          // Use a unique constraint on submissionId + questionNumber
          // (added via @@unique in schema or handled by delete+create)
          id: `${submissionId}-${r.questionId}`,
        },
        create: {
          id: `${submissionId}-${r.questionId}`,
          submissionId,
          questionNumber: r.questionId,
          score: r.score,
          maxScore: r.maxScore,
          status: r.status,
          deductionReason: r.deductionReason || null,
          modelLogicCot: r.modelLogicCot || null,
          feedback: r.feedback || null,
          containsDiagram: r.containsDiagram,
          pageNumbers: r.pageNumbers,
        },
        update: {
          score: r.score,
          maxScore: r.maxScore,
          status: r.status,
          deductionReason: r.deductionReason || null,
          modelLogicCot: r.modelLogicCot || null,
          feedback: r.feedback || null,
          containsDiagram: r.containsDiagram,
          pageNumbers: r.pageNumbers,
        },
      })
    )
  );

  // Build GradingResult for backward compatibility
  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const totalMax = results.reduce((s, r) => s + r.maxScore, 0);

  const breakdown: QuestionBreakdown[] = results.map((r) => ({
    questionId: r.questionId,
    points: r.score,
    maxPoints: r.maxScore,
    status: r.status,
    feedback: r.feedback,
    containsDiagram: r.containsDiagram,
    deductions: r.deductionReason
      ? [{ reason: r.deductionReason, pointsLost: r.maxScore - r.score }]
      : [],
  }));

  return {
    score: totalScore,
    maxScore: totalMax,
    feedback: `Multimodal grading complete. ${totalScore}/${totalMax} marks awarded.`,
    breakdown,
  };
}

/**
 * Grade a complete submission in a single holistic call using the context cache.
 * Used when MS/QP files are available but no per-question mark breakdown exists.
 * The model sees all student pages at once and grades against the cached mark scheme.
 */
export async function gradeSubmissionHolisticCached(
  studentPageUris: string[],
  studentPageMimes: string[],
  cacheName: string,
  totalMarks: number,
  feedbackLanguage: string
): Promise<GradingResult> {
  const ai = getClient();

  const parts: any[] = [];
  for (let i = 0; i < studentPageUris.length; i++) {
    parts.push({ text: `--- Student Page ${i + 1} ---` });
    parts.push(createPartFromUri(studentPageUris[i], studentPageMimes[i]));
  }

  const langNote =
    feedbackLanguage === "english"
      ? ""
      : `\nIMPORTANT: Write all feedback text in ${feedbackLanguage}. Keep subject-specific terms in English.`;

  parts.push({
    text: `
You are grading a student's complete submission (${totalMarks} total marks available).

Use the mark scheme and question paper from your context to grade every question and part visible in the student's work.
${langNote}

Respond ONLY with valid JSON:
{
  "score": <integer 0-${totalMarks}>,
  "maxScore": ${totalMarks},
  "feedback": "<overall markdown feedback summarising performance>",
  "breakdown": [
    {
      "questionId": "<e.g. Q1, 1a, 2b(i)>",
      "points": <integer>,
      "maxPoints": <integer>,
      "status": "<correct|partial|incorrect|unanswered>",
      "feedback": "<question-specific feedback>",
      "containsDiagram": <true|false>,
      "deductions": [{"reason": "<reason>", "pointsLost": <integer>}]
    }
  ]
}`,
  });

  const response = await ai.models.generateContent({
    model: GRADING_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      cachedContent: cacheName,
      thinkingConfig: { thinkingBudget: 4096 },
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const raw = response.text ?? "";

  try {
    const parsed = JSON.parse(raw) as GradingResult;
    const clampedScore = Math.min(Math.max(0, parsed.score ?? 0), totalMarks);
    return {
      score: clampedScore,
      maxScore: totalMarks,
      feedback: parsed.feedback ?? "",
      breakdown: (parsed.breakdown ?? []).map((b: QuestionBreakdown) => ({
        questionId: b.questionId ?? "?",
        points: Math.max(0, b.points ?? 0),
        maxPoints: Math.max(1, b.maxPoints ?? 1),
        status: b.status ?? "incorrect",
        feedback: b.feedback ?? "",
        containsDiagram: b.containsDiagram ?? false,
        deductions: b.deductions ?? [],
      })),
    };
  } catch {
    console.error("[Holistic] Failed to parse grading response:", raw.slice(0, 300));
    throw new Error("Holistic grading response could not be parsed");
  }
}
