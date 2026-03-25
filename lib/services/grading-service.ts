/**
 * Grading Service - Text Comparison with Gemini 3 Flash Preview
 *
 * Pipeline:
 * 1. Receives student's extracted handwritten text (from Gemini OCR)
 * 2. Receives mark scheme's extracted text (OCR'd when assessment was created)
 * 3. Detects exam board style (Edexcel, Cambridge/CAIE, AQA, OCR, IB, etc.)
 * 4. Uses Gemini 3 Flash Preview to compare and grade using board-specific methodology
 */

import { GoogleGenAI } from "@google/genai";

/**
 * Map of supported feedback language codes to their display names.
 * Used by the grading prompt to tell Gemini which language to generate in.
 */
const FEEDBACK_LANGUAGE_NAMES: Record<string, string> = {
  english: "English",
  uzbek: "Uzbek",
  russian: "Russian",
  french: "French",
  german: "German",
  arabic: "Arabic",
  ukrainian: "Ukrainian",
  japanese: "Japanese",
  chinese: "Chinese",
};

/**
 * Build a language instruction block for Gemini grading prompts.
 * For English, returns empty string (default behavior).
 * For any other language, returns a clear instruction telling Gemini
 * to GENERATE (not translate) all feedback in that language.
 */
function buildLanguageInstruction(feedbackLanguage: string): string {
  if (!feedbackLanguage || feedbackLanguage === "english") return "";

  const langName = FEEDBACK_LANGUAGE_NAMES[feedbackLanguage] || feedbackLanguage;

  return `
═══════════════════════════════════════════════════════════════════════════════
              ⚠️ CRITICAL: ALL FEEDBACK MUST BE IN ${langName.toUpperCase()}! ⚠️
═══════════════════════════════════════════════════════════════════════════════

You MUST write ALL feedback text in ${langName}:
- The "feedback" field MUST be written in ${langName}
- Every per-question "feedback" MUST be written in ${langName}
- Explain errors in ${langName}
- Show correct answers in ${langName}

IMPORTANT: Generate your responses DIRECTLY in ${langName}.
Do NOT write in English and then translate. Think and write natively in ${langName}.

⚠️ SMART TERMINOLOGY RULES — DO NOT TRANSLATE THESE, keep them in English as-is:
- Subject-specific terms: photosynthesis, mitochondria, velocity, acceleration, etc.
- English language terms (for English class): noun, verb, adjective, tense, etc.
- Math symbols and formulas: F=ma, E=mc², sin, cos, etc.
- Chemical formulas: H₂O, NaCl, CO₂, etc.
- Technical terms: algorithm, function, variable, etc.
- Scientific names and abbreviations: DNA, RNA, ATP, pH, etc.

Write explanations and general words in ${langName}.
Keep subject-specific and scientific terms in English!
`;
}

/**
 * Build the inline language reminder for the end of grading prompts.
 */
function buildLanguageReminder(feedbackLanguage: string): string {
  if (!feedbackLanguage || feedbackLanguage === "english") return "";
  const langName = FEEDBACK_LANGUAGE_NAMES[feedbackLanguage] || feedbackLanguage;
  return `- ALL feedback MUST be written in ${langName.toUpperCase()}! Subject-specific terms stay in English.`;
}

/**
 * Exam board detection patterns and marking styles
 */
interface ExamBoardInfo {
  name: string;
  patterns: RegExp[];
  markingStyle: string;
}

const EXAM_BOARDS: ExamBoardInfo[] = [
  {
    name: "Edexcel",
    patterns: [/edexcel/i, /pearson/i, /london\s*examinations/i],
    markingStyle: `
EDEXCEL MARKING METHODOLOGY:
- Use M marks for method (award even if final answer wrong, if method is correct)
- Use A marks for accuracy (final answers, only award if method correct)
- Use B marks for independent marks (can be awarded regardless of other marks)
- Award marks for "correct working seen" even without final answer
- Apply "error carried forward" (ECF) - if a student uses an incorrect value from a previous part correctly, award method marks
- For "Show that" questions: Award marks for each valid step shown, not just the final result
- Apply benefit of the doubt (BOD) when answer could be interpreted either way`
  },
  {
    name: "Cambridge (CAIE/CIE)",
    patterns: [/cambridge/i, /caie/i, /\bcie\b/i, /igcse/i, /cambridge\s*international/i, /ucles/i],
    markingStyle: `
CAMBRIDGE (CAIE) MARKING METHODOLOGY:
- Use a tick (✓) approach - each valid point earns a mark
- Follow "mark what you see" principle - only mark what student has written
- M marks: Method marks, awarded for valid approach even with arithmetic errors
- A marks: Accuracy marks, dependent on correct working
- B marks: Independent marks for specific knowledge or standalone answers
- Apply "Own Figure Rule" (OFR) - mark subsequent work using student's own incorrect values
- For multi-step calculations: Award full marks if final answer is correct even without working
- Apply "Special Case" (SC) marks where specified in mark scheme`
  },
  {
    name: "AQA",
    patterns: [/\baqa\b/i, /assessment\s*and\s*qualifications\s*alliance/i],
    markingStyle: `
AQA MARKING METHODOLOGY:
- AO1: Knowledge and understanding marks
- AO2: Application marks
- AO3: Analysis and evaluation marks
- Use "levels of response" for extended answers - match response to level descriptor
- For calculation questions: Award method marks even if arithmetic is wrong
- "Consequential marking" - credit correct method using incorrect values from earlier work
- For definitions: Accept any response that conveys the correct meaning
- Use indicative content as a guide, not a checklist - accept valid alternatives`
  },
  {
    name: "OCR",
    patterns: [/\bocr\b/i, /oxford\s*cambridge\s*rsa/i],
    markingStyle: `
OCR MARKING METHODOLOGY:
- Use "best fit" approach for leveled questions
- Award credit for valid alternative responses not in mark scheme
- AO1: Demonstrate knowledge
- AO2: Apply knowledge and understanding
- AO3: Analyse, interpret, evaluate
- For calculations: Award marks for correct method even with arithmetic errors
- Apply "follow through" marking - credit correct use of an earlier wrong answer
- For practical questions: Credit sensible approaches even if not the expected method`
  },
  {
    name: "IB (International Baccalaureate)",
    patterns: [/\bib\b/i, /international\s*baccalaureate/i, /diploma\s*programme/i],
    markingStyle: `
IB (INTERNATIONAL BACCALAUREATE) MARKING METHODOLOGY:
- Use markbands for extended response questions
- Award marks holistically based on quality of response
- For Paper 1 (essays): Use criterion-based marking (Knowledge, Analysis, Evaluation)
- For Paper 2/3 (data response): Award marks for each valid point up to maximum
- "Follow through" (ft) - award marks for correctly using an incorrect previous answer
- Award marks for "partially correct" responses where appropriate
- For calculations: Full marks for correct answer; partial marks for correct method
- Accept equivalent expressions and alternative valid approaches
- Command terms are crucial: "Describe" vs "Explain" vs "Evaluate" require different depths`
  },
  {
    name: "A-Level/AS-Level",
    patterns: [/a[\s-]*level/i, /as[\s-]*level/i, /advanced\s*level/i, /gce/i],
    markingStyle: `
A-LEVEL/AS-LEVEL MARKING METHODOLOGY:
- Use assessment objectives (AOs) to guide marking
- AO1: Knowledge and understanding
- AO2: Application of knowledge
- AO3: Analysis and evaluation
- For synoptic questions: Credit links between different topics
- Apply "consequential marking" for multi-part questions
- For essay questions: Use levels-based marking with descriptors
- Award marks for valid points even if not explicitly in mark scheme
- For calculations: Credit correct method even with arithmetic slips`
  },
  {
    name: "General Public School",
    patterns: [], // No patterns - this is the fallback
    markingStyle: `
GENERAL PUBLIC SCHOOL MARKING METHODOLOGY:
This is the standard marking approach for general public school assessments.

CORE PRINCIPLES:
- Award marks based on correctness and understanding
- Give partial credit for partially correct answers
- Show working is important - credit correct methods even with calculation errors
- Accept alternative valid approaches if they demonstrate understanding

MARKING GUIDELINES:
1. FACTUAL QUESTIONS (definitions, recall):
   - Full marks: Complete and accurate answer
   - Partial marks: Answer shows understanding but missing key details
   - No marks: Incorrect or irrelevant answer

2. CALCULATION/PROBLEM-SOLVING:
   - Method marks: Award for correct approach/formula even if answer is wrong
   - Accuracy marks: Award only if final answer is correct
   - Show working: Always give credit for visible working
   - Arithmetic errors: Deduct minimally if method is correct
   - Units: Deduct small amount if correct answer missing units

3. EXPLANATION/DESCRIPTION QUESTIONS:
   - Mark based on quality and completeness of explanation
   - Award marks for each valid point made
   - Accept answers in student's own words if meaning is correct
   - Don't penalize for minor language/grammar errors if meaning is clear

4. MULTI-PART QUESTIONS:
   - Each part is independent unless stated otherwise
   - Error carried forward: If student uses wrong answer from part (a) correctly in part (b), give method marks for part (b)
   - Progressive difficulty: Earlier parts may be worth fewer marks

5. EXTENDED RESPONSE/ESSAYS:
   - Use point-based marking or level descriptors if provided
   - Credit relevant points even if not in expected order
   - Quality over quantity - focused answers better than rambling
   - Structure and clarity matter for higher marks

GENERAL RULES:
- Be fair and consistent
- If answer is ambiguous but could be correct, give benefit of doubt
- Award marks for valid alternative methods not in mark scheme
- Spelling/grammar errors don't lose marks unless it's a language test
- Crossed out work: Don't mark unless no other answer given
- Blank answers: Zero marks, note as "unanswered"

PARTIAL CREDIT GUIDELINES:
- If a 3-mark question has 3 distinct points, each point = 1 mark
- For 2-mark calculations: typically 1 mark for method, 1 mark for answer
- For explanations: award marks proportionally to completeness
- Never award more than the maximum marks available`
  },
];

