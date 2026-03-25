/**
 * RAG Embedding Service
 *
 * Chunks documents, embeds via Gemini (text-embedding-004),
 * caches in memory with 30-min TTL + LRU eviction,
 * and retrieves top-K relevant chunks by cosine similarity.
 *
 * Fallback: truncated raw context if embedding API fails.
 */

const GEMINI_EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_EMBEDDING_MODEL = "text-embedding-004";
const CHUNK_TARGET_CHARS = 1200; // ~300 tokens
const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TOP_K = 5;
const SHORT_DOC_THRESHOLD = 500; // chars — skip embedding below this

// ─── Types ───────────────────────────────────────────────────

interface CacheEntry {
  chunks: string[];
  embeddings: Float32Array[];
  createdAt: number;
  lastAccessed: number;
}

type DocType = "markScheme" | "extractedText" | "feedback" | "questionPaper";

// ─── In-memory cache ─────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

function cacheKey(docType: DocType, docId: string): string {
  return `${docType}:${docId}`;
}

function evictStale() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
  // LRU eviction if still over limit
  if (cache.size > MAX_CACHE_ENTRIES) {
    const sorted = [...cache.entries()].sort(
      (a, b) => a[1].lastAccessed - b[1].lastAccessed
    );
    const toDelete = sorted.slice(0, cache.size - MAX_CACHE_ENTRIES);
    for (const [key] of toDelete) cache.delete(key);
  }
}

// ─── Chunking ────────────────────────────────────────────────

/**
 * Removes boilerplate page headers/separators that add noise.
 * These score high on similarity for any "mark scheme" query but contain zero useful content.
 */
function stripBoilerplate(text: string): string {
  return text
    // Remove repeated page headers like "9702/42 ... Mark Scheme ... PUBLISHED"
    .replace(/\\?(newpage|noindent)\b[^\n]*\n?/g, "")
    .replace(/9702\/\d+\s+\\?hfill[^\n]*(Mark Scheme|May\/June)[^\n]*/g, "")
    .replace(/\\noindent\s*\\textbf\{PUBLISHED\}/g, "")
    // Remove LaTeX document preamble
    .replace(/\\documentclass[\s\S]*?\\begin\{document\}/g, "")
    .replace(/\\end\{document\}/g, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits mark scheme text by question numbers.
 * Handles LaTeX array rows like \text{1(a)} and plain text like "1(a)".
 *
 * Strategy: find all \text{N(x)} occurrences, treat the text between each pair
 * as a question chunk, and group the preamble separately.
 */
function chunkMarkScheme(text: string): string[] {
  const cleaned = stripBoilerplate(text);

  // Find all question references: \text{1(a)}, \text{2(b)(iii)}, etc.
  const qRefPattern = /\\text\{(\d+\([a-z]\)(?:\([ivx]+\))?)\}/gi;
  const matches: { index: number; qNum: string }[] = [];
  let m;
  while ((m = qRefPattern.exec(cleaned)) !== null) {
    matches.push({ index: m.index, qNum: m[1] });
  }

  if (matches.length < 3) {
    // Not enough question markers — fallback to generic splitting
    return mergeAndSplit(
      cleaned.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
    );
  }

  const chunks: string[] = [];

  // Preamble: everything before the first question reference
  const preamble = cleaned.slice(0, matches[0].index).trim();
  if (preamble.length > 50) {
    // Split preamble into reasonable chunks (it's generic marking principles)
    const preambleChunks = mergeAndSplit(
      preamble.split(/\n\s*\n/).filter((p) => p.trim().length > 20)
    );
    chunks.push(...preambleChunks);
  }

  // Question chunks: from each \text{N(x)} to the next one
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
    const content = cleaned.slice(start, end).trim();
    if (content.length < 10) continue;

    // Collect ALL question numbers in this chunk (in case merging combines them)
    const qNums: string[] = [matches[i].qNum];
    // Check if there are more question refs between start and end (from the match list)
    // Already handled since each match gets its own chunk

    chunks.push(`[Question ${matches[i].qNum}] ${content}`);
  }

  // Merge only ADJACENT question chunks that are very small (< 200 chars),
  // but always keep the [Question X] prefix from ALL merged questions
  const merged: string[] = [];
  let buf = "";
  let bufQNums: string[] = [];

  for (const chunk of chunks) {
    const qMatch = chunk.match(/^\[Question ([^\]]+)\]/);
    const isQuestion = !!qMatch;

    if (!isQuestion) {
      // Preamble chunk — don't merge with questions
      if (buf) {
        merged.push(buf);
        buf = "";
        bufQNums = [];
      }
      merged.push(chunk);
      continue;
    }

    const qNum = qMatch![1];
    const body = chunk.slice(chunk.indexOf("]") + 2); // content after prefix

    if (buf.length + body.length <= CHUNK_TARGET_CHARS) {
      buf += (buf ? "\n" : "") + chunk;
      bufQNums.push(qNum);
    } else {
      if (buf) merged.push(buf);
      buf = chunk;
      bufQNums = [qNum];
    }
  }
  if (buf) merged.push(buf);

  return merged.length > 0 ? merged : [cleaned];
}

