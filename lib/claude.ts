import Anthropic from "@anthropic-ai/sdk";
import type { CurationResult } from "./types";

const client = new Anthropic();

export async function curate(
  topic: string,
  labelA: string,
  labelB: string
): Promise<CurationResult> {
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system:
      "You are an expert book curator. Return ONLY raw JSON — no markdown, no backticks, no explanation.",
    messages: [
      {
        role: "user",
        content: `Topic: "${topic}"\nPerspective: "${labelA}" vs "${labelB}"\n\nRecommend 3–4 real published books per perspective. Never invent books.\nReturn exactly:\n{"summary":"...","groupA":[{"title":"","author":"","year":0,"reason":""}],"groupB":[...]}`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected Claude response shape");
  }
  const text = block.text.replace(/```json|```/g, "").trim();
  return JSON.parse(text) as CurationResult;
}
