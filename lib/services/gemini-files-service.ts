/**
 * Gemini Files API Service
 *
 * Uploads mark scheme and question paper images to the Gemini Files API.
 * Files persist for 48 hours and are referenced by URI in context caches
 * and grading calls, avoiding re-uploading the same documents for every student.
 *
 * Usage pattern:
 *   1. At grading batch start, call uploadAssessmentFiles() once per assessment.
 *   2. Store the returned URIs on the Assessment row.
 *   3. Pass URIs to the cache service to create a context cache.
 *   4. All per-student grading calls reference the cache, not the raw files.
 */

import { GoogleGenAI } from "@google/genai";
import { getFileBuffer } from "@/lib/storage";

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}

export interface GeminiFileRef {
  uri: string;
  mimeType: string;
  name: string; // e.g. "files/abc123"
}

/**
 * Upload a single buffer to the Gemini Files API.
 * Returns the file URI and name for use in caches/prompts.
 */
export async function uploadBufferToGemini(
  buffer: Buffer,
  mimeType: string,
  displayName: string
): Promise<GeminiFileRef> {
  const ai = getClient();

  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });

  const file = await ai.files.upload({
    file: blob,
    config: { mimeType, displayName },
  });

  if (!file.uri || !file.name) {
    throw new Error(`Files API upload failed for "${displayName}": no URI returned`);
  }

  return { uri: file.uri, mimeType, name: file.name };
}

/**
 * Upload a list of local file URLs (stored in public/uploads) to the Gemini Files API.
 * Returns an array of file refs in the same order as the input URLs.
 */
export async function uploadLocalUrlsToGemini(
  fileUrls: string[],
  labelPrefix: string
): Promise<GeminiFileRef[]> {
  const refs: GeminiFileRef[] = [];

  for (let i = 0; i < fileUrls.length; i++) {
    const url = fileUrls[i];
    const ext = url.substring(url.lastIndexOf(".")).toLowerCase();
    const mimeType = extToMime(ext);
    const buffer = await getFileBuffer(url);
    const ref = await uploadBufferToGemini(buffer, mimeType, `${labelPrefix}-page-${i + 1}`);
    refs.push(ref);
  }

  return refs;
}

/**
 * Delete a Gemini file by its name (e.g. "files/abc123").
 * Silently ignores errors — files auto-delete after 48h anyway.
 */
export async function deleteGeminiFile(fileName: string): Promise<void> {
  try {
    const ai = getClient();
    await ai.files.delete({ name: fileName });
  } catch {
    // Ignore — file may already be expired
  }
}

function extToMime(ext: string): string {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
  };
  return map[ext] ?? "image/jpeg";
}