/**
 * Splits extracted student text by question numbers.
 * OCR output has patterns like "1 (a) Define..." or "--- Page N ---"
 */
function chunkExtractedText(text: string): string[] {
  // Split on question patterns: "1 (a)", "5(b)(ii)", or page markers
  // Only match 1-2 digit question numbers to avoid matching page IDs
  const parts = text.split(
    /(?=(?:^|\n)\s*(?:---\s*Page\s+\d+|(?:\*{2})?\d{1,2}\s*\(?[a-z]\)?))/gim
  );

  const filtered = parts.filter((p) => p.trim().length > 30);

  if (filtered.length > 3) {
    // Add question prefix for better embedding matching
    return mergeAndSplit(
      filtered.map((p) => {
        // Only match 1-2 digit question numbers (not page IDs like 0019655342205)
        const qMatch = p.match(/^[\s*]*(\d{1,2})\s*\(?([a-z])\)?/i);
        if (qMatch) return `[Question ${qMatch[1]}${qMatch[2]}] ${p.trim()}`;
        return p.trim();
      })
    );
  }

  // Fallback: split on double newlines or page markers
  return mergeAndSplit(
    text.split(/\n\s*\n|(?=---\s*Page)/).filter((p) => p.trim().length > 30)
  );
}

/**
 * Splits feedback text by question headers.
 * Feedback has clear headers like "#### ✅ Question 1c(ii)" or "#### ❌ Question 5b"
 */
function chunkFeedback(text: string): string[] {
  const parts = text.split(/(?=####\s*[✅⚠️❌])/);
  const filtered = parts.filter((p) => p.trim().length > 20);

  if (filtered.length > 1) return mergeAndSplit(filtered);

  // Fallback: split on double newlines
  return mergeAndSplit(
    text.split(/\n\s*\n/).filter((p) => p.trim().length > 20)
  );
}

/**
 * Merges small parts and splits large ones to keep chunks near target size.
 */
function mergeAndSplit(parts: string[]): string[] {
  const chunks: string[] = [];
  let buffer = "";

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (buffer.length + trimmed.length <= CHUNK_TARGET_CHARS) {
      buffer += (buffer ? "\n\n" : "") + trimmed;
    } else {
      if (buffer) chunks.push(buffer);
      if (trimmed.length > CHUNK_TARGET_CHARS * 1.5) {
        // Hard-split oversized part on word boundaries
        const words = trimmed.split(/\s+/);
        let sub = "";
        for (const word of words) {
          if (sub.length + word.length + 1 > CHUNK_TARGET_CHARS) {
            if (sub) chunks.push(sub);
            sub = word;
          } else {
            sub += (sub ? " " : "") + word;
          }
        }
        buffer = sub;
      } else {
        buffer = trimmed;
      }
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());

  return chunks.length > 0 ? chunks : parts.filter((p) => p.trim().length > 0);
}

/**
 * Splits text into chunks using docType-specific strategies.
 * Mark schemes: split on question numbers in LaTeX arrays.
 * Extracted text: split on question/page boundaries from OCR.
 * Feedback: split on question headers (#### ✅/⚠️/❌).
 */
export function chunkText(text: string, docType: DocType): string[] {
  if (!text || text.trim().length === 0) return [];
  if (text.trim().length <= CHUNK_TARGET_CHARS) return [text.trim()];

  switch (docType) {
    case "markScheme":
      return chunkMarkScheme(text);
    case "extractedText":
      return chunkExtractedText(text);
    case "feedback":
      return chunkFeedback(text);
    case "questionPaper":
      return chunkExtractedText(text); // Same structure as extracted text
    default:
      return mergeAndSplit(
        text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
      );
  }
}

// ─── Embedding via Gemini ─────────────────────────────────────

async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const res = await fetch(
    `${GEMINI_EMBED_URL}/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${GEMINI_EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
        })),
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini embedding failed (${res.status}): ${body}`);
  }

  const json = await res.json();
  return json.embeddings.map(
    (e: { values: number[] }) => new Float32Array(e.values)
  );
}

