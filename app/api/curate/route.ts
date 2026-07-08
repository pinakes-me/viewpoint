import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  searchBooksByTitle,
  searchBooksByTopic,
  type BookResult,
} from "@/lib/searchBooks";
import { getReviewsByBookIds, searchBooksByIds } from "@/lib/supabase";
import { getBookIdsForCluster } from "@/lib/bookClusters";
import { PERSPECTIVE_AXES, type PerspectiveAxisId } from "@/lib/perspectiveAxes";
import { getMembershipScore, getAllMembershipScores } from "@/lib/analyzeScores";

const topicVariants: Record<string, string[]> = {
  인공지능: ["인공지능", "AI", "로봇", "기술", "미래사회"],
  기후변화: ["기후위기", "기후변화", "환경문제", "탄소", "생태계파괴", "환경정책"],
  자본주의: ["자본주의", "경제", "불평등", "금융", "신자유주의"],
  소셜미디어: ["소셜미디어", "SNS", "디지털", "플랫폼"],
  "1인가구": ["1인가구", "자기돌봄", "사회안전망", "주거안정"],
  재택근무: ["원격", "재택", "노동", "일자리"],
};

const perspectiveDescriptions: Record<string, { A: string; B: string }> = {
  "indiv-struct": { A: "개인 노력·선택·심리 중심", B: "사회·제도·시스템 중심" },
  "tech-social": { A: "기술·혁신으로 문제 해결", B: "사회변화·정책으로 해결" },
  "desc-crit": { A: "사실 전달·현상 정리 중심", B: "기존 구조에 문제 제기·비판·변화 촉구" },
  "acad-pop": { A: "이론·연구 중심", B: "경험·실천 중심" },
  "now-future": { A: "현 상황 분석·진단", B: "미래 가능성·시나리오" },
  "custom": { A: "", B: "" },
};

function extractYear(period: string): number {
  const match = period?.match(/(\d{4})/);
  return match ? parseInt(match[1]) : 0;
}

function isUnifiedAxisId(id: unknown): id is PerspectiveAxisId {
  return PERSPECTIVE_AXES.some((axis) => axis.id === id);
}

const MEMBERSHIP_MARGIN = 0.2;
// CSV의 a/b는 0.1 단위로 채점되지만 부동소수점 뺄셈(예: 0.6 - 0.4 = 0.19999999999999996)이
// 정확히 마진 경계에서 IEEE754 오차로 미달 판정을 내는 걸 방지하기 위한 허용 오차.
const MARGIN_EPSILON = 1e-9;

// "판단은 단일화" 원칙: 6축 요청은 즉석 GPT 분류 대신 data/analyze_scores.csv의
// membership degree를 조회해 마진 0.2 규칙으로 분류를 확정한다. GPT를 다시 부르지 않으므로
// curate와 Labs는 항상 같은 행(row)을 보게 되어 불일치가 구조적으로 발생할 수 없다.
function classifyByMembership(
  books: BookResult[],
  axisId: PerspectiveAxisId
): { groupA: BookResult[]; groupB: BookResult[]; middleGround: BookResult[] } {
  const groupA: BookResult[] = [];
  const groupB: BookResult[] = [];
  const middle: { book: BookResult; absDiff: number }[] = [];

  for (const book of books) {
    const score = getMembershipScore(book.id, axisId);
    if (!score) continue; // 아직 채점되지 않은 신규 도서 - 트레이드오프로 수용, 스킵
    const { a, b } = score;
    if (a === 0 && b === 0) continue; // 축 자체가 이 책에 무의미
    const diff = a - b;
    if (diff >= MEMBERSHIP_MARGIN - MARGIN_EPSILON) groupA.push(book);
    else if (-diff >= MEMBERSHIP_MARGIN - MARGIN_EPSILON) groupB.push(book);
    else middle.push({ book, absDiff: Math.abs(diff) }); // 마진 미달 -> "중간지대" 후보
  }

  // 가장 애매한(diff가 0에 가까운) 책부터 우선 노출
  middle.sort((x, y) => x.absDiff - y.absDiff);

  return {
    groupA: groupA.slice(0, 6),
    groupB: groupB.slice(0, 6),
    middleGround: middle.slice(0, 4).map((m) => m.book),
  };
}