/**
 * Detect exam board from mark scheme text
 * Returns the matching board or the General Public School methodology as fallback
 */
function detectExamBoard(markSchemeText: string, questionPaper?: string | null): ExamBoardInfo {
  const combinedText = `${markSchemeText} ${questionPaper || ''}`;

  // Try to detect specific exam boards
  for (const board of EXAM_BOARDS) {
    // Skip the General Public School (it's the fallback)
    if (board.name === "General Public School") continue;

    for (const pattern of board.patterns) {
      if (pattern.test(combinedText)) {
        return board;
      }
    }
  }

  // Return General Public School methodology as fallback
  return EXAM_BOARDS[EXAM_BOARDS.length - 1]; // Last one is General Public School
}

// Gemini models — tiered by cost/complexity
const GEMINI_GRADING_MODEL = "gemini-3-flash-preview";   // heavy: essays, open-ended
const GEMINI_LITE_MODEL    = "gemini-3-flash-preview";     // light: short answers, structured

// ─────────────────────────────────────────────────────────────────────────────
// MCQ / DISCRETE ANSWER DETECTION & PROGRAMMATIC GRADING
// ─────────────────────────────────────────────────────────────────────────────

interface AnswerKeyEntry {
  questionId: string;
  answer: string;
  marks: number;
}

/**
 * Try to parse a mark scheme as a simple MCQ / discrete answer key.
 * Handles formats like:
 *   "1. B"  "1) A"  "Q1: C"  "1 - D"  "1  B" (table rows)
 * Returns an array of entries if ≥3 questions look like discrete answers,
 * otherwise returns null (= not a pure MCQ paper).
 */
function parseMCQAnswerKey(markSchemeText: string): AnswerKeyEntry[] | null {
  const lines = markSchemeText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const entries: AnswerKeyEntry[] = [];
  let nonMCQLines = 0;

  for (const line of lines) {
    // Skip header / separator lines
    if (/^(answer\s*key|mark\s*scheme|answers|question|q\s+a|total|marks?)[:\s]*$/i.test(line)) continue;
    if (/^[-=*#]+$/.test(line)) continue;

    // Match: optional "Q/Question" prefix, number (with optional sub-letter),
    // separator (.):- space), then a single A-E letter OR 1-9 digit answer
    const match = line.match(
      /^(?:q(?:uestion)?\.?\s*)?(\d+[a-z]?)\s*[\.\)\s:\-]+\s*([A-Ea-e]|\d{1,2})\s*(?:\(?\d+\s*marks?\)?)?$/i
    );
    if (match) {
      entries.push({
        questionId: match[1],
        answer: match[2].toUpperCase(),
        marks: 1,
      });
    } else {
      nonMCQLines++;
    }
  }

  // Accept as MCQ if we have ≥3 entries and non-MCQ lines are < 25% of total
  const ratio = nonMCQLines / Math.max(entries.length + nonMCQLines, 1);
  if (entries.length >= 3 && ratio < 0.25) {
    return entries;
  }
  return null;
}

/**
 * Extract student MCQ answers from OCR'd text.
 * Tries numbered format first ("1. A", "1) B"), then falls back to
 * extracting bare letters in order of appearance.
 */
function extractStudentMCQAnswers(
  studentText: string,
  expectedCount: number
): { questionId: string; answer: string }[] {
  const numbered: { questionId: string; answer: string }[] = [];

  for (const line of studentText.split('\n').map(l => l.trim())) {
    const m = line.match(/^(\d+[a-z]?)\s*[\.\)\s:\-]+\s*([A-Ea-e])\s*$/i);
    if (m) numbered.push({ questionId: m[1], answer: m[2].toUpperCase() });
  }

  if (numbered.length >= Math.ceil(expectedCount * 0.5)) return numbered;

  // Fallback: pull bare capital letters A-E in sequence
  const letters = Array.from(studentText.matchAll(/\b([A-E])\b/gi), m => m[1].toUpperCase());
  if (letters.length >= Math.ceil(expectedCount * 0.5)) {
    return letters.slice(0, expectedCount).map((letter, i) => ({
      questionId: String(i + 1),
      answer: letter,
    }));
  }

  return numbered; // return what we have (may be empty)
}