async function embedQuery(text: string): Promise<Float32Array> {
  const [embedding] = await embedBatch([text]);
  return embedding;
}

// ─── Cosine Similarity ──────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Cache-first embed ───────────────────────────────────────

async function getOrCreateEmbeddings(
  docType: DocType,
  docId: string,
  text: string
): Promise<{ chunks: string[]; embeddings: Float32Array[] }> {
  const key = cacheKey(docType, docId);
  const cached = cache.get(key);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    cached.lastAccessed = Date.now();
    console.log(`[RAG] Cache HIT: ${key} (${cached.chunks.length} chunks)`);
    return { chunks: cached.chunks, embeddings: cached.embeddings };
  }

  const chunks = chunkText(text, docType);
  if (chunks.length === 0) return { chunks: [], embeddings: [] };

  console.log(`[RAG] Cache MISS: ${key} — embedding ${chunks.length} chunks`);
  const embeddings = await embedBatch(chunks);

  evictStale();
  cache.set(key, {
    chunks,
    embeddings,
    createdAt: Date.now(),
    lastAccessed: Date.now(),
  });

  return { chunks, embeddings };
}

// ─── Dynamic question fingerprinting ─────────────────────────

/**
 * Extracts all question-number-like patterns from text.
 * Fully dynamic — no hardcoded language keywords.
 *
 * Looks for patterns like: 1(a), 2(b)(ii), 1a, 5b, Q3, etc.
 * Returns normalized forms: ["1(a)", "1(b)", "2(a)", ...]
 */
function extractQuestionFingerprints(text: string): string[] {
  const fps = new Set<string>();
  let m;

  // Pattern 0: Q-prefixed — e.g. Q7, Q7b, Q7bi, Q7(b)(i), Q 7b
  const p0 = /Q\s*(\d{1,2})\s*(?:\(?([a-z])\)?(?:\s*\(?([ivx]+)\)?)?)?/gi;
  while ((m = p0.exec(text)) !== null) {
    if (m[2]) {
      fps.add(`${m[1]}(${m[2].toLowerCase()})`);
      if (m[3]) fps.add(`${m[1]}(${m[2].toLowerCase()})(${m[3].toLowerCase()})`);
    } else {
      fps.add(`${m[1]}q`);
    }
  }

  // Pattern 1: N(x) or N(x)(roman) — e.g. 1(a), 5(b)(ii)
  const p1 = /\b(\d{1,2})\s*\(([a-z])\)(?:\s*\(([ivx]+)\))?/gi;
  while ((m = p1.exec(text)) !== null) {
    fps.add(`${m[1]}(${m[2].toLowerCase()})`);
    if (m[3]) fps.add(`${m[1]}(${m[2].toLowerCase()})(${m[3].toLowerCase()})`);
  }

  // Pattern 2: Nx or N x (letter directly after number) — e.g. 1a, 5b
  const p2 = /\b(\d{1,2})\s*([a-z])(?![a-z])/gi;
  while ((m = p2.exec(text)) !== null) {
    fps.add(`${m[1]}(${m[2].toLowerCase()})`);
  }

  // Pattern 2b: "question/savol N" followed by letter/roman — e.g. "question 5 b ii", "part ii of question 5"
  const p2b = /(?:question|savol|вопрос)\s*(\d{1,2})\s*([a-z])?\s*(?:\(?([ivx]+)\)?)?/gi;
  while ((m = p2b.exec(text)) !== null) {
    if (m[2]) {
      fps.add(`${m[1]}(${m[2].toLowerCase()})`);
      if (m[3]) fps.add(`${m[1]}(${m[2].toLowerCase()})(${m[3].toLowerCase()})`);
    } else if (m[3]) {
      // "question 5 (ii)" — number + roman only
      fps.add(`${m[1]}q`);
    } else {
      fps.add(`${m[1]}q`);
    }
  }

  // Pattern 3: Standalone question numbers
  const p3 = /\b(\d{1,2})\b/g;
  while ((m = p3.exec(text)) !== null) {
    const num = m[1];
    const before = text.slice(Math.max(0, m.index - 5), m.index);
    if (!/[=×*/+\-.$]/.test(before)) {
      fps.add(`${num}q`);
    }
  }

  return [...fps];
}

/**
 * Scores how well a chunk matches a set of query question fingerprints.
 * Both query and chunk fingerprints are extracted dynamically.
 * Returns 0-1.
 */
