import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { invalidateSubmissionCache } from "@/lib/submission-cache";
import { invalidateClassDetailCache } from "@/lib/server-cache";

/**
 * PATCH /api/submissions/[submissionId]/adjust-questions
 *
 * Teacher adjusts individual question marks. Rebuilds the feedback markdown
 * with updated per-question scores and recalculates the overall score.
 *
 * Body: { questions: Array<{ index: number; points: number; reason: string }> }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { submissionId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { questions } = body as {
      questions: Array<{ index: number; points: number; reason: string; feedback?: string }>;
    };

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json(
        { error: "Questions array is required" },
        { status: 400 }
      );
    }

    // Validate each question has a reason
    for (const q of questions) {
      if (!q.reason || q.reason.trim() === "") {
        return NextResponse.json(
          { error: `Reason is required for question ${q.index + 1}` },
          { status: 400 }
        );
      }
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assessment: {
          include: {
            class: {
              select: { teacherId: true },
            },
          },
        },
        student: {
          select: { id: true, name: true, email: true },
        },
        questionResults: {
          orderBy: { questionNumber: "asc" },
        },
      },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    // Only teacher or co-teacher can adjust
    const isPatchOwner =
      submission.assessment.class.teacherId === session.user.id;
    if (!isPatchOwner) {
      const hasAccess = await isUserClassTeacher(
        session.user.id,
        submission.assessment.classId
      );
      if (!hasAccess) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const hasQuestionResults = (submission as typeof submission & { questionResults: { id: string; questionNumber: string; score: number; maxScore: number; status: string; feedback: string | null }[] }).questionResults.length > 0;
    const questionResultsList = (submission as typeof submission & { questionResults: { id: string; questionNumber: string; score: number; maxScore: number; status: string; feedback: string | null }[] }).questionResults;

    if (!hasQuestionResults && !submission.feedback) {
      return NextResponse.json(
        { error: "No feedback to adjust — submission has not been graded" },
        { status: 400 }
      );
    }

    const originalScore = submission.originalScore ?? submission.score;
    const scoreBefore = submission.score ?? 0;

    if (hasQuestionResults) {
      // ── QuestionResult path (multimodal grading) ──────────────────
      // Validate question indices against questionResults array
      for (const q of questions) {
        if (q.index < 0 || q.index >= questionResultsList.length) {
          return NextResponse.json(
            { error: `Invalid question index ${q.index}. Must be 0-${questionResultsList.length - 1}` },
            { status: 400 }
          );
        }
        const qr = questionResultsList[q.index];
        if (q.points < 0 || q.points > qr.maxScore) {
          return NextResponse.json(
            { error: `Score for question ${q.index + 1} must be between 0 and ${qr.maxScore}` },
            { status: 400 }
          );
        }
      }

      // Calculate new per-question scores
      const updatedQRScores = questionResultsList.map((qr, i) => {
        const change = questions.find((q) => q.index === i);
        return change ? { ...qr, score: change.points } : qr;
      });
      const newScore = updatedQRScores.reduce((sum, qr) => sum + qr.score, 0);

      const historyChanges = questions.map((q) => {
        const qr = questionResultsList[q.index];
        return {
          questionIndex: q.index,
          questionTitle: qr.questionNumber,
          pointsBefore: qr.score,
          pointsAfter: q.points,
          maxPoints: qr.maxScore,
          reason: q.reason.trim(),
        };
      });

      const changedDetails = questions
        .map((q) => {
          const qr = questionResultsList[q.index];
          return `Q${q.index + 1} (${qr.questionNumber}): ${qr.score} -> ${q.points}/${qr.maxScore} — ${q.reason.trim()}`;
        })
        .join("; ");

      // Optionally update header score in legacy feedback markdown if present
      let newFeedback = submission.feedback ?? null;
      if (newFeedback) {
        newFeedback = updateHeaderScore(newFeedback, newScore, submission.maxScore ?? submission.assessment.totalMarks ?? 100);
      }

      const getStatusFromScore = (score: number, maxScore: number) => {
        if (score === maxScore) return "correct";
        if (score === 0) return "incorrect";
        return "partial";
      };

      await prisma.$transaction([
        prisma.submission.update({
          where: { id: submissionId },
          data: {
            score: newScore,
            ...(newFeedback !== null ? { feedback: newFeedback } : {}),
            originalScore: originalScore,
            adjustedBy: session.user.id,
            adjustmentReason: changedDetails,
            adjustedAt: new Date(),
            reportReason: null,
            reportedAt: null,
          },
        }),
        ...questions.map((q) => {
          const qr = questionResultsList[q.index];
          return prisma.questionResult.update({
            where: { id: qr.id },
            data: {
              score: q.points,
              status: getStatusFromScore(q.points, qr.maxScore),
              ...(q.feedback !== undefined ? { feedback: q.feedback } : {}),
            },
          });
        }),
        prisma.scoreAdjustment.create({
          data: {
            submissionId,
            adjustedBy: session.user.id,
            scoreBefore,
            scoreAfter: newScore,
            changes: JSON.stringify(historyChanges),
          },
        }),
      ]);
    } else {
      // ── Markdown path (legacy text grading) ───────────────────────
      const parsed = parseQuestionBlocks(submission.feedback!);

      if (parsed.questionBlocks.length === 0) {
        return NextResponse.json(
          { error: "No per-question breakdown found in feedback" },
          { status: 400 }
        );
      }

      for (const q of questions) {
        if (q.index < 0 || q.index >= parsed.questionBlocks.length) {
          return NextResponse.json(
            { error: `Invalid question index ${q.index}. Must be 0-${parsed.questionBlocks.length - 1}` },
            { status: 400 }
          );
        }
        const block = parsed.questionBlocks[q.index];
        if (block.maxPoints === null) {
          return NextResponse.json(
            { error: `Question ${q.index + 1} has no max points defined` },
            { status: 400 }
          );
        }
        if (q.points < 0 || q.points > block.maxPoints) {
          return NextResponse.json(
            { error: `Score for question ${q.index + 1} must be between 0 and ${block.maxPoints}` },
            { status: 400 }
          );
        }
      }

      const originalBlocks = parseQuestionBlocks(submission.feedback!);
      for (const q of questions) {
        parsed.questionBlocks[q.index].points = q.points;
      }

      const newScore = parsed.questionBlocks.reduce((sum, b) => sum + (b.points ?? 0), 0);

      let updatedFeedback = rebuildFeedbackMarkdown(submission.feedback!, parsed, questions);
      const questionsWithFeedback = questions.filter((q) => q.feedback !== undefined);
      if (questionsWithFeedback.length > 0) {
        updatedFeedback = replaceQuestionFeedbackText(updatedFeedback, parsed, questionsWithFeedback);
      }
      const feedbackWithUpdatedHeader = updateHeaderScore(
        updatedFeedback,
        newScore,
        submission.maxScore ?? submission.assessment.totalMarks ?? 100
      );

      const historyChanges = questions.map((q) => {
        const block = parsed.questionBlocks[q.index];
        const oldPoints = originalBlocks.questionBlocks[q.index].points;
        return {
          questionIndex: q.index,
          questionTitle: block.title,
          pointsBefore: oldPoints,
          pointsAfter: q.points,
          maxPoints: block.maxPoints,
          reason: q.reason.trim(),
        };
      });

      const changedDetails = questions
        .map((q) => {
          const block = parsed.questionBlocks[q.index];
          const oldPoints = originalBlocks.questionBlocks[q.index].points;
          return `Q${q.index + 1} (${block.title}): ${oldPoints} -> ${q.points}/${block.maxPoints} — ${q.reason.trim()}`;
        })
        .join("; ");

      await prisma.$transaction([
        prisma.submission.update({
          where: { id: submissionId },
          data: {
            score: newScore,
            feedback: feedbackWithUpdatedHeader,
            originalScore: originalScore,
            adjustedBy: session.user.id,
            adjustmentReason: changedDetails,
            adjustedAt: new Date(),
            reportReason: null,
            reportedAt: null,
          },
        }),
        prisma.scoreAdjustment.create({
          data: {
            submissionId,
            adjustedBy: session.user.id,
            scoreBefore,
            scoreAfter: newScore,
            changes: JSON.stringify(historyChanges),
          },
        }),
      ]);
    }

    // Fetch the updated submission with adjustments and questionResults included
    const updatedSubmission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        student: {
          select: { id: true, name: true, email: true },
        },
        assessment: {
          select: {
            id: true,
            title: true,
            markScheme: true,
            markSchemePdfUrl: true,
            markSchemeFileUrls: true,
            totalMarks: true,
            class: {
              select: { name: true, teacherId: true },
            },
          },
        },
        adjustments: {
          orderBy: { adjustedAt: "desc" },
          include: {
            adjuster: { select: { id: true, name: true } },
          },
        },
        questionResults: {
          orderBy: { questionNumber: "asc" },
        },
      },
    });

    invalidateSubmissionCache(submissionId);
    invalidateClassDetailCache(submission.assessment.classId);
    return NextResponse.json({ submission: updatedSubmission });
  } catch (error) {
    console.error("Error adjusting question scores:", error);
    return NextResponse.json(
      { error: "Failed to adjust question scores" },
      { status: 500 }
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────

interface QuestionBlock {
  title: string;
  points: number | null;
  maxPoints: number | null;
  rawHeading: string;
  scoreMatchText: string | null;
  scoreMatchStart: number;
  scoreMatchEnd: number;
}

interface ParsedFeedback {
  questionBlocks: QuestionBlock[];
}

function parseQuestionBlocks(feedback: string): ParsedFeedback {
  const normalized = feedback.replace(/\r\n/g, "\n");

  // Find the ### question breakdown section
  const sectionRegex = /\n(?=###\s+)/g;
  const sections: string[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = sectionRegex.exec(normalized)) !== null) {
    sections.push(normalized.slice(lastIdx, m.index));
    lastIdx = m.index + 1;
  }
  sections.push(normalized.slice(lastIdx));

  // Find the question breakdown section (second ### section)
  let questionSectionIdx = -1;
  let sectionCount = 0;
  let charOffset = 0;
  for (let i = 0; i < sections.length; i++) {
    if (/^###\s+/.test(sections[i])) {
      sectionCount++;
      if (sectionCount === 2) {
        questionSectionIdx = i;
        break;
      }
    }
    charOffset += sections[i].length + (i < sections.length - 1 ? 1 : 0);
  }

  if (questionSectionIdx === -1) {
    return { questionBlocks: [] };
  }

  const questionSection = sections[questionSectionIdx];
  const headerEnd = questionSection.indexOf("\n");
  const sectionBody =
    headerEnd >= 0 ? questionSection.slice(headerEnd + 1) : "";
  const sectionBodyStart = charOffset + (headerEnd >= 0 ? headerEnd + 1 : 0);

  const questionRegex = /####\s+([^\n]+)\n([\s\S]*?)(?=\n####\s+|$)/g;
  const blocks: QuestionBlock[] = [];
  let qMatch: RegExpExecArray | null;

  while ((qMatch = questionRegex.exec(sectionBody)) !== null) {
    const rawHeading = qMatch[1].trim();
    const rawBody = qMatch[2].trim();

    const scoreRegex =
      /\*\*(?:Ball|Score|Баллы|Note|Punkte|الدرجة|Бали|得点|得分):?\*\*:?\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i;
    const scoreMatch = scoreRegex.exec(rawBody);
    const points = scoreMatch ? Number(scoreMatch[1]) : null;
    const maxPoints = scoreMatch ? Number(scoreMatch[2]) : null;

    const title =
      rawHeading.replace(/^(?:✅|⚠️?|❌|⭕|◯|\s)+/u, "").trim() ||
      `Question ${blocks.length + 1}`;

    // Calculate absolute positions of the score match within the full feedback
    const fullMatchStart = sectionBodyStart + qMatch.index;
    const scoreInFullBody = scoreMatch
      ? sectionBodyStart +
        qMatch.index +
        qMatch[0].indexOf(scoreMatch[0], rawHeading.length)
      : 0;

    blocks.push({
      title,
      points,
      maxPoints,
      rawHeading,
      scoreMatchText: scoreMatch ? scoreMatch[0] : null,
      scoreMatchStart: scoreInFullBody,
      scoreMatchEnd: scoreMatch ? scoreInFullBody + scoreMatch[0].length : 0,
    });
  }

  return { questionBlocks: blocks };
}

function rebuildFeedbackMarkdown(
  originalFeedback: string,
  parsed: ParsedFeedback,
  changes: Array<{ index: number; points: number }>
): string {
  let result = originalFeedback.replace(/\r\n/g, "\n");

  // Sort changes by scoreMatchStart descending so replacements don't shift indices
  const sortedChanges = [...changes].sort((a, b) => {
    const blockA = parsed.questionBlocks[a.index];
    const blockB = parsed.questionBlocks[b.index];
    return blockB.scoreMatchStart - blockA.scoreMatchStart;
  });

  for (const change of sortedChanges) {
    const block = parsed.questionBlocks[change.index];
    if (!block.scoreMatchText) continue;

    // Replace the score value
    const newScoreText = block.scoreMatchText.replace(
      /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/,
      `${change.points}/${block.maxPoints}`
    );

    result =
      result.slice(0, block.scoreMatchStart) +
      newScoreText +
      result.slice(block.scoreMatchEnd);

    // Update the heading emoji based on new status
    const newStatus = getStatus(change.points, block.maxPoints!);
    const oldEmoji = getHeadingEmoji(block.rawHeading);
    const newEmoji = statusToEmoji(newStatus);

    if (oldEmoji && newEmoji !== oldEmoji) {
      const headingInResult = `#### ${block.rawHeading}`;
      const newHeading = `#### ${block.rawHeading.replace(oldEmoji, newEmoji)}`;
      result = result.replace(headingInResult, newHeading);
    }
  }

  return result;
}

function updateHeaderScore(
  feedback: string,
  newScore: number,
  maxScore: number
): string {
  const percentage =
    maxScore > 0 ? Math.round((newScore / maxScore) * 100) : 0;
  return feedback.replace(
    /\*\*(?:Ball|Score|Баллы|Note|Punkte|الدرجة|Бали|得点|得分):\s*\d+(?:\.\d+)?\/\d+(?:\.\d+)?\*\*\s*\(\d+%\)/i,
    (match) => {
      const labelMatch = match.match(
        /\*\*(?:Ball|Score|Баллы|Note|Punkte|الدرجة|Бали|得点|得分)/i
      );
      const label = labelMatch ? labelMatch[0] : "**Score";
      return `${label}: ${newScore}/${maxScore}** (${percentage}%)`;
    }
  );
}

function getStatus(
  points: number,
  maxPoints: number
): "correct" | "partial" | "incorrect" | "unanswered" {
  if (points === maxPoints) return "correct";
  if (points === 0) return "incorrect";
  return "partial";
}

function getHeadingEmoji(heading: string): string | null {
  if (heading.includes("✅")) return "✅";
  if (heading.includes("⚠️")) return "⚠️";
  if (heading.includes("⚠")) return "⚠";
  if (heading.includes("❌")) return "❌";
  if (heading.includes("⭕")) return "⭕";
  if (heading.includes("◯")) return "◯";
  return null;
}

function statusToEmoji(
  status: "correct" | "partial" | "incorrect" | "unanswered"
): string {
  switch (status) {
    case "correct":
      return "✅";
    case "partial":
      return "⚠️";
    case "incorrect":
      return "❌";
    case "unanswered":
      return "⭕";
  }
}

function replaceQuestionFeedbackText(
  feedback: string,
  parsed: ParsedFeedback,
  changes: Array<{ index: number; feedback?: string }>
): string {
  const normalized = feedback.replace(/\r\n/g, "\n");
  const questionRegex = /####\s+([^\n]+)\n([\s\S]*?)(?=\n####\s+|\n###\s+|$)/g;
  const matches: Array<{ start: number; end: number; heading: string }> = [];
  let qMatch: RegExpExecArray | null;

  while ((qMatch = questionRegex.exec(normalized)) !== null) {
    matches.push({
      start: qMatch.index,
      end: qMatch.index + qMatch[0].length,
      heading: qMatch[1],
    });
  }

  let result = normalized;
  const sortedChanges = [...changes]
    .filter((c) => c.feedback !== undefined)
    .sort((a, b) => b.index - a.index);

  for (const change of sortedChanges) {
    if (change.index >= matches.length) continue;
    const match = matches[change.index];
    const headingLine = `#### ${match.heading}\n`;
    const newSection = headingLine + change.feedback!.trim();
    result = result.slice(0, match.start) + newSection + result.slice(match.end);
  }

  return result;
}
