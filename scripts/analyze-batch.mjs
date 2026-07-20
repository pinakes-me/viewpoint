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

// 실험 채점용 옵션 (M0/M3, membership 품질 실험 전제 작업):
//   --ids 2,54,172  지정 book_id만 해시 캐시를 무시하고 강제 재채점.
//                   나머지 책은 해시 일치 여부와 무관하게 기존 CSV의 캐시 점수를 그대로 사용.
//   --out <경로>    결과를 지정 파일에만 기록. 기본 산출물(data/, public/data/)은 건드리지 않음.
//   --prompt v4a    채점 API에 promptVersion 전달 (기본 v3 = 현행 프롬프트).
//                   CSV의 prompt_version 필드에는 실제 사용 버전이 기록됨(캐시 유지 행은
//                   기존 CSV의 버전을 그대로 승계).
// --ids/--out을 함께 쓰면 라이브 데이터 무변경으로 실험 채점이 가능하다.
// 주의: 해시 공식(topicsHash)은 변경 금지 — 바꾸면 전체 캐시가 무효화되어 293권 재채점이 유발됨.
const VALID_PROMPT_VERSIONS = ["v3", "v4a", "v4b", "v4c", "v4d"];

function parseCliOptions() {
  const argv = process.argv.slice(2);
  let forceIds = null;
  let outOverride = null;
  let promptVersion = PROMPT_VERSION; // 기본 "v3"
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ids" && argv[i + 1]) {
      forceIds = new Set(
        argv[++i]
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      );
    } else if (argv[i] === "--out" && argv[i + 1]) {
      outOverride = path.resolve(argv[++i]);
    } else if (argv[i] === "--prompt" && argv[i + 1]) {
      promptVersion = argv[++i].trim();
      if (!VALID_PROMPT_VERSIONS.includes(promptVersion)) {
        console.error(
          `❌ 알 수 없는 --prompt 값: ${promptVersion} (허용: ${VALID_PROMPT_VERSIONS.join(", ")})`
        );
        process.exit(1);
      }
    }
  }
  return { forceIds, outOverride, promptVersion };
}

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

// 기존 CSV를 읽어 book_id → { topicsHash, scores, promptVersion } 캐시 맵 생성
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
      promptVersion:
        idx("prompt_version") !== -1
          ? cells[idx("prompt_version")] || PROMPT_VERSION
          : PROMPT_VERSION,
    });
  }
  return cache;
}

// version: 이 행의 점수를 만든 실제 프롬프트 버전 (캐시 유지 행은 기존 버전 승계)
function toCsvRow(book, scores, version) {
  const cells = [book.id, book.title, book.source ?? ""];
  for (const axis of AXES) {
    const s = scores?.[axis.id] ?? { a: 0, b: 0 };
    cells.push(s.a ?? 0, s.b ?? 0);
  }
  cells.push(version ?? PROMPT_VERSION);
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
      .select("id, title, topics, source, cover_url, description")
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

  const { forceIds, outOverride, promptVersion } = parseCliOptions();

  if (forceIds) {
    const known = new Set(books.map((b) => String(b.id)));
    const unknown = [...forceIds].filter((id) => !known.has(id));
    if (unknown.length > 0) {
      console.error(
        `❌ --ids에 존재하지 않는 book_id: ${unknown.join(", ")} — 중단합니다.`
      );
      process.exit(1);
    }
  }

  const cache = loadExistingScores();
  const scoresById = new Map();
  const versionById = new Map(); // 행별 실제 사용 프롬프트 버전 (캐시 유지 행은 기존 버전 승계)
  const toScore = [];

  for (const book of books) {
    const key = String(book.id);
    const cached = cache.get(key);
    if (forceIds) {
      // --ids 모드: 지정된 책만 강제 재채점, 나머지는 해시와 무관하게 캐시 점수 유지
      if (forceIds.has(key)) {
        toScore.push(book);
      } else if (cached) {
        scoresById.set(key, cached.scores);
        versionById.set(key, cached.promptVersion);
      }
      // 캐시에 없고 대상도 아닌 책은 결과에서 제외(기존 채점 실패 시 처리와 동일)
    } else if (cached && cached.topicsHash === topicsHash(book)) {
      scoresById.set(key, cached.scores);
      versionById.set(key, cached.promptVersion);
    } else {
      toScore.push(book);
    }
  }

  if (forceIds) {
    console.log(
      `🎯 --ids 모드: 강제 재채점 ${toScore.length}권 (${toScore.map((b) => b.id).join(", ")}) / 캐시 유지: ${scoresById.size}권`
    );
  } else {
    console.log(
      `전체 대상: ${books.length}권 / 캐시 유지: ${books.length - toScore.length}권 / 신규 채점: ${toScore.length}권`
    );
  }
  if (outOverride) {
    console.log(`📝 --out 모드: 결과는 ${outOverride}에만 기록 (라이브 데이터 무변경)`);
  }
  if (promptVersion !== PROMPT_VERSION) {
    console.log(`🧪 --prompt 모드: 채점 프롬프트 버전 ${promptVersion}`);
  }

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
          promptVersion,
          books: batch.map((b) => ({
            id: b.id,
            title: b.title,
            topics: b.topics,
            // v4b가 사용 (v3/v4a는 API가 무시)
            description: b.description ?? "",
          })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      for (const r of json.results ?? []) {
        scoresById.set(String(r.id), r.scores);
        versionById.set(String(r.id), promptVersion);
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
    const key = String(book.id);
    const scores = scoresById.get(key);
    if (!scores) continue; // 채점 실패한 배치의 책은 제외
    rows.push(toCsvRow(book, scores, versionById.get(key)));
  }

  const csvContent = [CSV_HEADER, ...rows].join("\n") + "\n";

  // --out 지정 시 그 파일에만 기록, 기본 산출물(data/, public/data/)은 무변경
  const outTargets = outOverride ? [outOverride] : [OUT_PATH, PUBLIC_OUT_PATH];
  for (const target of outTargets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, csvContent, "utf8");
  }

  console.log(
    `\n✅ 총 ${rows.length}권 분석 완료 (소요 시간: ${formatElapsed(Date.now() - startedAt)}) → ${outTargets.join(", ")}`
  );
  if (failedCount > 0) {
    console.log(`⚠️ 실패: ${failedCount}권 (재실행 시 자동 재시도됨)`);
  }
}

main().catch((err) => {
  console.error("❌ 실행 실패:", err);
  process.exit(1);
});