// reason 생성 전용 프롬프트 - GPT는 분류를 바꾸지 않고, 이미 확정된 membership 배정의
// 근거를 태그·서평·책소개에서 찾아 문장으로 설명하는 역할만 한다. 근거 자료가 빠지면
// "구조 관점으로 분류된 책입니다" 같은 부실한 reason이 나온다는 게 확인된 바 있음(CLAUDE.md 참고).
function explainAssignmentPrompt(
  topic: string,
  labelA: string,
  labelB: string,
  axisId: PerspectiveAxisId,
  groupA: BookResult[],
  groupB: BookResult[],
  reviewMap: Record<number, string[]>
): string {
  const axisDescription = PERSPECTIVE_AXES.find((a) => a.id === axisId)?.description;

  const describe = (b: BookResult) => {
    const headlines = reviewMap[b.id] || [];
    const headlineText =
      headlines.length > 0
        ? `\n  서평: ${headlines.slice(0, 3).join(" / ")}`
        : "";
    const descText = b.description
      ? `\n  소개: ${b.description.slice(0, 150)}`
      : "";
    return `- ${b.title} | 태그: ${b.topics}${descText}${headlineText}`;
  };

  return `너는 도서 전문 사서야. 아래 책들은 "${topic}" 주제에서 이미 "${labelA}" 또는
"${labelB}" 관점으로 분류가 확정된 상태야. 너의 역할은 분류를 바꾸는 게 아니라, 그 책이
왜 해당 관점에 해당하는지를 태그·서평·책소개를 근거로 1~2문장 한국어로 설명하는 것뿐이야.

"${labelA}" 관점 (${axisDescription?.A ?? labelA}):
${groupA.map(describe).join("\n") || "(없음)"}

"${labelB}" 관점 (${axisDescription?.B ?? labelB}):
${groupB.map(describe).join("\n") || "(없음)"}

규칙:
1. 반드시 위에 주어진 책 제목을 그대로 사용할 것 (철자 변경 금지).
2. 소설은 서사를 중심으로, 비소설은 저자의 분석을 중심으로 자연스럽게 서술할 것.
3. # 태그 및 타 언어 사용 금지.

아래 JSON 형식만 반환 (마크다운 없이):
{ "reasons": { "책 제목": "이유 문장" } }`;
}

async function generateReasons(prompt: string): Promise<Record<string, string>> {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a book curator. Return ONLY raw JSON. No markdown, no backticks.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });
    const text = res.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(text);
    return (parsed?.reasons ?? {}) as Record<string, string>;
  } catch (error) {
    console.error("❌ reason 생성 에러:", error);
    return {};
  }
}

function toGroupItem(
  book: BookResult,
  reasons: Record<string, string>,
  fallbackLabel: string
): GroupItem & { isbn: string } {
  return {
    title: book.title,
    author: book.author_full || book.author,
    year: extractYear(book.period),
    isbn: book.isbn || "",
    cover_url: book.cover_url || "",
    reason: reasons[book.title] ?? `"${fallbackLabel}" 관점에 해당하는 책입니다.`,
    scores: getAllMembershipScores(book.id) ?? undefined,
  };
}

function toMiddleGroundItem(book: BookResult): GroupItem & { isbn: string } {
  return {
    title: book.title,
    author: book.author_full || book.author,
    year: extractYear(book.period),
    isbn: book.isbn || "",
    cover_url: book.cover_url || "",
    reason: "두 관점 사이 어느 한쪽으로도 뚜렷하게 기울지 않는 책입니다.",
    scores: getAllMembershipScores(book.id) ?? undefined,
  };
}

function dedupeBooksById(books: BookResult[]): BookResult[] {
  const seen = new Set<number>();
  return books.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
}

function bookKey(title: string, author: string) {
  return `${title.trim().toLowerCase()}::${author.trim().toLowerCase()}`;
}

function buildBookLookup(books: BookResult[]): Map<string, BookResult> {
  const m = new Map<string, BookResult>();
  for (const b of books) {
    m.set(bookKey(b.title, b.author), b);
  }
  return m;
}

type GroupItem = {
  title: string;
  author: string;
  year: number;
  reason: string;
  cover_url?: string;
  scores?: Record<string, { a: number; b: number }>;
};

