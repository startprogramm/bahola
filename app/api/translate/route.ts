import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getAuthSession } from "@/lib/auth";

const GEMINI_MODEL = "gemini-3-flash-preview";
const MAX_TRANSLATE_CHARS = 10_000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { text, targetLanguage = "uzbek" } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    if (text.length > MAX_TRANSLATE_CHARS) {
      return NextResponse.json(
        { error: `Text is too long. Maximum length is ${MAX_TRANSLATE_CHARS} characters.` },
        { status: 400 }
      );
    }

    const ai = getGeminiClient();

    const prompt = `You are a professional translator. Translate the following text to ${targetLanguage}.

IMPORTANT:
- Provide ONLY the translated text, no explanations or notes
- Preserve the original formatting (paragraphs, bullet points, etc.)
- Keep technical terms if there's no good equivalent
- For educational/grading content, use appropriate academic terminology

Text to translate:
${text}

Translation:`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const translatedText = response.text?.trim() || "";

    if (!translatedText) {
      throw new Error("Translation returned empty result");
    }

    return NextResponse.json({ translatedText });
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json(
      { error: "Failed to translate text" },
      { status: 500 }
    );
  }
}