/**
 * Grade MCQ answers without calling any AI model.
 */
function gradeMCQProgrammatically(
  studentText: string,
  answerKey: AnswerKeyEntry[],
  feedbackLanguage: string = "english"
): GradingResult {
  const studentAnswers = extractStudentMCQAnswers(studentText, answerKey.length);
  const byId = new Map(studentAnswers.map(a => [a.questionId, a.answer]));

  const breakdown: QuestionBreakdown[] = [];
  let score = 0;
  const totalMarks = answerKey.reduce((s, q) => s + q.marks, 0);

  for (const expected of answerKey) {
    const given = byId.get(expected.questionId);
    const correct = given && given.toUpperCase() === expected.answer.toUpperCase();

    if (correct) {
      score += expected.marks;
      breakdown.push({
        questionId: expected.questionId,
        points: expected.marks,
        maxPoints: expected.marks,
        status: "correct",
        feedback: `Correct — **${expected.answer}**`,
      });
    } else if (!given) {
      breakdown.push({
        questionId: expected.questionId,
        points: 0,
        maxPoints: expected.marks,
        status: "unanswered",
        feedback: `No answer detected. Correct answer: **${expected.answer}**`,
      });
    } else {
      breakdown.push({
        questionId: expected.questionId,
        points: 0,
        maxPoints: expected.marks,
        status: "incorrect",
        feedback: `Student answered **${given}**, correct answer is **${expected.answer}**`,
      });
    }
  }

  const pct = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;
  const summary =
    pct >= 80 ? "Good performance overall." :
    pct >= 60 ? "Satisfactory — review the incorrect answers." :
    "Needs improvement — go through each incorrect answer carefully.";

  return {
    score,
    maxScore: totalMarks,
    feedback: `${score}/${totalMarks} (${pct}%). ${summary}`,
    breakdown,
  };
}

/**
 * Analyse mark scheme complexity and decide which grading path to use.
 *
 * Returns:
 *  - 'programmatic_mcq' + mcqAnswerKey  → grade without any AI
 *  - 'lite'                              → use gemini-3-flash-preview
 *  - 'full'                              → use gemini-3-flash-preview (default)
 */
function analyzeMarkSchemeComplexity(markSchemeText: string): {
  type: 'programmatic_mcq' | 'lite' | 'full';
  mcqAnswerKey?: AnswerKeyEntry[];
} {
  // Tier 1: pure MCQ answer key
  const mcqAnswerKey = parseMCQAnswerKey(markSchemeText);
  if (mcqAnswerKey && mcqAnswerKey.length >= 3) {
    return { type: 'programmatic_mcq', mcqAnswerKey };
  }

  // Tier 2: simple / short-answer paper — use the lite model
  // Heuristic: if most non-empty lines in the mark scheme are short (≤35 chars),
  // the answers are likely discrete/short and don't need deep reasoning.
  const meaningfulLines = markSchemeText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 3 && !/^[-=*#]+$/.test(l));

  if (meaningfulLines.length >= 3) {
    const shortLines = meaningfulLines.filter(l => l.length <= 35).length;
    if (shortLines / meaningfulLines.length >= 0.75) {
      return { type: 'lite' };
    }
  }

  // Tier 3: complex / open-ended
  return { type: 'full' };
}

export interface QuestionBreakdown {
  questionId: string; // e.g., "1", "1a", "1a)i", "2b)ii"
  points: number;
  maxPoints: number;
  status: "correct" | "partial" | "incorrect" | "unanswered";
  feedback: string;
  containsDiagram?: boolean; // true if student answer contains a diagram, graph, drawing, or visual element
  deductions?: {
    reason: string;
    pointsLost: number;
  }[];
}

export interface GradingResult {
  score: number;
  maxScore: number;
  feedback: string;
  breakdown: QuestionBreakdown[];
}

export interface QuestionMarkInfo {
  question: string;
  marks: number;
}

// Get Gemini client
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Attempt to recover grading data from truncated JSON response
 * Extracts score and feedback using regex if JSON parsing fails
 */
function attemptTruncationRecovery(
  responseText: string,
  totalMarks: number
): GradingResult | null {
  try {
    // Try to extract score
    const scoreMatch = responseText.match(/"score"\s*:\s*(\d+)/);
    if (!scoreMatch) {
      console.log("Could not extract score from truncated response");
      return null;
    }
    const score = parseInt(scoreMatch[1], 10);

    // Try to extract maxScore from truncated response
    const maxScoreMatch = responseText.match(/"maxScore"\s*:\s*(\d+)/);
    const recoveredMaxScore = maxScoreMatch ? parseInt(maxScoreMatch[1], 10) : 0;

    // Derive effective maxScore: teacher-set totalMarks > AI maxScore > breakdown sum > 100 fallback
    const effectiveMax = totalMarks > 0 ? totalMarks : (recoveredMaxScore > 0 ? recoveredMaxScore : 0);

    // Try to extract feedback
    const feedbackMatch = responseText.match(/"feedback"\s*:\s*"([^"]+)"/);
    const feedback = feedbackMatch
      ? feedbackMatch[1]
      : `Score: ${score}/${effectiveMax || totalMarks} (response was truncated, detailed breakdown unavailable)`;

    // Try to extract any complete breakdown items
    const breakdown: QuestionBreakdown[] = [];
    const breakdownRegex = /\{\s*"questionId"\s*:\s*"([^"]+)"\s*,\s*"points"\s*:\s*(\d+)\s*,\s*"maxPoints"\s*:\s*(\d+)\s*,\s*"status"\s*:\s*"(correct|partial|incorrect|unanswered)"\s*,\s*"feedback"\s*:\s*"([^"]+)"\s*\}/g;

    let match;
    while ((match = breakdownRegex.exec(responseText)) !== null) {
      breakdown.push({
        questionId: match[1],
        points: parseInt(match[2], 10),
        maxPoints: parseInt(match[3], 10),
        status: match[4] as "correct" | "partial" | "incorrect" | "unanswered",
        feedback: match[5],
      });
    }

    console.log(`Recovered ${breakdown.length} complete breakdown items from truncated response`);

    // Use breakdown sum as another signal for maxScore
    const breakdownMax = breakdown.reduce((sum, q) => sum + (q.maxPoints || 0), 0);
    const finalMax = effectiveMax > 0 ? effectiveMax : (breakdownMax > 0 ? breakdownMax : 100);

    // Clamp score to finalMax (don't clamp to 0 when totalMarks=0)
    const clampedScore = Math.min(Math.max(0, score), finalMax);

    return {
      score: clampedScore,
      maxScore: finalMax,
      feedback: feedback + (breakdown.length === 0 ? " (Note: Detailed question breakdown was truncated)" : ""),
      breakdown,
    };
  } catch (error) {
    console.error("Truncation recovery failed:", error);
    return null;
  }
}