function questionMatchScore(
  chunkFingerprints: string[],
  queryFingerprints: string[]
): number {
  if (queryFingerprints.length === 0 || chunkFingerprints.length === 0) return 0;

  let bestScore = 0;

  for (const qfp of queryFingerprints) {
    const isNumberOnly = qfp.endsWith("q");
    const baseNum = isNumberOnly ? qfp.slice(0, -1) : null;

    for (const cfp of chunkFingerprints) {
      const cfpIsNumberOnly = cfp.endsWith("q");

      if (isNumberOnly && baseNum) {
        // Query has just a number like "7" — match chunks that have 7(a), 7(b), etc.
        const cfpBase = cfp.replace(/\(.*$/, "").replace(/q$/, "");
        if (cfpBase === baseNum && !cfpIsNumberOnly) {
          // Chunk has 7(a) and query has 7 → good match
          bestScore = Math.max(bestScore, 0.8);
        }
      } else {
        // Query has specific ref like "5(b)" — exact match
        if (cfp === qfp) {
          bestScore = Math.max(bestScore, 1.0);
        }
        // Partial: query "5(b)" matches chunk "5(b)(ii)" (same question, sub-part)
        if (cfp.startsWith(qfp) || qfp.startsWith(cfp.replace(/q$/, ""))) {
          bestScore = Math.max(bestScore, 0.9);
        }
      }
    }
  }

  return bestScore;
}

/**
 * Cleans a chunk for output: strips internal "---" separators (which would
 * break the `\n\n---\n\n` join format) and collapses excessive whitespace.
 */
function sanitizeChunk(text: string): string {
  return text
    .replace(/\n---\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Top-K retrieval (hybrid: keyword + semantic) ────────────

interface RetrieveParams {
  query: string;
  documents: { docType: DocType; docId: string; text: string; label: string }[];
  topK?: number;
}

async function retrieveTopK({
  query,
  documents,
  topK = TOP_K,
}: RetrieveParams): Promise<string> {
  // Extract question fingerprints from the user query
  const queryFps = extractQuestionFingerprints(query);
  // Filter out number-only refs that are likely not question refs (too common)
  const meaningfulFps = queryFps.filter((fp) => !fp.endsWith("q") || parseInt(fp) <= 20);
  const hasQuestionRef = meaningfulFps.some((fp) => !fp.endsWith("q")) ||
    meaningfulFps.length > 0;

  if (hasQuestionRef) {
    console.log(`[RAG] Query fingerprints: ${meaningfulFps.join(", ")}`);
  }

  // Collect all chunks with their fingerprints
  const allChunks: {
    chunk: string;
    label: string;
    embedIndex: number;
    docIdx: number;
    fps: string[];
  }[] = [];

  const docData: { chunks: string[]; embeddings: Float32Array[] }[] = [];
  for (let di = 0; di < documents.length; di++) {
    const doc = documents[di];
    if (!doc.text || doc.text.trim().length === 0) {
      docData.push({ chunks: [], embeddings: [] });
      continue;
    }
    const data = await getOrCreateEmbeddings(doc.docType, doc.docId, doc.text);
    docData.push(data);
    for (let ci = 0; ci < data.chunks.length; ci++) {
      // Skip ghost/empty chunks
      if (data.chunks[ci].replace(/\[.*?\]\s*/, "").trim().length < 20) continue;
      allChunks.push({
        chunk: data.chunks[ci],
        label: doc.label,
        embedIndex: ci,
        docIdx: di,
        fps: extractQuestionFingerprints(data.chunks[ci]),
      });
    }
  }

  // When query references a question number, pick the BEST matching chunk
  // from EACH document type (mark scheme, student text, feedback).
  // This ensures the LLM always gets all three perspectives for comparison.
  if (hasQuestionRef) {
    const fpScored = allChunks.map((item) => ({
      ...item,
      fpScore: questionMatchScore(item.fps, meaningfulFps),
    }));

    const matched = fpScored.filter((s) => s.fpScore > 0);

    if (matched.length > 0) {
      // Group by document label, pick the best chunk(s) from each source
      const byLabel = new Map<string, typeof matched>();
      for (const item of matched) {
        const arr = byLabel.get(item.label) || [];
        arr.push(item);
        byLabel.set(item.label, arr);
      }

      const results: string[] = [];
      const budget = Math.max(topK, 6); // allow up to 6 to cover all sources

      for (const [label, items] of byLabel) {
        items.sort((a, b) => b.fpScore - a.fpScore);
        // Take top 2 per source (covers main + sub-question)
        const picks = items.slice(0, 2);
        for (const p of picks) {
          results.push(`[${p.label}]\n${sanitizeChunk(p.chunk)}`);
        }
      }

      console.log(
        `[RAG] Q-match: ${matched.length} hits across ${byLabel.size} sources → ${results.length} chunks`
      );

      return results.slice(0, budget).join("\n\n---\n\n");
    }
  }

  // Pure semantic retrieval — still balanced across sources
  const queryEmb = await embedQuery(query);
  const scored: { chunk: string; score: number; label: string }[] = [];

  for (let di = 0; di < documents.length; di++) {
    const { chunks, embeddings } = docData[di];
    for (let ci = 0; ci < chunks.length; ci++) {
      // Skip ghost/empty chunks
      if (chunks[ci].replace(/\[.*?\]\s*/, "").trim().length < 20) continue;
      scored.push({
        chunk: chunks[ci],
        score: cosineSimilarity(queryEmb, embeddings[ci]),
        label: documents[di].label,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) return "";

  // Balanced source selection: pick best chunk(s) from EACH source,
  // so the LLM always gets all perspectives (mark scheme, student text, feedback).
  const byLabel = new Map<string, typeof scored>();
  for (const item of scored) {
    const arr = byLabel.get(item.label) || [];
    arr.push(item);
    byLabel.set(item.label, arr);
  }

  const results: string[] = [];
  const perSource = Math.max(1, Math.floor(topK / byLabel.size));

  for (const [label, items] of byLabel) {
    // items already sorted by score (inherited from global sort)
    const picks = items.slice(0, perSource);
    for (const p of picks) {
      results.push(`[${p.label}]\n${sanitizeChunk(p.chunk)}`);
    }
  }

  // If we have room, fill remaining budget from top global scores
  // (but only chunks not already picked)
  const pickedSet = new Set(results.map((r) => r));
  if (results.length < topK) {
    for (const s of scored) {
      const formatted = `[${s.label}]\n${sanitizeChunk(s.chunk)}`;
      if (!pickedSet.has(formatted)) {
        results.push(formatted);
        pickedSet.add(formatted);
        if (results.length >= topK) break;
      }
    }
  }

  console.log(
    `[RAG] Semantic: ${scored.length} chunks scored, ${byLabel.size} sources → ${results.length} picked`
  );

  return results.slice(0, topK).join("\n\n---\n\n");
}

// ─── Fallback: truncated raw context ─────────────────────────

function truncatedFallback(
  documents: { text: string; label: string }[]
): string {
  return documents
    .filter((d) => d.text && d.text.trim().length > 0)
    .map((d) => {
      const t = d.text.trim();
      const truncated = t.length > 500 ? t.slice(0, 500) + "… [truncated]" : t;
      return `[${d.label}]\n${truncated}`;
    })
    .join("\n\n---\n\n");
}

// ─── Main Public API ─────────────────────────────────────────

interface GetRelevantContextParams {
  query: string;
  documents: { docType: DocType; docId: string; text: string; label: string }[];
  isTeacher: boolean;
}

/**
 * Returns formatted context string with top-K relevant chunks.
 * Falls back to truncated raw text if embedding fails.
 *
 * Security: call this with only the documents the user is allowed to see.
 * Teachers get markScheme + extractedText + feedback.
 * Students get only feedback.
 */
export async function getRelevantContextWithFallback({
  query,
  documents,
  isTeacher,
}: GetRelevantContextParams): Promise<string> {
  // Filter out empty docs
  const docs = documents.filter((d) => d.text && d.text.trim().length > 0);
  if (docs.length === 0) return "";

  // Short-doc optimization: if total context is small, include everything
  const totalChars = docs.reduce((sum, d) => sum + d.text.trim().length, 0);
  if (totalChars < SHORT_DOC_THRESHOLD) {
    console.log(`[RAG] Short doc (${totalChars} chars) — including all context directly`);
    return docs
      .map((d) => `[${d.label}]\n${d.text.trim()}`)
      .join("\n\n---\n\n");
  }

  try {
    const context = await retrieveTopK({ query, documents: docs });
    const chunkCount = context.split("---").length;
    console.log(
      `[RAG] Retrieved ${chunkCount} chunks (~${context.length} chars) for query: "${query.slice(0, 60)}…"`
    );
    return context;
  } catch (error) {
    console.error(
      "[RAG] Embedding failed, falling back to truncated context:",
      error instanceof Error ? error.message : error
    );
    return truncatedFallback(docs);
  }
}