function enrichWithCovers(
  groupA: GroupItem[],
  groupB: GroupItem[],
  lookup: Map<string, BookResult>
) {
  const enrich = (items: GroupItem[]) =>
    items.map((item) => {
      const src = lookup.get(bookKey(item.title, item.author));
      const url = src?.cover_url?.trim();
      return url ? { ...item, cover_url: url } : item;
    });
  return { groupA: enrich(groupA), groupB: enrich(groupB) };
}

const FALLBACK_PROMPT = (
  topic: string,
  labelA: string,
  labelB: string
) => `You are an expert book curator. Return ONLY a raw JSON object.
No markdown, no backticks, no explanation whatsoever.

Topic: "${topic}"
Perspective A: "${labelA}"
Perspective B: "${labelB}"

Assign as many fitting books as possible to each perspective. Only leave a group as empty array [] if truly no book fits that perspective.
Never invent or fabricate books.
Write all "reason" values in Korean.
Return this exact JSON shape:
{
  "summary": "두 관점이 어떻게 나뉘는지 2문장으로 설명 (한국어)",
  "groupA": [{"title":"","author":"","year":0,"reason":""}],
  "groupB": [{"title":"","author":"","year":0,"reason":""}]
}`;

function classifyFromCatalogPrompt(
  topic: string,
  labelA: string,
  labelB: string,
  books: BookResult[],
  reviewMap: Record<number, string[]>,
  perspectiveId: string
) {
  const bookDescriptions = books
    .map((b: any) => {
      const headlines = reviewMap[b.id] || [];
      const headlineText =
        headlines.length > 0
          ? `\n  서평: ${headlines.slice(0, 3).join(" / ")}`
          : "";
      const descText = b.description
        ? `\n  소개: ${b.description.slice(0, 150)}`
        : "";
      return `- ${b.title} | 태그: ${b.topics}${descText}${headlineText}`;
    })
    .join("\n");

  const prompt = `너는 도서 전문 사서이자 큐레이터야.
아래 [도서 목록]에서 "${topic}" 주제를
"${labelA}"와 "${labelB}" 관점으로 분류해줘.

관점 정의:
- ${labelA}: ${perspectiveDescriptions[perspectiveId]?.A || labelA}
- ${labelB}: ${perspectiveDescriptions[perspectiveId]?.B || labelB}

분류 규칙:
1. [도서 목록]에 있는 책만 사용. 제목 철자 절대 변경 금지.
2. 목록에 없는 책 추가 금지.
3. 각 도서가 어느 관점에 부합하는지 '태그'와 '서평''책소개'를 종합적으로 분석해 판단할 것.
4. 반드시 각 관점 정의에 명확히 부합하는 책만 배정. 억지로 분류하려고 하지 말고, 불명확하면 제외할 것.
5. 한 책은 반드시 groupA 또는 groupB 중 하나에만 배정할 것. 양쪽 동시 배정 절대 금지.
6. groupA는 "${labelA}" 정의에 맞는 책만, groupB는 "${labelB}" 정의에 맞는 책만. 절대 섞지 말 것.
7. reason은 해당 도서의 내용과 관점을 자연스럽게 1~2문장으로 서술할 것. # 태그 및 타 언어 사용 금지.
    - 소설은 서사를 중심으로, 비소설은 저자의 분석을 중심으로 장르에 맞게 자연스럽게 서술할 것.

[도서 목록]
${bookDescriptions}

아래 JSON 형식만 반환 (마크다운 없이):
{
  "groupA": [{"title":"","reason":""}],
  "groupB": [{"title":"","reason":""}]
}`;

  return prompt;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function callOpenAI(prompt: string) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a book curator. Return ONLY raw JSON. No markdown, no backticks.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });
  const text = res.choices[0].message.content ?? "{}";
  console.log("🤖 OpenAI raw response:", text);
  const parsed = JSON.parse(text);
  const keyMap: Record<string, string> = {
    "individual-structural": "indiv-struct",
    "individual_structural": "indiv-struct",
    "indiv_struct": "indiv-struct",
    "tech_social": "tech-social",
    "desc_crit": "desc-crit",
    "acad_pop": "acad-pop",
    "now_future": "now-future",
  };

  const normalized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    normalized[keyMap[k] ?? k] = v;
  }
  return normalized;
}

