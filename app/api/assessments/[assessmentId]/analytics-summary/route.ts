import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isSuperAdmin } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assessmentId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { assessmentId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { analyticsSummary: true },
    });

    if (!assessment) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    return NextResponse.json({ summary: assessment.analyticsSummary || null }, {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("Analytics summary GET error:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assessmentId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { assessmentId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user has teacher-level access to this assessment's class
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        analyticsSummary: true,
        class: {
          select: {
            teacherId: true,
            enrollments: {
              where: { studentId: session.user.id },
              select: { studentId: true, role: true },
            },
          },
        },
      },
    });

    if (!assessment) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    const isOwner = assessment.class.teacherId === session.user.id;
    const isCoTeacher = assessment.class.enrollments.some(
      (e) => e.studentId === session.user.id && e.role === "TEACHER"
    );
    const isSA = await isSuperAdmin(session.user.id);

    if (!isOwner && !isCoTeacher && !isSA) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Return cached summary if it exists
    if (assessment.analyticsSummary) {
      return NextResponse.json({ summary: assessment.analyticsSummary, cached: true });
    }

    const body = await request.json();
    const { title, scores, maxScore, classAvg, totalStudents, topMistakes } = body;

    if (!scores || !Array.isArray(scores) || scores.length < 2) {
      return NextResponse.json({ error: "Not enough data" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured" }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const sortedScores = [...scores].sort((a, b) => a - b);
    const median = sortedScores[Math.floor(sortedScores.length / 2)];
    const min = sortedScores[0];
    const max = sortedScores[sortedScores.length - 1];

    const prompt = `You are an expert teacher analytics assistant. Analyze these class assessment results and provide a concise 3-5 sentence summary with actionable insights.

Assessment: "${title}"
Total students graded: ${totalStudents}
Max possible score: ${maxScore}
Class average: ${classAvg}%
Score range: ${min}-${max}/${maxScore} (median: ${median}/${maxScore})
${topMistakes && topMistakes.length > 0 ? `Most problematic questions:\n${topMistakes.join("\n")}` : ""}

Write a brief, insightful summary covering:
1. Overall class performance assessment (strong/weak/average)
2. Key patterns or concerns (e.g. bimodal distribution, specific weak areas)
3. One specific teaching recommendation

Keep it professional but conversational. Do NOT use bullet points or headers - write flowing prose. Do not exceed 5 sentences.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    const summary = response.text?.trim() || "";

    // Save to database for caching
    if (summary) {
      await prisma.assessment.update({
        where: { id: assessmentId },
        data: { analyticsSummary: summary },
      });
    }

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Analytics summary error:", error);
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 }
    );
  }
}
