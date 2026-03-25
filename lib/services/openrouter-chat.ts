/**
 * Chat Completion Service — Gemini API
 *
 * Uses Google Gemini API directly for chat completions.
 * Model: gemini-3-flash-preview (configurable via CHAT_MODEL env var).
 */

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const CHAT_MODEL = process.env.CHAT_MODEL || "gemini-3-flash-preview";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Convert OpenAI-style messages to Gemini format
function toGeminiMessages(systemPrompt: string, messages: ChatMessage[]) {
  const contents = messages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));
  return {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
  };
}

// ─── Non-streaming completion ────────────────────────────────

export async function chatCompletion(
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const body = toGeminiMessages(systemPrompt, messages);

  const res = await fetch(
    `${GEMINI_API_URL}/${CHAT_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ─── Streaming completion (returns our SSE format) ───────────

export function createChatStream(
  systemPrompt: string,
  messages: ChatMessage[],
  onComplete?: (fullReply: string) => Promise<void>
): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY not set");

        const body = toGeminiMessages(systemPrompt, messages);

        const res = await fetch(
          `${GEMINI_API_URL}/${CHAT_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Gemini API error (${res.status}): ${text}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullReply = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const payload = trimmed.slice(6);
            if (payload === "[DONE]") continue;

            try {
              const chunk = JSON.parse(payload);
              const delta = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
              if (delta) {
                fullReply += delta;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`
                  )
                );
              }
            } catch {}
          }
        }

        // Credit deduction callback
        if (fullReply.trim().length > 0 && onComplete) {
          await onComplete(fullReply);
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[Gemini Chat Stream Error]", msg);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "error",
              message: msg.includes("API") || msg.includes("Gemini")
                ? "AI service error. Please try again."
                : "Failed to process chat.",
            })}\n\n`
          )
        );
        controller.close();
      }
    },
  });
}