/**
 * Grade submission using TEXT COMPARISON with Gemini 3 Flash Preview
 *
 * @param studentText - Student's extracted handwritten text (from Gemini OCR)
 * @param markSchemeText - Mark scheme's extracted text (OCR'd when assessment was created)
 * @param totalMarks - Total marks available
 * @param questionMarks - Optional array of question marks for better accuracy
 * @param feedbackLanguage - Language for feedback output ("english" or "uzbek")
 * @param customPrompt - Optional custom grading instructions from teacher
 * @param questionPaper - Optional question paper text (what was asked)
 */
export async function gradeSubmissionWithText(
  studentText: string,
  markSchemeText: string,
  totalMarks: number,
  questionMarks?: QuestionMarkInfo[],
  feedbackLanguage: string = "english",
  customPrompt?: string | null,
  questionPaper?: string | null
): Promise<GradingResult> {
  const hasGeminiKey = process.env.GEMINI_API_KEY;
  if (!hasGeminiKey) {
    console.warn("No GEMINI_API_KEY set, using mock grading");
    return mockGrading(totalMarks);
  }

  if (!studentText || studentText.trim().length === 0) {
    return {
      score: 0,
      maxScore: totalMarks,
      feedback: "No handwritten content could be extracted from the student's submission.",
      breakdown: [{
        questionId: "All",
        points: 0,
        maxPoints: totalMarks,
        status: "unanswered",
        feedback: "No handwritten answers were detected in the submission.",
      }],
    };
  }

  // If no mark scheme, use fallback grading (analyze student work without mark scheme)
  if (!markSchemeText || markSchemeText.trim().length === 0) {
    console.log("No mark scheme available, using fallback grading mode...");
    return gradeWithoutMarkScheme(studentText, totalMarks, questionMarks, feedbackLanguage);
  }

  // ── Tier routing ──────────────────────────────────────────────────────────
  const complexity = analyzeMarkSchemeComplexity(markSchemeText);
  console.log(`Mark scheme complexity: ${complexity.type}`);

  if (complexity.type === 'programmatic_mcq' && complexity.mcqAnswerKey) {
    console.log(`Pure MCQ paper (${complexity.mcqAnswerKey.length} questions) — grading programmatically, no AI used`);
    return gradeMCQProgrammatically(studentText, complexity.mcqAnswerKey, feedbackLanguage);
  }

  // For lite/full, pick the appropriate model
  const gradingModel = complexity.type === 'lite' ? GEMINI_LITE_MODEL : GEMINI_GRADING_MODEL;
  console.log(`Using model: ${gradingModel}`);

  // Detect exam board from mark scheme content and question paper
  const examBoard = detectExamBoard(markSchemeText, questionPaper);
  console.log(`Detected methodology: ${examBoard.name}`);

  // Build exam board specific instructions
  const examBoardInstructions = `
═══════════════════════════════════════════════════════════════════════════════
                    METHODOLOGY: ${examBoard.name.toUpperCase()}
═══════════════════════════════════════════════════════════════════════════════

${examBoard.name === "General Public School"
  ? `No specific exam board detected. Using general public school marking methodology.

⚠️ IMPORTANT: First analyze the question paper and mark scheme for any identifying markers:
- Subject codes (e.g., "9702", "4024", "H556")
- Exam board references or logos
- Question numbering patterns (e.g., "1(a)(i)" suggests Cambridge/Edexcel)
- Specific terminology (M marks, A marks, AO1/AO2/AO3, etc.)
- Mark allocation style ([1], (2), M1 A1, etc.)

If you identify a specific exam board from these markers, note it in your feedback and apply
their methodology instead. Otherwise, use the general methodology below.`
  : `This assessment appears to be from ${examBoard.name}. Apply their marking methodology:`}

${examBoard.markingStyle}
`;

  // Build question marks section if provided
  let questionMarksSection = "";
  if (questionMarks && questionMarks.length > 0) {
    const totalFromQuestions = questionMarks.reduce((sum, q) => sum + q.marks, 0);
    questionMarksSection = `
═══════════════════════════════════════════════════════════════════════════════
                    QUESTION MARKS ALLOCATION (Teacher Provided)
═══════════════════════════════════════════════════════════════════════════════

The teacher has specified the following marks for each question:
${questionMarks.map(q => `• Question ${q.question}: ${q.marks} mark${q.marks !== 1 ? 's' : ''}`).join('\n')}

TOTAL MARKS: ${totalFromQuestions}

⚠️ IMPORTANT: Use these mark allocations when grading. They override any unclear
marks in the mark scheme document. The "maxScore" in your response MUST equal ${totalFromQuestions}.
Each question's "maxPoints" MUST match the allocations above.
`;
  } else if (totalMarks > 0) {
    questionMarksSection = `
═══════════════════════════════════════════════════════════════════════════════
                    TOTAL MARKS (Teacher Provided)
═══════════════════════════════════════════════════════════════════════════════

The total marks for this assessment is: ${totalMarks}

⚠️ IMPORTANT: The "maxScore" in your response MUST equal ${totalMarks}.
Distribute per-question "maxPoints" so they sum to exactly ${totalMarks}.
`;
  }

  try {
    const ai = getGeminiClient();

    // Language instruction for feedback
    const languageInstruction = buildLanguageInstruction(feedbackLanguage);

    const humanToneInstruction = `
HUMAN TONE & DETAIL REQUIREMENT:
- Write feedback in a supportive teacher voice, not a robotic evaluator.
- Use natural, varied phrasing; avoid repeating the same sentence template.
- Overall "feedback" must be 2-3 sentences with:
  1) one clear strength,
  2) one key gap,
  3) one practical next step.
- Per-question "feedback" MUST be DETAILED and line-by-line:
  - Use markdown formatting: **bold** for key terms, correct answers, and mark allocations
  - Use bullet points (- ) or numbered lists for each marking point
  - For each mark point: state what the student wrote vs what was expected
  - If CORRECT: briefly confirm with the expected answer in **bold**
  - If INCORRECT: clearly state the error, then give the correct answer in **bold**
  - If PARTIAL: list which points earned marks and which did not
  - Include the mark scheme expected answer for every incorrect/missing point
  - NO filler text or unnecessary padding - just clear, structured feedback
- Keep wording respectful and specific. No sarcasm, no harsh language.
`;

    // Build custom prompt section if provided
    const customPromptSection = customPrompt?.trim()
      ? `
═══════════════════════════════════════════════════════════════════════════════
                    CUSTOM GRADING INSTRUCTIONS (Teacher Provided)
═══════════════════════════════════════════════════════════════════════════════

The teacher has provided the following additional instructions for grading:

${customPrompt.trim()}

⚠️ IMPORTANT: Follow these custom instructions in addition to the standard marking
criteria. These instructions may adjust strictness, focus areas, or special considerations.
`
      : "";

    // Build question paper section if provided
    const questionPaperSection = questionPaper?.trim()
      ? `
═══════════════════════════════════════════════════════════════════════════════
                    QUESTION PAPER (What the student was asked)
═══════════════════════════════════════════════════════════════════════════════

${questionPaper.trim()}

═══════════════════════════════════════════════════════════════════════════════
`
      : "";

    const prompt = `You are grading a student's answers against a mark scheme.
${languageInstruction}
${humanToneInstruction}
${examBoardInstructions}
${customPromptSection}
${questionPaperSection}
═══════════════════════════════════════════════════════════════════════════════
                         TEXT-BASED GRADING
═══════════════════════════════════════════════════════════════════════════════

MARK SCHEME (extracted from the original document):
${markSchemeText}
${questionMarksSection}
═══════════════════════════════════════════════════════════════════════════════

STUDENT'S ANSWERS (extracted handwritten content only):
${studentText}

═══════════════════════════════════════════════════════════════════════════════
                    CRITICAL GRADING PRINCIPLE
═══════════════════════════════════════════════════════════════════════════════

⚠️ THE MARK SCHEME IS THE SOLE SOURCE OF TRUTH FOR GRADING!

The mark scheme takes absolute priority. You must:
1. Grade EXACTLY according to the mark scheme, even if:
   - The mark scheme answer seems incorrect to you
   - You know a "better" answer exists
   - The student's different answer is technically valid

2. If the mark scheme explicitly provides an answer or says "accept X", then
   award the mark when the student writes X — even if it is not perfectly correct
   in an absolute sense. The teacher/examiner decided it deserves a mark.

3. If the mark scheme says "also accept…" or "also include…", those alternatives
   MUST earn full marks just like the primary answer.

4. DO NOT use your own knowledge to override the mark scheme.

5. ONLY fall back to your own reasoning/logic when:
   - The mark scheme is UNCLEAR, AMBIGUOUS, or SILENT on a particular point
   - The mark scheme provides no answer at all for a question
   - Note in feedback when you had to interpret an unclear criterion

═══════════════════════════════════════════════════════════════════════════════
               READING TEACHER NOTES & INSTRUCTIONS IN MARK SCHEMES
═══════════════════════════════════════════════════════════════════════════════

Mark schemes often contain teacher/examiner notes, instructions, and annotations.
You MUST read and follow ALL of these:

1. TEACHER/EXAMINER NOTES: Lines starting with "Note:", "NB:", "Accept:", "Allow:",
   "Reject:", "Do not accept:", "Ignore:", "Examiner's note:", or similar headers.
   These are instructions FOR YOU — follow them exactly.

2. OPTIONAL CONTENT — content in parentheses/brackets within answers:
   - Round brackets () in an answer = OPTIONAL words the student may or may not include
   - Example: "The (ultramagnetic) radiation is (very) weak"
     → Award full marks for "The radiation is weak"
     → Also award full marks for "The ultramagnetic radiation is very weak"
     → Brackets mean the word is acceptable but NOT required
   - Square brackets [] in answers may indicate alternatives: [word1/word2]

3. "Optional:" or "OPT:" labels = those points are bonus/optional, not required for full marks.

4. "OR" / "/" between answers = any of those answers earns the mark.
   Example: "evaporation / boiling / vaporization" → accept ANY of these.

5. UNDERLINED or **bold** words in mark scheme = KEY terms that MUST appear in the answer.

6. "Accept any valid…" / "Accept reasonable…" = use fair judgment, don't be overly strict.

7. Mark allocation annotations like "M1 A1", "B1", "[1]", "(2 marks)" define how
   many marks each point is worth — follow these precisely.

8. "ECF" / "error carried forward" / "follow through" = if student uses a wrong
   answer from a previous part correctly in this part, award method marks.

═══════════════════════════════════════════════════════════════════════════════
                    DETERMINING MARKS FROM MARK SCHEME
═══════════════════════════════════════════════════════════════════════════════

Look at the mark scheme to determine:
1. How many marks each question is worth (look for [1], [2], (1 mark), etc.)
2. The total marks available (sum of all question marks)
3. If marks are unclear, look for patterns like "1 mark per correct point"

═══════════════════════════════════════════════════════════════════════════════
                         GRADING RULES
═══════════════════════════════════════════════════════════════════════════════

1. READ the mark scheme answer/criteria for each question carefully, including
   ALL notes, annotations, and instructions embedded in the mark scheme.
2. COMPARE student's answer to the mark scheme
3. Award marks when the student's answer matches the mark scheme criteria

4. ANSWERS THAT MUST MATCH EXACTLY:
   - Numerical values (unless mark scheme shows a range)
   - Multiple choice answers (A, B, C, D)
   - Binary/truth tables
   - Specific terms the mark scheme requires (especially underlined/bold terms)
   - Chemical formulas and equations

5. AWARD THE MARK GENEROUSLY when:
   - The mark scheme explicitly lists the answer (even if answer seems imprecise)
   - The student's answer matches any accepted alternative listed in the mark scheme
   - The student includes optional content from brackets (neither penalise nor require it)
   - The student's wording differs but conveys the same meaning as the mark scheme answer
   - Minor spelling variations of the correct answer (unless it's a spelling test)

6. For "[BLANK - no answer]", award 0 marks (unanswered)

═══════════════════════════════════════════════════════════════════════════════
                         WORKING OUT / CALCULATION QUESTIONS
═══════════════════════════════════════════════════════════════════════════════

For questions requiring working/calculations:
1. Check if mark scheme specifies METHOD marks (M) and ANSWER marks (A)
2. If mark scheme shows working, check student's method follows similar logic
3. If mark scheme only shows final answer, focus on whether student got that answer
4. Use reasoning when mark scheme is unclear about partial credit

═══════════════════════════════════════════════════════════════════════════════
                           OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════════════

Respond in JSON format ONLY (no markdown code blocks):
{
  "score": <total marks awarded>,
  "maxScore": <total marks available from mark scheme>,
  "feedback": "<2-3 sentence human summary: strength, gap, next step>",
  "breakdown": [
    {
      "questionId": "1a",
      "points": 2,
      "maxPoints": 3,
      "status": "partial",
      "feedback": "<1-3 sentences: what was right, what is missing, and a correction>",
      "containsDiagram": false
    }
  ]
}

DIAGRAM/GRAPH DETECTION:
- Set "containsDiagram": true if the student's answer for that question contains a diagram, graph, drawing, chart, circuit diagram, flowchart, structure chart, linked list diagram, tree diagram, truth table diagram, or any other visual/graphical element
- Clues: the OCR text will contain [DIAGRAM: ...] descriptions, or references to drawn elements, arrows, boxes, nodes, plotted points, sketched curves, labelled axes, etc.
- Still grade diagram questions to the best of your ability based on the text description, but flag them so the teacher knows to review the original image
- Set "containsDiagram": false (or omit) for text-only answers

⚠️ FEEDBACK REQUIREMENTS - DETAILED, LINE-BY-LINE, WELL-FORMATTED:
- For EVERY question, provide DETAILED feedback using markdown formatting
- Use **bold** for: correct answers, key terms, mark allocations, important values
- Use bullet points (- ) to break down each marking point separately
- For each marking point in the question:
  - State what the student wrote
  - State what was expected (from mark scheme)
  - State whether the mark was awarded or not
- If INCORRECT: clearly state the error, then the correct answer in **bold**
- If PARTIAL: list each sub-mark earned and each sub-mark lost separately
- Include the mark scheme expected answer for every incorrect/missing point
- NO filler text, NO generic encouragement - just precise, structured analysis
- Keep it respectful but direct
${buildLanguageReminder(feedbackLanguage)}

EXAMPLE OF GOOD PER-QUESTION FEEDBACK (use this level of detail):
"- Student correctly defined **linked list** as 'a sequence of nodes containing data and pointers' ✓ **(+1)**\\n- However, student did not distinguish between **doubly linked list** and **singly linked list**. Mark scheme requires: **'a doubly linked list has pointers to both previous and next nodes'** **(-1)**\\n- Student correctly noted the difference from **arrays**: 'dynamic memory allocation' ✓ **(+1)**"

IMPORTANT:
- Only respond with valid JSON
- "maxScore" MUST equal the ACTUAL total marks from the mark scheme (e.g. if mark scheme totals 75, maxScore must be 75, NOT 100)
- If teacher provided total marks or question allocations above, use those exact values
- Otherwise, determine maxScore by summing the marks for each question as shown in the mark scheme
- The sum of all "maxPoints" in the breakdown MUST equal "maxScore"
- DO NOT default to 100 — calculate the real total from the mark scheme
- Include ALL questions in the breakdown
- Every incorrect answer MUST include the correct answer from the mark scheme
- Use markdown in feedback strings: **bold**, bullet points (- ), line breaks (\\n)
${buildLanguageReminder(feedbackLanguage)}`;

    let response;
    const maxRetries = 6;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Gemini API call attempt ${attempt}/${maxRetries} (model: ${gradingModel})...`);
        response = await ai.models.generateContent({
          model: gradingModel,
          contents: prompt,
          config: { maxOutputTokens: 65536 },
        });
        break; // Success, exit retry loop
      } catch (apiError) {
        lastError = apiError instanceof Error ? apiError : new Error(String(apiError));
        console.error(`Gemini API call attempt ${attempt} failed:`, lastError.message);

        // Check if it's a retryable error (network/timeout/overload)
        const msg = lastError.message.toLowerCase();
        const isRateLimit = msg.includes('429') ||
                           msg.includes('resource_exhausted') ||
                           msg.includes('rate limit') ||
                           msg.includes('quota');
        const isRetryable = isRateLimit ||
                           msg.includes('fetch failed') ||
                           msg.includes('econnreset') ||
                           msg.includes('etimedout') ||
                           msg.includes('network') ||
                           msg.includes('timeout') ||
                           msg.includes('503') ||
                           msg.includes('unavailable') ||
                           msg.includes('overloaded') ||
                           msg.includes('high demand');

        if (isRetryable && attempt < maxRetries) {
          let delay: number;
          if (isRateLimit) {
            // Parse retry-after hint from Gemini error, or use aggressive backoff
            const hintMatch = lastError.message.match(/retry in (\d+(?:\.\d+)?)s/i) ||
                              lastError.message.match(/retryDelay["\s:]+["']?(\d+(?:\.\d+)?)s/i);
            delay = hintMatch
              ? Math.ceil(parseFloat(hintMatch[1])) * 1000 + 2000
              : Math.min(15000 * Math.pow(2, attempt - 1), 120000);
          } else {
            delay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
          }
          console.log(`${isRateLimit ? 'Rate-limit' : 'Retryable'} error detected, retrying in ${Math.round(delay / 1000)}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else if (!isRetryable) {
          // Non-retryable error, fail immediately
          throw new Error(`Gemini API call failed: ${lastError.message}`);
        }
      }
    }

    if (!response && lastError) {
      throw new Error(`Gemini API call failed after ${maxRetries} attempts: ${lastError.message}`);
    }

    if (!response) {
      throw new Error("Gemini API returned null response");
    }

    let responseText = "";
    try {
      responseText = response.text || "";
    } catch (textError) {
      console.error("Failed to get text from response:", textError);
      console.error("Response object:", JSON.stringify(response, null, 2).substring(0, 1000));
      throw new Error(`Failed to extract text from Gemini response: ${textError instanceof Error ? textError.message : 'Unknown error'}`);
    }

    // Clean up the response
    responseText = responseText.trim();
    if (responseText.startsWith("```json")) {
      responseText = responseText.slice(7);
    } else if (responseText.startsWith("```")) {
      responseText = responseText.slice(3);
    }
    if (responseText.endsWith("```")) {
      responseText = responseText.slice(0, -3);
    }
    responseText = responseText.trim();

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error("JSON parse error. Response text was:", responseText.substring(0, 500));
      console.log("Attempting truncation recovery...");

      // Try to recover from truncated JSON
      result = attemptTruncationRecovery(responseText, totalMarks);

      if (!result) {
        throw new Error(`Failed to parse grading response as JSON: ${parseError}`);
      }
      console.log("Truncation recovery successful - extracted score:", result.score);
    }

    // Derive maxScore: teacher-set totalMarks is definitive; otherwise trust
    // AI's explicit maxScore over the breakdown sum (AI often normalises
    // per-question maxPoints to 100 even when the mark scheme says 75).
    const breakdownMax = (result.breakdown || []).reduce((sum: number, q: { maxPoints?: number }) => sum + (q.maxPoints || 0), 0);
    let maxScore: number;
    if (totalMarks > 0) {
      maxScore = totalMarks;
    } else if (result.maxScore && result.maxScore > 0) {
      maxScore = result.maxScore;
    } else if (breakdownMax > 0) {
      maxScore = breakdownMax;
    } else {
      maxScore = 100;
    }
    let validatedScore = Math.min(Math.max(0, result.score || 0), maxScore);

    // Always trust the breakdown sum over the AI's stated total
    const breakdownScore = (result.breakdown || []).reduce((sum: number, q: { points?: number }) => sum + (q.points || 0), 0);
    let feedbackText = result.feedback || `Score: ${validatedScore}/${maxScore}`;
    if (breakdownScore > 0 && breakdownScore !== validatedScore) {
      console.log(`Score mismatch: AI returned ${validatedScore} but breakdown sums to ${breakdownScore}. Using breakdown sum.`);
      const oldScore = validatedScore;
      validatedScore = Math.min(breakdownScore, maxScore);
      // Fix score references in the feedback text
      const pct = Math.round((validatedScore / maxScore) * 100);
      feedbackText = feedbackText
        .replace(`${oldScore}/${maxScore}`, `${validatedScore}/${maxScore}`)
        .replace(`(${Math.round((oldScore / maxScore) * 100)}%)`, `(${pct}%)`);
    }

    console.log(`Grading complete: ${validatedScore}/${maxScore}`);

    return {
      score: validatedScore,
      maxScore: maxScore,
      feedback: feedbackText,
      breakdown: result.breakdown || [],
    };
  } catch (error) {
    console.error("Gemini grading error:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    throw new Error(`Failed to grade submission with Gemini: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Grade student work WITHOUT a mark scheme
 * Uses Gemini to analyze the student's answers and provide feedback
 * based on general academic standards and correctness
 */
async function gradeWithoutMarkScheme(
  studentText: string,
  totalMarks: number,
  questionMarks?: QuestionMarkInfo[],
  feedbackLanguage: string = "english"
): Promise<GradingResult> {
  try {
    const ai = getGeminiClient();

    // Build question marks section if provided
    let qMarksSection = "";
    if (questionMarks && questionMarks.length > 0) {
      const totalFromQuestions = questionMarks.reduce((sum, q) => sum + q.marks, 0);
      qMarksSection = `
═══════════════════════════════════════════════════════════════════════════════
                    QUESTION MARKS ALLOCATION (Teacher Provided)
═══════════════════════════════════════════════════════════════════════════════

The teacher has specified the following marks for each question:
${questionMarks.map(q => `• Question ${q.question}: ${q.marks} mark${q.marks !== 1 ? 's' : ''}`).join('\n')}

TOTAL MARKS: ${totalFromQuestions}

Use these mark allocations when grading to assign appropriate scores.
`;
    }

    // Language instruction for feedback (same rules as main grading)
    const languageInstruction = buildLanguageInstruction(feedbackLanguage);

    const prompt = `You are an academic grader analyzing a student's work WITHOUT a provided mark scheme.
${languageInstruction}

═══════════════════════════════════════════════════════════════════════════════
                    STUDENT'S ANSWERS (extracted handwritten content)
═══════════════════════════════════════════════════════════════════════════════

${studentText}
${qMarksSection}
═══════════════════════════════════════════════════════════════════════════════
                         GRADING WITHOUT MARK SCHEME
═══════════════════════════════════════════════════════════════════════════════

Since no mark scheme is provided, you must:

1. ANALYZE each answer the student has written
2. EVALUATE correctness based on your knowledge:
   - Mathematical calculations: Check if the working and answer are correct
   - Science questions: Verify scientific accuracy
   - Definitions: Check if they convey the correct meaning
   - Multiple choice: Cannot verify without knowing the question

3. ESTIMATE marks based on:
   - Completeness of answers
   - Correctness of content
   - Quality of explanations/working shown

4. BE FAIR but acknowledge limitations:
   - You don't know the exact questions asked
   - You don't know the mark allocation
   - Focus on what the student wrote, not what's missing

═══════════════════════════════════════════════════════════════════════════════
                           OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════════════

Respond in JSON format ONLY:
{
  "score": <estimated marks earned>,
  "maxScore": <estimated total marks based on questions visible>,
  "feedback": "<2-3 sentence supportive summary noting this was graded without a mark scheme>",
  "breakdown": [
    {
      "questionId": "<question number if visible>",
      "points": <estimated marks>,
      "maxPoints": <estimated max marks>,
      "status": "correct" | "partial" | "incorrect" | "unanswered",
      "feedback": "<1-3 sentence supportive analysis with practical next step>",
      "containsDiagram": false
    }
  ]
}

DIAGRAM/GRAPH DETECTION:
- Set "containsDiagram": true if the student's answer contains a diagram, graph, drawing, chart, or any visual element
- Clues: [DIAGRAM: ...] descriptions in OCR text, references to drawn elements, arrows, boxes, nodes, plotted points, sketched curves, labelled axes
- Still grade diagram questions to the best of your ability, but flag them for teacher review

⚠️ IMPORTANT:
- Start overall feedback with "Graded without mark scheme: "
- Be generous when uncertain
- Focus on what the student got right
- Note any obvious errors
- Use a supportive teacher tone (not robotic or harsh)
- Overall feedback: 2-3 sentences with strength, gap, and next step
- Per-question feedback MUST be DETAILED using markdown formatting:
  - Use **bold** for key terms, correct answers, important values
  - Use bullet points (- ) to break down each point separately
  - For each point: state what the student wrote and whether it appears correct
  - NO filler text - just clear, structured analysis
- Vary sentence structure; avoid repeating the same template
${buildLanguageReminder(feedbackLanguage)}

IMPORTANT: Only respond with valid JSON.`;

    let response;
    try {
      response = await ai.models.generateContent({
        model: GEMINI_GRADING_MODEL,
        contents: prompt,
        config: { maxOutputTokens: 65536 },
      });
    } catch (apiError) {
      console.error("Gemini fallback grading API call failed:", apiError);
      throw new Error(`Gemini fallback grading failed: ${apiError instanceof Error ? apiError.message : 'Unknown error'}`);
    }

    let responseText = response?.text || "";

    // Clean up the response
    responseText = responseText.trim();
    if (responseText.startsWith("```json")) {
      responseText = responseText.slice(7);
    } else if (responseText.startsWith("```")) {
      responseText = responseText.slice(3);
    }
    if (responseText.endsWith("```")) {
      responseText = responseText.slice(0, -3);
    }
    responseText = responseText.trim();

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error("JSON parse error in fallback grading. Response:", responseText.substring(0, 500));
      // Return a basic result if parsing fails
      return {
        score: 0,
        maxScore: totalMarks || 100,
        feedback: "Graded without mark scheme: Unable to fully analyze the submission. Please add a mark scheme for accurate grading.",
        breakdown: [{
          questionId: "All",
          points: 0,
          maxPoints: totalMarks || 100,
          status: "partial",
          feedback: "The submission was received but could not be fully analyzed without a mark scheme.",
        }],
      };
    }

    const breakdownMax = (result.breakdown || []).reduce((sum: number, q: { maxPoints?: number }) => sum + (q.maxPoints || 0), 0);
    let maxScore: number;
    if (totalMarks > 0) {
      maxScore = totalMarks;
    } else if (result.maxScore && result.maxScore > 0) {
      maxScore = result.maxScore;
    } else if (breakdownMax > 0) {
      maxScore = breakdownMax;
    } else {
      maxScore = 100;
    }
    let validatedScore = Math.min(Math.max(0, result.score || 0), maxScore);

    // Always trust the breakdown sum over the AI's stated total
    const breakdownScore = (result.breakdown || []).reduce((sum: number, q: { points?: number }) => sum + (q.points || 0), 0);
    let feedbackText = result.feedback || `Graded without mark scheme: ${validatedScore}/${maxScore}`;
    if (breakdownScore > 0 && breakdownScore !== validatedScore) {
      console.log(`Fallback score mismatch: AI returned ${validatedScore} but breakdown sums to ${breakdownScore}. Using breakdown sum.`);
      const oldScore = validatedScore;
      validatedScore = Math.min(breakdownScore, maxScore);
      // Fix score references in the feedback text
      const pct = Math.round((validatedScore / maxScore) * 100);
      feedbackText = feedbackText
        .replace(`${oldScore}/${maxScore}`, `${validatedScore}/${maxScore}`)
        .replace(`(${Math.round((oldScore / maxScore) * 100)}%)`, `(${pct}%)`);
    }

    console.log(`Fallback grading complete: ${validatedScore}/${maxScore}`);

    return {
      score: validatedScore,
      maxScore: maxScore,
      feedback: feedbackText,
      breakdown: result.breakdown || [],
    };
  } catch (error) {
    console.error("Fallback grading error:", error);
    return {
      score: 0,
      maxScore: totalMarks || 100,
      feedback: "Graded without mark scheme: An error occurred during grading. Please add a mark scheme for accurate results.",
      breakdown: [{
        questionId: "All",
        points: 0,
        maxPoints: totalMarks || 100,
        status: "partial",
        feedback: `Grading error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
    };
  }
}

function mockGrading(totalMarks: number): GradingResult {
  return {
    score: 0,
    maxScore: totalMarks,
    feedback: "Unable to grade submission. Please ensure GEMINI_API_KEY is configured.",
    breakdown: [
      {
        questionId: "All",
        points: 0,
        maxPoints: totalMarks,
        status: "unanswered",
        feedback: "Grading requires GEMINI_API_KEY to be configured. Please check your environment variables.",
      },
    ],
  };
}

/**
 * Detect the primary language of a text sample using Gemini 2.0 Flash Lite.
 * Returns a lowercase language name like "english", "uzbek", "russian", "french", etc.
 * Falls back to "english" if detection fails.
 */
export async function detectLanguage(text: string): Promise<string> {
  if (!text || text.trim().length < 20) return "english";

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "english";

  try {
    const ai = new GoogleGenAI({ apiKey });
    const sample = text.slice(0, 1000);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [{
            text: `Detect the primary language of the following text. Reply with ONLY the language name in lowercase English (e.g. "english", "uzbek", "russian", "french", "german", "arabic", "chinese", etc.). No explanation.\n\nText:\n${sample}`,
          }],
        },
      ],
    });
    const raw = response.text?.trim().toLowerCase().replace(/[^a-z]/g, "") || "english";
    return raw || "english";
  } catch {
    return "english";
  }
}

/**
 * Localized labels for formatFeedbackAsMarkdown section headers.
 * Only languages with known translations are listed; others fall back to English.
 */
const FORMAT_LABELS: Record<string, { gradingResults: string; score: string; overallFeedback: string; breakdown: string; question: string; deductions: string; mark: string; marks: string; diagramReview: string }> = {
  english: { gradingResults: "Grading Results", score: "Score", overallFeedback: "Overall Feedback", breakdown: "Question-by-Question Breakdown", question: "Question", deductions: "Deductions", mark: "mark", marks: "marks", diagramReview: "This question contains a diagram/graph. Consider reviewing the original submission image for accuracy." },
  uzbek: { gradingResults: "Baholash Natijalari", score: "Ball", overallFeedback: "Umumiy Fikr-mulohaza", breakdown: "Savol bo'yicha Tahlil", question: "savol", deductions: "Ayirmalar", mark: "ball", marks: "ball", diagramReview: "Bu savolda diagramma/grafik mavjud. Aniqlik uchun asl yuborilgan rasmni ko'rib chiqing." },
  russian: { gradingResults: "Результаты Оценки", score: "Баллы", overallFeedback: "Общий Отзыв", breakdown: "Разбор по Вопросам", question: "Вопрос", deductions: "Вычеты", mark: "балл", marks: "баллов", diagramReview: "Этот вопрос содержит диаграмму/график. Рекомендуется проверить оригинальное изображение работы." },
  french: { gradingResults: "Résultats de la Notation", score: "Note", overallFeedback: "Commentaire Général", breakdown: "Analyse par Question", question: "Question", deductions: "Déductions", mark: "point", marks: "points", diagramReview: "Cette question contient un diagramme/graphique. Veuillez vérifier l'image originale." },
  german: { gradingResults: "Bewertungsergebnisse", score: "Punkte", overallFeedback: "Gesamtfeedback", breakdown: "Aufschlüsselung nach Fragen", question: "Frage", deductions: "Abzüge", mark: "Punkt", marks: "Punkte", diagramReview: "Diese Frage enthält ein Diagramm/Grafik. Bitte überprüfen Sie das Originalbild." },
  arabic: { gradingResults: "نتائج التقييم", score: "الدرجة", overallFeedback: "التقييم العام", breakdown: "تحليل كل سؤال", question: "السؤال", deductions: "الخصومات", mark: "درجة", marks: "درجات", diagramReview: "يحتوي هذا السؤال على رسم بياني. يرجى مراجعة الصورة الأصلية للتحقق." },
  ukrainian: { gradingResults: "Результати Оцінювання", score: "Бали", overallFeedback: "Загальний Відгук", breakdown: "Розбір по Питаннях", question: "Питання", deductions: "Відрахування", mark: "бал", marks: "балів", diagramReview: "Це питання містить діаграму/графік. Рекомендується перевірити оригінальне зображення." },
  japanese: { gradingResults: "採点結果", score: "得点", overallFeedback: "総合フィードバック", breakdown: "問題別分析", question: "問", deductions: "減点", mark: "点", marks: "点", diagramReview: "この問題には図/グラフが含まれています。正確性のため原本画像を確認してください。" },
  chinese: { gradingResults: "评分结果", score: "得分", overallFeedback: "总体反馈", breakdown: "逐题分析", question: "题", deductions: "扣分", mark: "分", marks: "分", diagramReview: "此题包含图表/图形，建议查看原始提交图片以确认准确性。" },
};

export function formatFeedbackAsMarkdown(result: GradingResult, feedbackLanguage: string = "english"): string {
  const labels = FORMAT_LABELS[feedbackLanguage] || FORMAT_LABELS.english;
  const isUzbek = feedbackLanguage === "uzbek";

  // Header
  let markdown = `## ${labels.gradingResults}\n\n`;

  // Score
  markdown += `**${labels.score}: ${result.score}/${result.maxScore}** (${result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0}%)\n\n`;

  // Overall feedback
  markdown += `### ${labels.overallFeedback}\n${result.feedback}\n\n`;

  if (result.breakdown.length > 0) {
    markdown += `### ${labels.breakdown}\n\n`;

    for (const item of result.breakdown) {
      // Status emoji
      const statusEmoji = {
        correct: "\u2705", // green check
        partial: "\u26a0\ufe0f", // warning
        incorrect: "\u274c", // red X
        unanswered: "\u2b55", // hollow circle
      }[item.status] || "";

      // Uzbek uses "1-savol" format, others use "Question 1" format
      markdown += isUzbek
        ? `#### ${statusEmoji} ${item.questionId}-${labels.question}\n`
        : `#### ${statusEmoji} ${labels.question} ${item.questionId}\n`;
      markdown += `**${labels.score}:** ${item.points}/${item.maxPoints}\n\n`;
      if (item.containsDiagram) {
        markdown += `> \u{1F4D0} **${labels.diagramReview}**\n\n`;
      }
      markdown += `${item.feedback}\n\n`;

      // Show deductions if any
      if (item.deductions && item.deductions.length > 0) {
        markdown += `**${labels.deductions}:**\n`;
        for (const deduction of item.deductions) {
          markdown += `- \u2212${deduction.pointsLost} ${deduction.pointsLost !== 1 ? labels.marks : labels.mark}: ${deduction.reason}\n`;
        }
        markdown += `\n`;
      }
    }
  }

  return markdown;
}