export async function POST(req: Request) {
  const { topic, labelA, labelB, perspectiveId, clusterId } = await req.json();

  console.log("🔍 Supabase search start:", topic, clusterId ? `(cluster: ${clusterId})` : "");

  try {
    let books: BookResult[];
    if (clusterId) {
      const ids = getBookIdsForCluster(clusterId);
      books = dedupeBooksById(await searchBooksByIds(ids));
    } else {
      const keywords = topicVariants[topic] || [topic];
      const perKeyword = await Promise.all(
        keywords.map(async (k) => {
          const [byTopic, byTitle] = await Promise.all([
            searchBooksByTopic(k),
            searchBooksByTitle(k),
          ]);
          return [...byTopic, ...byTitle];
        })
      );
      books = dedupeBooksById(perKeyword.flat());
    }
    console.log("📚 Total books after expansion:", books.length);
    console.log(
      "📖 Book titles:",
      books.map((b) => b.title)
    );

    if (isUnifiedAxisId(perspectiveId)) {
      const { groupA: rawA, groupB: rawB, middleGround: rawMiddle } =
        classifyByMembership(books, perspectiveId);

      const bookIds = [...rawA, ...rawB].map((b) => b.id);
      const reviewMap =
        bookIds.length > 0 ? await getReviewsByBookIds(bookIds) : {};

      const reasons =
        rawA.length > 0 || rawB.length > 0
          ? await generateReasons(
              explainAssignmentPrompt(
                topic,
                labelA,
                labelB,
                perspectiveId,
                rawA,
                rawB,
                reviewMap
              )
            )
          : {};

      return NextResponse.json({
        summary: `${topic} 관련 도서 ${books.length}권을 찾아 "${labelA}"와 "${labelB}" 관점으로 분류했습니다.`,
        groupA: rawA.map((b) => toGroupItem(b, reasons, labelA)),
        groupB: rawB.map((b) => toGroupItem(b, reasons, labelB)),
        middleGround: rawMiddle.map(toMiddleGroundItem),
      });
    }

    let prompt: string;
    let lookup: Map<string, BookResult> | null = null;

    if (books.length >= 2) {
      // 서평 헤드라인 가져오기
      const bookIds = books.map((b: any) => b.id);
      const reviewMap = await getReviewsByBookIds(bookIds);

      prompt = classifyFromCatalogPrompt(
        topic,
        labelA,
        labelB,
        books,
        reviewMap,
        perspectiveId ?? "custom"
      );
      lookup = buildBookLookup(books);
    } else {
      prompt = FALLBACK_PROMPT(topic, labelA, labelB);
    }

    const parsed = await callOpenAI(prompt);
    console.log("📦 parsed result:", JSON.stringify(parsed));

    const raw = parsed as {
      groupA?: { title?: string; reason?: string }[];
      groupB?: { title?: string; reason?: string }[];
    };

    function enrichBooks(items: { title?: string; reason?: string }[]) {
      return (items || [])
        .map((item: any) => {
          const title = (item?.title ?? "").trim();
          const found = books.find((b: any) => {
            const dbTitle = b.title.trim().toLowerCase();
            const aiTitle = title.toLowerCase();
            return aiTitle.startsWith(dbTitle) || dbTitle === aiTitle;
          });
          if (!found) return null;
          return {
            title: found.title,
            author: found.author_full || found.author,
            year: extractYear(found.period),
            isbn: found.isbn || "",
            cover_url: found.cover_url || "",
            reason: (item?.reason ?? "").toString(),
          };
        })
        .filter(Boolean)
        .filter(
          (book: any, index: number, self: any[]) =>
            index === self.findIndex((b) => b.title === book.title)
        )
        .slice(0, 4);
    }

    let groupA = enrichBooks(raw.groupA || []);
    let groupB = enrichBooks(raw.groupB || []);

    const groupATitles = new Set(groupA.map((b: any) => b.title));
    groupB = groupB.filter((book: any) => !groupATitles.has(book.title));
    groupB = groupB.slice(0, 4);

    return NextResponse.json({
      summary: `${topic} 관련 도서 ${books.length}권을 찾아 "${labelA}"와 "${labelB}" 관점으로 분류했습니다.`,
      groupA,
      groupB,
    });
  } catch (error) {
    console.error("❌ 큐레이션 에러:", error);
    return NextResponse.json(
      { error: "큐레이션 실패. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
