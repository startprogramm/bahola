/**
 * Gemini Context Cache Service
 *
 * Creates and manages a context cache containing the assessment's mark scheme
 * and question paper files. The cache is shared across all students in a
 * grading batch, giving a 90% token discount on those repeated tokens.
 *
 * Flow:
 *   1. uploadAssessmentFiles() → file URIs stored on Assessment
 *   2. getOrCreateBatchCache(assessment) → returns cache name
 *   3. All grading calls pass config: { cachedContent: cacheName }
 *   4. Cache expires after TTL (default 2h); auto-recreated from stored file URIs
 *
 * Minimum: 1,024 tokens (Gemini 3 Flash Preview).
 * 20 A4 images ≈ 36,000 tokens — always qualifies.
 */

import { GoogleGenAI, createPartFromUri } from "@google/genai";
import prisma from "@/lib/prisma";

const GRADING_MODEL = process.env.GEMINI_GRADING_MODEL ?? "gemini-3-flash-preview";
/** Cache TTL for a grading batch — long enough to finish a 30-student class. */
const CACHE_TTL_SECONDS = 3 * 60 * 60; // 3 hours

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}

export interface AssessmentFileRefs {
  markSchemeUris: string[];   // Gemini file URIs for mark scheme pages
  markSchemeMimes: string[];
  questionPaperUris: string[];
  questionPaperMimes: string[];
}

/**
 * Returns the active cache name for the assessment, creating or refreshing it if needed.
 * Stores the cache name and expiry on the Assessment row.
 */
export async function getOrCreateBatchCache(
  assessmentId: string,
  refs: AssessmentFileRefs,
  markSchemeText: string
): Promise<string> {
  // Check if we have a valid cache already
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { geminiBatchCacheId: true, geminiBatchCacheExpiresAt: true },
  });

  const now = new Date();
  const hasValidCache =
    assessment?.geminiBatchCacheId &&
    assessment.geminiBatchCacheExpiresAt &&
    assessment.geminiBatchCacheExpiresAt > now;

  if (hasValidCache) {
    return assessment!.geminiBatchCacheId!;
  }

  // Build the cache contents: mark scheme files + question paper files + text
  const ai = getClient();

  const parts: any[] = [];

  // Mark scheme file pages
  for (let i = 0; i < refs.markSchemeUris.length; i++) {
    parts.push(createPartFromUri(refs.markSchemeUris[i], refs.markSchemeMimes[i]));
  }

  // Mark scheme text (for subjects where text is reliable)
  if (markSchemeText?.trim()) {
    parts.push({ text: `\n\n--- MARK SCHEME TEXT ---\n${markSchemeText}` });
  }

  // Question paper file pages
  for (let i = 0; i < refs.questionPaperUris.length; i++) {
    parts.push(createPartFromUri(refs.questionPaperUris[i], refs.questionPaperMimes[i]));
  }

  if (parts.length === 0) {
    throw new Error("No mark scheme or question paper content to cache");
  }

  const cache = await ai.caches.create({
    model: GRADING_MODEL,
    config: {
      contents: [{ role: "user", parts }],
      systemInstruction: `You are an expert examiner. The content above contains the official mark scheme and question paper for this assessment. You will use these documents to grade student work, question by question, with precise visual attention.`,
      ttl: `${CACHE_TTL_SECONDS}s`,
    },
  });

  if (!cache.name) throw new Error("Context cache creation returned no name");

  const expiresAt = new Date(now.getTime() + CACHE_TTL_SECONDS * 1000);

  await prisma.assessment.update({
    where: { id: assessmentId },
    data: {
      geminiBatchCacheId: cache.name,
      geminiBatchCacheExpiresAt: expiresAt,
    },
  });

  console.log(`[CacheService] Created context cache ${cache.name} for assessment ${assessmentId}, expires ${expiresAt.toISOString()}`);
  return cache.name;
}

/**
 * Delete the context cache for an assessment (e.g. when assessment is deleted).
 * Silently ignores errors — caches auto-expire anyway.
 */
export async function deleteAssessmentCache(cacheName: string): Promise<void> {
  try {
    const ai = getClient();
    await ai.caches.delete({ name: cacheName });
  } catch {
    // Ignore — cache may already be expired
  }
}
