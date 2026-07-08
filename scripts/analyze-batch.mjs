import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_URL = "http://localhost:3000/api/analyze-score";
const PROMPT_VERSION = "v3";
const BATCH_SIZE = 10;
const PAGE_SIZE = 1000; // Supabase 기본 1000행 제한 대응용 페이지 크기
const OUT_PATH = path.join(ROOT, "data", "analyze_scores.csv");
// curate/Labs가 런타임에 읽는 경로(lib/analyzeScores.ts). assign-clusters.mjs는 처음부터
// public/data를 OUT_PATH로 쓰는데 이 스크립트만 data/에만 쓰다가 동기화가 깨진 전례가
// 있어(2026-07-09 STEP A/B 진단), 같은 실수가 재발하지 않도록 이 스크립트도 두 곳에 동시 저장한다.
const PUBLIC_OUT_PATH = path.join(ROOT, "public", "data", "analyze_scores.csv");

const AXES = [
  { id: "indiv-struct", prefix: "indiv" },
  { id: "neutral-critical", prefix: "neutral" },
  { id: "now-future", prefix: "now" },
  { id: "cause-solution", prefix: "cause" },
  { id: "acad-pop", prefix: "acad" },
  { id: "narrative-explain", prefix: "narrative" },
];

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

function topicsHash(book) {
  return crypto
    .createHash("md5")
    .update(`${book.title}|${book.topics ?? ""}`)
    .digest("hex");
}

function csvValue(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

// 기존 CSV를 읽어 book_id → { topicsHash, scores } 캐시 맵 생성
function loadExistingScores() {
  const cache = new Map();
  if (!fs.existsSync(OUT_PATH)) return cache;

  const lines = fs
    .readFileSync(OUT_PATH, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return cache;

  const header = parseCsvLine(lines[0]);
  const idx = (name) => header.indexOf(name);
  if (idx("book_id") === -1 || idx("topics_hash") === -1) return cache;

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const scores = {};
    for (const axis of AXES) {
      scores[axis.id] = {
        a: Number(cells[idx(`${axis.prefix}_a`)]) || 0,
        b: Number(cells[idx(`${axis.prefix}_b`)]) || 0,
      };
    }
    cache.set(cells[idx("book_id")], {
      topicsHash: cells[idx("topics_hash")],
      scores,
    });
  }
  return cache;
}

function toCsvRow(book, scores) {
  const cells = [book.id, book.title, book.source ?? ""];
  for (const axis of AXES) {
    const s = scores?.[axis.id] ?? { a: 0, b: 0 };
    cells.push(s.a ?? 0, s.b ?? 0);
  }
  cells.push(PROMPT_VERSION);
  cells.push(book.topics ?? "");
  cells.push(book.cover_url ?? "");
  cells.push(topicsHash(book));
  return cells.map(csvValue).join(",");
}

const CSV_HEADER = [
  "book_id",
  "title",
  "source",
  ...AXES.flatMap((axis) => [`${axis.prefix}_a`, `${axis.prefix}_b`]),
  "prompt_version",
  "topics",
  "cover_url",
  "topics_hash",
].join(",");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// books 테이블 전체 조회 (1000행 제한을 넘어도 range 페이징으로 모두 수집)
async function fetchAllBooks(supabase) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("books")
      .select("id, title, topics, source, cover_url")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase 조회 실패: ${error.message}`);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

function formatElapsed(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}분 ${sec}초` : `${sec}초`;
}

async function main() {
  const startedAt = Date.now();
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

  let allBooks;
  try {
    allBooks = await fetchAllBooks(supabase);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
  if (allBooks.length === 0) {
    console.log("books 테이블에 책이 없습니다.");
    return;
  }

  console.log(`📚 조회된 책: ${allBooks.length}권`);

  const books = allBooks.filter(
    (b) => typeof b.topics === "string" && b.topics.trim().length > 0
  );
  const skipped = allBooks.length - books.length;
  console.log(`🏷️ 태그 없음으로 제외: ${skipped}권`);

  const cache = loadExistingScores();
  const scoresById = new Map();
  const toScore = [];

  for (const book of books) {
    const cached = cache.get(String(book.id));
    if (cached && cached.topicsHash === topicsHash(book)) {
      scoresById.set(String(book.id), cached.scores);
    } else {
      toScore.push(book);
    }
  }

  console.log(
    `전체 대상: ${books.length}권 / 캐시 유지: ${books.length - toScore.length}권 / 신규 채점: ${toScore.length}권`
  );

  const batches = [];
  for (let i = 0; i < toScore.length; i += BATCH_SIZE) {
    batches.push(toScore.slice(i, i + BATCH_SIZE));
  }

  let scoredCount = 0;
  let failedCount = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          books: batch.map((b) => ({
            id: b.id,
            title: b.title,
            topics: b.topics,
          })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      for (const r of json.results ?? []) {
        scoresById.set(String(r.id), r.scores);
      }
      scoredCount += batch.length;
      console.log(`배치 ${i + 1}/${batches.length} 완료 (누적 ${scoredCount}권)`);
    } catch (err) {
      failedCount += batch.length;
      console.error(
        `❌ 배치 ${i + 1}/${batches.length} 실패 — 건너뜀. book_id: ${batch
          .map((b) => b.id)
          .join(", ")} (${err.message})`
      );
    }

    if (i < batches.length - 1) await sleep(1000);
  }

  const rows = [];
  for (const book of books) {
    const scores = scoresById.get(String(book.id));
    if (!scores) continue; // 채점 실패한 배치의 책은 제외
    rows.push(toCsvRow(book, scores));
  }

  const csvContent = [CSV_HEADER, ...rows].join("\n") + "\n";

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, csvContent, "utf8");

  fs.mkdirSync(path.dirname(PUBLIC_OUT_PATH), { recursive: true });
  fs.writeFileSync(PUBLIC_OUT_PATH, csvContent, "utf8");

  console.log(
    `\n✅ 총 ${rows.length}권 분석 완료 (소요 시간: ${formatElapsed(Date.now() - startedAt)}) → ${OUT_PATH}, ${PUBLIC_OUT_PATH}`
  );
  if (failedCount > 0) {
    console.log(`⚠️ 실패: ${failedCount}권 (재실행 시 자동 재시도됨)`);
  }
}

main().catch((err) => {
  console.error("❌ 실행 실패:", err);
  process.exit(1);
});
