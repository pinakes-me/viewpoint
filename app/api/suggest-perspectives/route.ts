import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `너는 인문·사회과학 분야의 독서 큐레이터야.
사용자가 제시한 주제에 어울리는 분석 렌즈(관점 쌍)를 2~3개 제안해줘.

규칙:
1. 관점은 반드시 2개 이상 3개 이하로 제안할 것.
2. 각 관점은 labelA / labelB 쌍으로 구성할 것 (예: "시장 옹호" / "구조적 비판").
3. description은 한국어 1문장으로, 이 주제를 해당 렌즈로 바라보는 이유를 설명할 것.
4. 이항대립(긍정/부정, 좋다/나쁘다, 찬성/반대)은 사용 금지.
5. 사회과학·인문학적으로 의미 있는 분석 렌즈를 제시할 것.
6. JSON만 반환. 마크다운 코드블록 금지.

반환 형식:
{
  "perspectives": [
    { "labelA": "...", "labelB": "...", "description": "..." },
    { "labelA": "...", "labelB": "...", "description": "..." }
  ]
}`;

export async function POST(req: Request) {
  try {
    const { topic } = await req.json();

    if (!topic || typeof topic !== "string" || topic.trim() === "") {
      return NextResponse.json(
        { error: "topic이 필요합니다." },
        { status: 400 }
      );
    }

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `주제: "${topic.trim()}"` },
      ],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const text = res.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(text) as {
      perspectives?: { labelA: string; labelB: string; description: string }[];
    };

    if (!Array.isArray(parsed.perspectives) || parsed.perspectives.length === 0) {
      throw new Error("응답 형식이 올바르지 않습니다.");
    }

    return NextResponse.json({ perspectives: parsed.perspectives });
  } catch (error) {
    console.error("❌ suggest-perspectives 에러:", error);
    return NextResponse.json(
      { error: "관점 제안에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
