import { NextResponse } from "next/server";
import OpenAI from "openai";
import { ANALYZE_AXES, type AnalyzeAxisId } from "@/lib/analyzeAxes";

const MAX_BOOKS = 10;

type InputBook = {
  id: string;
  title: string;
  topics: string;
  description: string; // v4b에서만 프롬프트 입력에 사용 (v3/v4a는 무시)
};

type AxisScore = { a: number; b: number };
type BookScores = Record<AnalyzeAxisId, AxisScore>;

// M3 실험용 프롬프트 버전 스위치. 기본값 v3 = 현행 프롬프트 그대로 (라이브 안전장치).
const PROMPT_VERSIONS = ["v3", "v4a", "v4b", "v4c", "v4d"] as const;
type PromptVersion = (typeof PROMPT_VERSIONS)[number];

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT_V3 = `너는 도서의 관점 성향을 분석하는 전문가야.
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

// M3 실험 v4a: v3를 복제하고 규칙 10~13(P1~P4)을 추가한 버전.
// P1의 소설 4축 0/0은 프롬프트 지시와 별개로 응답 조립 단계에서 코드로도 강제된다.
// M3 2라운드에서 P1 규칙(규칙 10)과 P2~P4 앵커(규칙 11~13)를 분리 — v4a/v4b 프롬프트는
// 재조합해도 1라운드와 바이트 동일하게 유지된다(이력 보존).
const V4_P1_RULE = `
10. 소설 규약: topics에 #소설이 포함된 책은 ①indiv-struct와 ⑥narrative-explain 두 축만 채점하고, 나머지 4축(neutral-critical, now-future, cause-solution, acad-pop)은 반드시 0/0으로 반환할 것.`;

const V4_ANCHOR_RULES = `
11. 학술↔대중 판정 기준: A(학술·전문)는 해당 분야의 선행 연구·이론·전문 용어를 전제로 논증하는 책(학술서·전문서·연구서). B(대중·실용)는 일반 독자가 배경지식 없이 읽도록 쓰인 책(교양서·실용서·에세이). 저자의 직업이 아니라 서술 방식과 상정 독자로 판단할 것. 전문 주제라도 교양 문체면 B (예: 대중 과학서).
12. 현재↔미래 판정 기준: 책이 현재의 사회·현상·문제를 분석 대상으로 삼으면 A(현재 진단). 미래 예측·전망·시나리오가 중심이면 B. 시간 차원 자체가 논점이 아닌 경우(과거사 서술, 무시간적 이론서 등)에만 0/0. 명시적 시간 표현이 없다는 이유로 0/0을 주지 말 것 — 현재를 다루는 책은 대부분 A다.
13. 개인↔구조 판정 기준: 소재가 아니라 논증의 귀착점으로 판단할 것. 개인의 사례·고통·경험이 등장해도 그것이 제도·시스템·사회 구조의 문제를 논증하는 근거로 쓰이면 B(구조). 구조적 배경이 언급돼도 결론이 개인의 선택·성장·실천이면 A(개인).`;

// M3 실험 v4b/v4d: 책소개(description) 입력을 추가한 버전용 규칙.
const V4B_EXTRA_RULES = `
14. 이 버전에서는 책 입력에 "소개:"(책소개)가 포함됨. 규칙 3의 판단 근거를 '제목·topics 태그·책소개'로 확장해, 태그와 책소개를 함께 근거로 판단하되, 책소개의 홍보성 문체(출판사 소개글)에 이끌려 관점을 중립으로 뭉개지 말 것.`;

// M3 2라운드(v4c/v4d): v4a의 P1 프롬프트 규칙이 모델의 0/0 사용을 재정당화해 비문학의
// ②⑥ 축까지 0/0으로 오염시키는 회귀가 관측됨 → P1은 코드 강제(enforceFictionZero)만
// 남기고 프롬프트에서 축 건너뛰기 언급을 완전히 제거. 규칙 번호가 9→11로 건너뛰는 것은
// v4a와의 텍스트 공유를 위한 의도적 선택(모델 판단에 영향 없음).
const SYSTEM_PROMPTS: Record<PromptVersion, string> = {
  v3: SYSTEM_PROMPT_V3,
  v4a: SYSTEM_PROMPT_V3 + V4_P1_RULE + V4_ANCHOR_RULES,
  v4b: SYSTEM_PROMPT_V3 + V4_P1_RULE + V4_ANCHOR_RULES + V4B_EXTRA_RULES,
  v4c: SYSTEM_PROMPT_V3 + V4_ANCHOR_RULES,
  v4d: SYSTEM_PROMPT_V3 + V4_ANCHOR_RULES + V4B_EXTRA_RULES,
};

