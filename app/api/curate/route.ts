import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  searchBooksByTitle,
  searchBooksByTopic,
  type BookResult,
} from "@/lib/searchBooks";
import { getReviewsByBookIds } from "@/lib/supabase";

const topicVariants: Record<string, string[]> = {
  인공지능: ["인공지능", "AI", "로봇", "기술", "미래사회"],
  기후변화: ["기후", "환경", "생태", "탄소", "지구"],
  자본주의: ["자본주의", "경제", "불평등", "금융", "신자유주의"],
  소셜미디어: ["소셜미디어", "SNS", "디지털", "플랫폼"],
  "1인가구": ["1인가구", "돌봄", "사회안전망", "주거안정"],
  재택근무: ["원격", "재택", "노동", "일자리"],
};

const perspectiveDescriptions: Record<string, { A: string; B: string }> = {
  "indiv-struct": { A: "개인 노력·선택·심리 중심", B: "사회·제도·시스템 중심" },
  "tech-social": { A: "기술·혁신으로 문제 해결", B: "사회변화·정책으로 해결" },
  "desc-crit": { A: "사실 전달·현상 정리 중심", B: "기존 구조에 문제 제기·변화 촉구" },
  "acad-pop": { A: "이론·연구 중심", B: "경험·실천 중심" },
  "now-future": { A: "현 상황 분석·진단", B: "미래 가능성·시나리오" },
  "custom": { A: "", B: "" },
};

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
  // 책 + 태그 + 헤드라인 조합
  const bookDescriptions = books
    .map((b: any) => {
      const headlines = reviewMap[b.id] || [];
      const headlineText =
        headlines.length > 0
          ? `\n  서평: ${headlines.slice(0, 3).join(" / ")}`
          : "";
      return `- ${b.title} | 태그: ${b.topics}${headlineText}`;
    })
    .join("\n");

  // Ollama 프롬프트
  const prompt = `너는 도서 큐레이터야.
아래 [도서 목록]에서 "${topic}" 주제에 대해
"${labelA}"와 "${labelB}" 관점으로 분류하고
각 책의 이유도 함께 써줘.

현재 선택된 관점: ${perspectiveId}
관점 A(${labelA})의 정의: ${perspectiveDescriptions[perspectiveId]?.A ?? labelA}
관점 B(${labelB})의 정의: ${perspectiveDescriptions[perspectiveId]?.B ?? labelB}

⚠️ 절대 규칙:
1. [도서 목록]에 있는 제목을 철자 하나도 바꾸지 마.
2. 목록에 없는 책은 절대 추가하지 마.
3. 각 관점에 맞는 책을 최대한 배정하되, 명백히 맞지 않는 책은 배정하지 마. 어느 관점에도 해당하지 않으면 빈 배열([])로 둬.
4. reason은 한국어 1~2문장. # 태그 절대 금지.
5. 관점 불명확한 책은 제외해.
6. reason은 반드시 한국어만 사용. 영어·러시아어·일본어 등 다른 언어 절대 금지.
7. groupA는 반드시 "${labelA}" 정의에 맞는 책만, groupB는 반드시 "${labelB}" 정의에 맞는 책만 배정할 것. 섞지 말 것.
8. 장르 인식 규칙:
   - topics에 #소설 태그가 포함돼 있으면 소설(문학)로, 없으면 비문학(논픽션)으로 간주할 것.
   - 소설은 줄거리나 소재가 아닌 '작가의 비판의식'이나 '상상력의 방향'을 기준으로 관점을 판단할 것.
   - reason 작성 시, 소설은 "작중 인물의 선택이나 서사를 통해 ~를 보여준다"와 같이 장르적 특성을 반영하고, 비문학은 "저자의 분석과 논리적 근거를 통해 ~를 주장한다"와 같이 구분하여 표현할 것.
9. 관점의 부합성: 한 그룹 내에 소설과 비문학이 섞여도 무방하나, 해당 관점의 정의에 핵심적으로 부합하는 도서만 엄선할 것.

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
  const { topic, labelA, labelB, perspectiveId } = await req.json();

  console.log("🔍 Supabase search start:", topic);

  try {
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
    const books = dedupeBooksById(perKeyword.flat());
    console.log("📚 Total books after expansion:", books.length);
    console.log(
      "📖 Book titles:",
      books.map((b) => b.title)
    );

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

    function extractYear(period: string): number {
      const match = period?.match(/(\d{4})/);
      return match ? parseInt(match[1]) : 0;
    }

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
