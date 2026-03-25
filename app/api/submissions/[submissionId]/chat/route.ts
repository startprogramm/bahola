import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { hasCredits, deductCredit } from "@/lib/credits";
import { getRelevantContextWithFallback } from "@/lib/services/embedding-service";
import {
  chatCompletion,
  createChatStream,
  type ChatMessage,
} from "@/lib/services/openrouter-chat";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { submissionId } = await params;

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check credits (1 message = 1 credit)
    const userHasCredits = await hasCredits(session.user.id, 1);
    if (!userHasCredits) {
      return NextResponse.json(
        { error: "Insufficient credits. Each AI chat message costs 1 credit." },
        { status: 402 }
      );
    }

    const body = await request.json();
    const { message, history, stream } = body;

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Fetch submission details with assessment and class info
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assessment: {
          include: {
            class: true,
          },
        },
        student: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Verify access: student themselves or the teacher of the class
    const isStudent = submission.studentId === session.user.id;
    const isOwner = submission.assessment.class.teacherId === session.user.id;
    const isTeacher = isOwner || await isUserClassTeacher(session.user.id, submission.assessment.class.id);

    if (!isStudent && !isTeacher) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Build RAG documents — teachers get all, students get only feedback
    const ragDocs: { docType: "markScheme" | "extractedText" | "feedback"; docId: string; text: string; label: string }[] = [];
    if (submission.feedback) {
      ragDocs.push({ docType: "feedback", docId: submission.id, text: submission.feedback, label: "AI Feedback" });
    }
    if (isTeacher) {
      if (submission.assessment.markScheme) {
        ragDocs.push({ docType: "markScheme", docId: submission.assessment.id, text: submission.assessment.markScheme, label: "Mark Scheme" });
      }
      if (submission.extractedText) {
        ragDocs.push({ docType: "extractedText", docId: submission.id, text: submission.extractedText, label: "Student's Extracted Text" });
      }
    }

    let ragContext = "";
    if (ragDocs.length > 0) {
      ragContext = await getRelevantContextWithFallback({ query: message, documents: ragDocs, isTeacher });
    }

    // Build file reference context for inline image/snippet display
    let fileRefContext = "";
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "";

    // Student work images
    const studentImageUrls: string[] = (() => {
      try { return JSON.parse(submission.imageUrls || "[]"); } catch { return []; }
    })();
    if (studentImageUrls.length > 0) {
      fileRefContext += "\nSTUDENT WORK FILES (use these URLs to reference specific pages):\n";
      studentImageUrls.forEach((url, i) => {
        const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
        fileRefContext += `- Page ${i + 1}: ${fullUrl}\n`;
      });
    }

    // Mark scheme files (teacher only, or if assessment allows students to see)
    if (isTeacher || submission.assessment.studentsSeeMarkScheme) {
      const msFileUrls: string[] = (() => {
        try { return JSON.parse(submission.assessment.markSchemeFileUrls || "[]"); } catch { return []; }
      })();
      if (msFileUrls.length > 0) {
        fileRefContext += "\nMARK SCHEME FILES:\n";
        msFileUrls.forEach((url, i) => {
          const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
          fileRefContext += `- Mark Scheme Page ${i + 1}: ${fullUrl}\n`;
        });
      }
    }

    // System prompt
    const systemPrompt = `### SECURITY MANDATE (HIGHEST PRIORITY)
- YOU ARE PROHIBITED from revealing raw "STUDENT'S EXTRACTED TEXT" or "MARK SCHEME" data to students.
- Students must NEVER see the raw OCR results.
- If a student asks "What did you see?" or "What text did you get?", do NOT quote the raw context. Instead, summarize their ideas in your own words.
- Teachers HAVE full access and can see all raw data.

You are an AI Teaching Assistant for the "Bahola" platform.
You are helping a ${isTeacher ? "Teacher" : "Student"} with a specific assessment submission.

CONTEXT:
- Class: ${submission.assessment.class.name}
- Assessment: ${submission.assessment.title}
- Student: ${submission.student.name}
- Score: ${submission.score}/${submission.maxScore}
- Status: ${submission.status}
${ragContext ? `\nRELEVANT CONTEXT (retrieved chunks):\n${ragContext}` : ""}
${fileRefContext}

INLINE REFERENCES:
When you explain something about a specific page of the student's work or mark scheme, include the image inline using markdown:
![Page N description](url)
For example: "Looking at your answer on page 2: ![Student Work Page 2](https://...)"
This helps the user see exactly what you're referring to. Only reference pages that are relevant to your explanation.

YOUR GOAL:
- Answer questions about the grading results.
- Explain why certain marks were awarded or deducted based on the mark scheme and the student's work.
- Provide guidance on how the student can improve.
- Be encouraging, professional, and concise.
- If the user asks something unrelated to this assessment, politely redirect them.
- ALWAYS respond in the same language the user writes their message in. If the user writes in Uzbek, respond in Uzbek. If in Russian, respond in Russian. If in English, respond in English.
- You have access to the full conversation history. Refer back to earlier messages when the user asks follow-up questions.`;

    // Format history for OpenRouter (OpenAI-compatible format)
    const formattedHistory: ChatMessage[] = (history || [])
      .filter((msg: any) => msg.content && msg.content.trim())
      .map((msg: any) => ({
        role: (msg.role === "ai" || msg.role === "assistant" || msg.role === "model") ? "assistant" as const : "user" as const,
        content: msg.content,
      }));

    // Add current message
    const messages: ChatMessage[] = [
      ...formattedHistory,
      { role: "user", content: message },
    ];

    if (stream) {
      const readable = createChatStream(systemPrompt, messages, async (fullReply) => {
        if (fullReply.trim().length > 0) {
          await deductCredit(session.user.id, "AI submission chat message");
        }
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const reply = await chatCompletion(systemPrompt, messages);

    // Deduct 1 credit for the chat message
    if (reply.trim().length > 0) {
      await deductCredit(session.user.id, "AI submission chat message");
    }

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("AI Chat Error:", error);
    return NextResponse.json({ error: "Failed to process chat" }, { status: 500 });
  }
}