// P1 코드 강제: v3를 제외한 모든 실험 버전에서 #소설 책의 4축을 응답과 무관하게
// 0/0으로 덮어쓴다. v3 경로는 건드리지 않는다 (라이브 무영향 안전장치).
const FICTION_FORCED_ZERO_AXES: AnalyzeAxisId[] = [
  "neutral-critical",
  "now-future",
  "cause-solution",
  "acad-pop",
];

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

function enforceFictionZero(
  results: { id: string; scores: BookScores }[],
  books: InputBook[],
  promptVersion: PromptVersion
): { id: string; scores: BookScores }[] {
  if (promptVersion === "v3") return results;
  const fictionIds = new Set(
    books.filter((b) => b.topics.includes("#소설")).map((b) => b.id)
  );
  for (const r of results) {
    if (!fictionIds.has(r.id)) continue;
    for (const axis of FICTION_FORCED_ZERO_AXES) {
      r.scores[axis] = { a: 0, b: 0 };
    }
  }
  return results;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const inputBooks = Array.isArray(body?.books) ? body.books : [];

    const rawVersion = body?.promptVersion ?? "v3";
    if (!PROMPT_VERSIONS.includes(rawVersion)) {
      return NextResponse.json(
        { error: `알 수 없는 promptVersion: ${rawVersion}` },
        { status: 400 }
      );
    }
    const promptVersion = rawVersion as PromptVersion;

    const books: InputBook[] = inputBooks
      .filter((b: any) => b && b.id != null && b.title)
      .slice(0, MAX_BOOKS)
      .map((b: any) => ({
        id: String(b.id),
        title: String(b.title),
        topics: String(b.topics ?? ""),
        description: String(b.description ?? ""),
      }));

    if (books.length === 0) {
      return NextResponse.json(
        { error: "분석할 책이 없습니다." },
        { status: 400 }
      );
    }

    // 소개 주입 버전(v4b/v4d) 스모크 검증용: 소개 조회가 조용히 실패하면 소개 없는
    // 버전과 중복 측정이 되므로, 소개가 실제 입력에 포함되는 권수를 로그로 남긴다.
    const usesDescription = promptVersion === "v4b" || promptVersion === "v4d";
    if (usesDescription) {
      const withDesc = books.filter((b) => b.description.trim().length > 0);
      console.log(
        `🧪 ${promptVersion} 입력: ${withDesc.length}/${books.length}권 소개 포함` +
          (withDesc.length > 0
            ? ` (예: [${withDesc[0].id}] ${withDesc[0].description.slice(0, 30)}…)`
            : " ⚠️ 소개 없음 - 소개 미주입 버전과 동일 입력이 됨")
      );
    }

    // v3/v4a/v4c 입력 라인은 기존과 동일. v4b/v4d만 소개(500자)를 덧붙인다.
    const bookList = books
      .map((b) => {
        const base = `- id: ${b.id} | 제목: ${b.title} | topics: ${b.topics}`;
        if (usesDescription && b.description) {
          return `${base} | 소개: ${b.description.slice(0, 500)}`;
        }
        return base;
      })
      .join("\n");

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPTS[promptVersion] },
        { role: "user", content: `[책 목록]\n${bookList}` },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const text = res.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(text);
    const results = enforceFictionZero(
      normalizeResults(parsed, books),
      books,
      promptVersion
    );

    return NextResponse.json({ results, promptVersion });
  } catch (error) {
    console.error("❌ analyze-score 에러:", error);
    return NextResponse.json(
      { error: "관점 분석 실패. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
