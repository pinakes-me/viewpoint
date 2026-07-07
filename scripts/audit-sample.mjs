import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "data", "audit");
const BOOKS_OUT = path.join(OUT_DIR, "audit_books_20260707.csv");
const TAGS_OUT = path.join(OUT_DIR, "audit_tags_20260707.csv");

const SEED = 20260707;
const SAMPLE_SIZES = { notion: 17, nlk: 13 };
const PAGE_SIZE = 1000;

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  const env = {};
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// 시드 고정 PRNG (mulberry32) — 실행할 때마다 동일한 표본 보장
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fisherYatesShuffle(array, random) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function csvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeCsvWithBom(filePath, headerCells, rows) {
  const lines = [
    headerCells.map(csvValue).join(","),
    ...rows.map((cells) => cells.map(csvValue).join(",")),
  ];
  fs.writeFileSync(filePath, "\uFEFF" + lines.join("\n") + "\n", "utf8");
}

async function fetchAllBooks(supabase) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("books")
      .select("id, title, author, source, topics")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase 조회 실패: ${error.message}`);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

async function main() {
  const env = loadEnvLocal();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "❌ .env.local에서 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY를 찾을 수 없습니다."
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const allBooks = await fetchAllBooks(supabase);

  const population = allBooks.filter(
    (b) => typeof b.topics === "string" && b.topics.trim().length > 0
  );
  const excluded = allBooks.length - population.length;

  const random = mulberry32(SEED);
  const sampled = [];

  // 층화 비례 추출: 그룹별로 id 오름차순 정렬 → 셔플 → 앞에서 N권
  // (정렬 후 셔플이라 실행 순서와 무관하게 동일 결과)
  for (const [source, size] of Object.entries(SAMPLE_SIZES)) {
    const group = population
      .filter((b) => b.source === source)
      .sort((x, y) => Number(x.id) - Number(y.id));
    if (group.length < size) {
      console.error(
        `❌ source='${source}' 그룹이 ${group.length}권뿐이라 ${size}권을 추출할 수 없습니다.`
      );
      process.exit(1);
    }
    const picked = fisherYatesShuffle(group, random)
      .slice(0, size)
      .sort((x, y) => Number(x.id) - Number(y.id));
    sampled.push(...picked);
  }

  const bookRows = sampled.map((b) => [
    b.id,
    b.title,
    b.author ?? "",
    b.source ?? "",
    b.topics,
    b.topics.includes("#소설") ? "TRUE" : "FALSE",
    "", // missing_tags — 수동 기록용
    "", // book_memo — 수동 기록용
  ]);

  const tagRows = [];
  for (const b of sampled) {
    const tags = b.topics
      .split("#")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    for (const tag of tags) {
      tagRows.push([
        b.id,
        b.title,
        b.source ?? "",
        `#${tag}`,
        "", // verdict — 수동 기록용: 적절/오태깅/은유혼동
        "", // tag_memo — 수동 기록용
      ]);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeCsvWithBom(
    BOOKS_OUT,
    [
      "book_id",
      "title",
      "author",
      "source",
      "topics",
      "has_novel_tag",
      "missing_tags",
      "book_memo",
    ],
    bookRows
  );
  writeCsvWithBom(
    TAGS_OUT,
    ["book_id", "title", "source", "tag", "verdict", "tag_memo"],
    tagRows
  );

  console.log(`모집단: ${population.length}권 (태그 없음 제외: ${excluded}권)`);
  console.log(
    `추출: notion ${SAMPLE_SIZES.notion}권 / nlk ${SAMPLE_SIZES.nlk}권 (시드 ${SEED})`
  );
  console.log(`태그 행 수: ${tagRows.length}행`);
  console.log(`✅ ${BOOKS_OUT}`);
  console.log(`✅ ${TAGS_OUT}`);
}

main().catch((err) => {
  console.error("❌ 실행 실패:", err);
  process.exit(1);
});
