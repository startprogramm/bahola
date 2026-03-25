/**
 * AI Mapper Service — Question Boundary Detection
 *
 * Pass 1 of the multimodal grading pipeline. Sends all student pages to Gemini
 * and asks it to identify which pages each question spans, including positional
 * notes for pages shared between questions (e.g. "Q2 starts in the lower third
 * of page 1"). This output drives the attention anchoring in Pass 2.
 *
 * Thinking is disabled (thinkingBudget: 0) — this is a routing task, not
 * a reasoning task. Speed and cost are the priorities here.
 */

import { GoogleGenAI, createPartFromUri } from "@google/genai";

const MAPPER_MODEL = process.env.GEMINI_MAPPER_MODEL ?? "gemini-3-flash-preview";

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}

export interface QuestionPageMapping {
  pages: number[];      // 1-based page indices
  note: string;         // positional description for attention anchoring
  confidence: number;   // 0-1; below 0.7 → grader falls back to all pages
}

export type PageMap = Record<string, QuestionPageMapping>; // key = "Q1", "Q2a", etc.

export interface MapperResult {
  pageMap: PageMap;
  /** Questions the mapper could not locate at all */
  unanswered: string[];
}

/**
 * Run the AI mapper on student page images.
 *
 * @param studentPageUris  Gemini Files API URIs for each student page (in order)
 * @param studentPageMimes MIME types matching the URIs
 * @param questionIds      Question identifiers from the mark scheme (e.g. ["Q1","Q2a","Q2b"])
 * @param cacheName        Context cache name holding mark scheme + question paper
 */
export async function mapStudentPages(
  studentPageUris: string[],
  studentPageMimes: string[],
  questionIds: string[],
  cacheName: string
): Promise<MapperResult> {
  if (studentPageUris.length === 0) {
    throw new Error("Mapper: no student pages provided");
  }

  const ai = getClient();

  // Build the prompt parts: student page images + mapping instruction
  const parts: any[] = [];

  for (let i = 0; i < studentPageUris.length; i++) {
    parts.push({ text: `--- Student Page ${i + 1} ---` });
    parts.push(createPartFromUri(studentPageUris[i], studentPageMimes[i]));
  }

  const questionList = questionIds.map((q) => `"${q}"`).join(", ");

  parts.push({
    text: `
You are analyzing a student's handwritten exam submission. Above are ${studentPageUris.length} pages of their answers.
The mark scheme and question paper are in your context (cached above).

Your task: identify which page(s) contain the student's answer for each question.

Questions to locate: ${questionList}

Rules:
- A question's answer may span multiple pages.
- Multiple questions may share a page (e.g. Q1 ends and Q2 begins on page 2).
- If a question is unanswered or blank, include it in "unanswered".
- For pages shared by multiple questions, describe WHERE on the page each question's answer appears (e.g. "top half", "lower third", "entire page").
- Page numbers are 1-based (first page = 1).
- Confidence: 1.0 = certain, 0.5 = unsure, 0.0 = not found.

Respond ONLY with valid JSON matching this exact schema:
{
  "pageMap": {
    "Q1": { "pages": [1], "note": "entire page 1", "confidence": 0.95 },
    "Q2a": { "pages": [1, 2], "note": "starts lower third of page 1, continues page 2", "confidence": 0.85 }
  },
  "unanswered": []
}
`,
  });

  const response = await ai.models.generateContent({
    model: MAPPER_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      cachedContent: cacheName,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      temperature: 0,
    },
  });

  const raw = response.text ?? "";

  try {
    const parsed = JSON.parse(raw) as { pageMap: PageMap; unanswered: string[] };
    return {
      pageMap: parsed.pageMap ?? {},
      unanswered: parsed.unanswered ?? [],
    };
  } catch {
    console.error("[Mapper] Failed to parse response:", raw.slice(0, 500));
    // Fallback: assign all pages to every question
    const fallback: PageMap = {};
    const allPages = Array.from({ length: studentPageUris.length }, (_, i) => i + 1);
    for (const q of questionIds) {
      fallback[q] = { pages: allPages, note: "all pages (mapper parse failed)", confidence: 0 };
    }
    return { pageMap: fallback, unanswered: [] };
  }
}

/**
 * For questions with low confidence, expand to all pages (safe fallback).
 */
export function applyConfidenceFallback(
  pageMap: PageMap,
  totalPages: number,
  threshold = 0.7
): PageMap {
  const allPages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const result: PageMap = {};
  for (const [q, mapping] of Object.entries(pageMap)) {
    if (mapping.confidence < threshold) {
      result[q] = { ...mapping, pages: allPages, note: `${mapping.note} (expanded — low confidence ${mapping.confidence.toFixed(2)})` };
    } else {
      result[q] = mapping;
    }
  }
  return result;
}
