import { NextResponse } from "next/server";
import OpenAI from "openai";
import { ANALYZE_AXES, type AnalyzeAxisId } from "@/lib/analyzeAxes";

const MAX_BOOKS = 10;

type InputBook = {
  id: string;
  title: string;
  topics: string;
};

type AxisScore = { a: number; b: number };
type BookScores = Record<AnalyzeAxisId, AxisScore>;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `너는 도서의 관점 성향을 분석하는 전문가야.
주어진 책 목록의 각 책에 대해, 아래 6개 관점 축의 소속도(membership) 점수를 매겨줘.

[관점 축]
${ANALYZE_AXES.map(
  (axis) => `- ${axis.id}: A="${axis.labelA}" / B="${axis.labelB}"`
).join("\n")}

[규칙]
1. 각 축마다 labelA 소속도(a)와 labelB 소속도(b)를 각각 0~1 사이 소수 첫째자리 값으로 반환할 것 (예: 0.0, 0.3, 0.8, 1.0).
2. a와 b는 서로 독립적임 — 합이 1일 필요 없음. 둘 다 높으면 두 관점이 교차하는 책이라는 의미.
3. 판단 근거는 오직 책의 제목과 topics 태그만 사용할 것. 추측성 정보를 만들어내지 말 것.
4. 0/0은 "이 축 자체가 이 책에 전혀 적용 불가능한 경우"에만 사용할 것 (예: 소설에 학술↔대중 축). 확신이 부족해도 방향이 보이면 0.3~0.5 수준의 낮은 점수로 표현할 것. 판단 포기를 남발하지 말 것.
5. JSON만 반환할 것. 마크다운 코드블록 금지, 설명 텍스트 금지.
6. 서사↔설명 축(narrative-explain) 판단 기준: topics에 #소설, #어린이문학, #에세이 태그가 있으면 서사 쪽(a)을 높게, 없으면 설명 쪽(b)을 기본적으로 높게 평가할 것. 비문학 도서는 설명 중심이 기본값임. 단, 비문학이라도 사례·인물 이야기가 많으면 서사 점수를 0.3~0.4 수준으로 부여 가능.
7. 제목에 "N가지", "방법", "기술", "리셋" 등 해결책 신호가 있으면 원인↔방안 축(cause-solution)에서 방안(b)을 높게 평가할 것.
8. 점수는 0, 1 같은 극단값 사용을 자제하고 0.1~0.9 범위의 다양한 값을 활용할 것. 1.0은 "그 성격이 책의 전부"일 때만, 0은 "전혀 무관"할 때만 사용.
   예: 비문학 교양서의 설명 중심 → 0.8 (1.0이 아님) / 해결책 위주지만 원인도 다루는 책 → 원인 0.4, 방안 0.8
9. 0.5/0.5 균등값은 "양쪽 성격이 실제로 반반"일 때만 사용. 판단이 어려워서 중간값을 주는 용도로 쓰지 말 것. 축 자체가 해당 책에 무의미하면 0/0을 유지할 것 (예: 소설에 중립↔비판, 원인↔방안 축).

[반환 형식]
{
  "results": [
    {
      "id": "책 id 그대로",
      "scores": {
        "indiv-struct": { "a": 0.8, "b": 0.3 },
        "neutral-critical": { "a": 0.5, "b": 0.6 },
        "now-future": { "a": 0.0, "b": 0.0 },
        "cause-solution": { "a": 0.0, "b": 0.0 },
        "acad-pop": { "a": 0.0, "b": 0.0 },
        "narrative-explain": { "a": 0.0, "b": 0.0 }
      }
    }
  ]
}
results에는 입력된 모든 책을 포함하고, scores에는 6개 축을 모두 포함할 것.`;

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, Math.round(n * 10) / 10));
}

function normalizeResults(
  parsed: unknown,
  books: InputBook[]
): { id: string; scores: BookScores }[] {
  const rawResults = Array.isArray((parsed as any)?.results)
    ? ((parsed as any).results as any[])
    : [];
  const byId = new Map<string, any>();
  for (const r of rawResults) {
    if (r && typeof r.id !== "undefined") byId.set(String(r.id), r);
  }

  return books.map((book) => {
    const raw = byId.get(String(book.id));
    const scores = {} as BookScores;
    for (const axis of ANALYZE_AXES) {
      const s = raw?.scores?.[axis.id];
      scores[axis.id] = {
        a: clampScore(s?.a),
        b: clampScore(s?.b),
      };
    }
    return { id: book.id, scores };
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const inputBooks = Array.isArray(body?.books) ? body.books : [];

    const books: InputBook[] = inputBooks
      .filter((b: any) => b && b.id != null && b.title)
      .slice(0, MAX_BOOKS)
      .map((b: any) => ({
        id: String(b.id),
        title: String(b.title),
        topics: String(b.topics ?? ""),
      }));

    if (books.length === 0) {
      return NextResponse.json(
        { error: "분석할 책이 없습니다." },
        { status: 400 }
      );
    }

    const bookList = books
      .map((b) => `- id: ${b.id} | 제목: ${b.title} | topics: ${b.topics}`)
      .join("\n");

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `[책 목록]\n${bookList}` },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const text = res.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(text);
    const results = normalizeResults(parsed, books);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("❌ analyze-score 에러:", error);
    return NextResponse.json(
      { error: "관점 분석 실패. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
