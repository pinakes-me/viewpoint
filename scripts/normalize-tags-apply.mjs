import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRYRUN_PATH = path.join(
  ROOT,
  "data",
  "audit",
  "normalize_dryrun_20260707.csv"
);
const AUDIT_DIR = path.join(ROOT, "data", "audit");
const PAGE_SIZE = 1000;

const APPLY = process.argv.includes("--apply");

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

// RFC 4180 준수 CSV 파서 — 큰따옴표 필드 내부 줄바꿈·"" 이스케이프 처리
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (ch === "\r") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      if (text[i + 1] === "\n") i++;
      continue;
    }

    if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  if (row.length > 1 || row[0] !== "" || rows.length === 0) {
    rows.push(row);
  }

  return rows;
}

function csvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeCsvWithBom(filePath, headerCells, rows) {
  const lines = [
    headerCells.map(csvValue).join(","),
    ...rows.map((cells) => cells.map(csvValue).join(",")),
  ];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "\uFEFF" + lines.join("\n") + "\n", "utf8");
}

function splitTags(topics) {
  if (!topics || typeof topics !== "string") return [];
  return topics
    .split("#")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function joinTags(tags) {
  if (tags.length === 0) return "";
  return `#${tags.join(" #")}`;
}

function tagsEqual(a, b) {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function stripHash(tag) {
  const s = String(tag ?? "").trim();
  return s.startsWith("#") ? s.slice(1) : s;
}

function backupDateStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function loadDryrunRows() {
  if (!fs.existsSync(DRYRUN_PATH)) {
    console.error(`❌ dry-run CSV가 없습니다: ${DRYRUN_PATH}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(DRYRUN_PATH, "utf8").replace(/^\uFEFF/, "");
  const table = parseCsv(raw);
  if (table.length < 2) {
    console.error("❌ dry-run CSV에 데이터 행이 없습니다.");
    process.exit(1);
  }
  const header = table[0];
  const idx = (name) => header.indexOf(name);

  const required = [
    "book_id",
    "title",
    "tag",
    "action",
    "proposed_tag",
    "note",
  ];
  for (const col of required) {
    if (idx(col) === -1) {
      console.error(`❌ CSV에 '${col}' 컬럼이 없습니다.`);
      process.exit(1);
    }
  }

  const rows = [];
  for (const cells of table.slice(1)) {
    if (cells.every((c) => String(c).trim() === "")) continue;
    rows.push({
      bookId: cells[idx("book_id")],
      title: cells[idx("title")] ?? "",
      tag: stripHash(cells[idx("tag")]),
      action: cells[idx("action")] ?? "",
      proposedTag: stripHash(cells[idx("proposed_tag")]),
      note: (cells[idx("note")] ?? "").trim(),
    });
  }
  return rows;
}

// book_id → tag → row (동일 태그 중복 행은 마지막 행 우선)
function groupRowsByBook(rows) {
  const byBook = new Map();
  for (const row of rows) {
    if (!byBook.has(row.bookId)) byBook.set(row.bookId, new Map());
    byBook.get(row.bookId).set(row.tag, row);
  }
  return byBook;
}

function applyTagRules(originalTags, rowByTag, stats) {
  const result = [];

  for (const tag of originalTags) {
    const row = rowByTag.get(tag);
    const note = row?.note ?? "";

    if (note === "삭제") {
      stats.삭제++;
      continue;
    }
    if (note === "거부") {
      result.push(tag);
      continue;
    }
    if (note.startsWith("수정→")) {
      let newTag = note.slice("수정→".length).trim();
      if (!newTag.startsWith("#")) newTag = `#${newTag}`;
      newTag = stripHash(newTag);
      if (newTag.length === 0) continue;
      stats.수정++;
      result.push(newTag);
      continue;
    }
    if (row?.action === "치환" && note === "") {
      const replacement = row.proposedTag || tag;
      if (replacement !== tag) stats.치환++;
      result.push(replacement);
      continue;
    }

    result.push(tag);
  }

  // 중복 제거 — 순서 유지, 첫 번째만 남김
  const seen = new Set();
  const deduped = [];
  for (const tag of result) {
    if (seen.has(tag)) {
      stats.중복제거++;
      continue;
    }
    seen.add(tag);
    deduped.push(tag);
  }

  return deduped;
}

async function fetchAllBooks(supabase) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("books")
      .select("id, title, topics")
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
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    console.error("❌ .env.local에서 NEXT_PUBLIC_SUPABASE_URL을 찾을 수 없습니다.");
    process.exit(1);
  }

  if (APPLY && !serviceKey) {
    console.error(
      "❌ --apply 실행에는 .env.local의 SUPABASE_SERVICE_ROLE_KEY가 필요합니다."
    );
    process.exit(1);
  }

  const dryrunRows = loadDryrunRows();
  const rowByBook = groupRowsByBook(dryrunRows);

  const supabase = createClient(
    supabaseUrl,
    APPLY ? serviceKey : env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const books = await fetchAllBooks(supabase);
  const bookById = new Map(books.map((b) => [String(b.id), b]));

  const stats = { 치환: 0, 삭제: 0, 수정: 0, 중복제거: 0 };
  const changes = [];

  for (const [bookId, tagRows] of rowByBook) {
    const book = bookById.get(String(bookId));
    if (!book) {
      console.warn(`⚠️ book_id=${bookId} — DB에 없어 건너뜀`);
      continue;
    }

    const originalTags = splitTags(book.topics);
    const bookStats = { 치환: 0, 삭제: 0, 수정: 0, 중복제거: 0 };
    const newTags = applyTagRules(originalTags, tagRows, bookStats);
    const newTopics = joinTags(newTags);

    Object.keys(bookStats).forEach((k) => {
      stats[k] += bookStats[k];
    });

    if (newTopics !== (book.topics ?? "")) {
      changes.push({
        bookId,
        title: book.title,
        oldTopics: book.topics ?? "",
        newTopics,
        formatOnly: tagsEqual(originalTags, newTags),
      });
    }
  }

  const formatOnlyCount = changes.filter((c) => c.formatOnly).length;

  console.log(
    APPLY
      ? "🔧 태그 정규화 적용 모드 (--apply)"
      : "👀 태그 정규화 프리뷰 모드 (DB 무변경)"
  );
  console.log(`변경 책 수: ${changes.length}권`);
  console.log(`  치환: ${stats.치환}건`);
  console.log(`  삭제: ${stats.삭제}건`);
  console.log(`  수정: ${stats.수정}건`);
  console.log(`  중복 제거: ${stats.중복제거}건`);
  console.log(`  형식만 변경: ${formatOnlyCount}권`);

  if (changes.length === 0) {
    console.log("\n변경 대상 없음.");
    return;
  }

  console.log("\n--- 변경 목록 ---");
  for (const c of changes) {
    const label = c.formatOnly ? " [형식만 변경]" : "";
    console.log(`[${c.bookId}] ${c.title}${label}`);
    console.log(`  기존: ${c.oldTopics}`);
    console.log(`  새값: ${c.newTopics}`);
  }

  if (!APPLY) {
    console.log("\n실제 반영: node scripts/normalize-tags-apply.mjs --apply");
    return;
  }

  const backupPath = path.join(
    AUDIT_DIR,
    `topics_backup_${backupDateStamp()}.csv`
  );
  writeCsvWithBom(
    backupPath,
    ["book_id", "title", "topics"],
    changes.map((c) => [c.bookId, c.title, c.oldTopics])
  );
  console.log(`\n💾 백업: ${backupPath}`);

  let updateSuccess = 0;
  let updateFailed = 0;

  for (const c of changes) {
    const { data, error } = await supabase
      .from("books")
      .update({ topics: c.newTopics })
      .eq("id", c.bookId)
      .select("id");

    if (error) {
      console.error(`❌ UPDATE 실패 book_id=${c.bookId}: ${error.message}`);
      updateFailed++;
      continue;
    }

    if (!data || data.length === 0) {
      console.warn(
        `⚠️ UPDATE 영향 0행 book_id=${c.bookId} — RLS 권한 문제 가능성`
      );
      updateFailed++;
    } else {
      updateSuccess++;
    }
  }

  console.log(`\n✅ UPDATE 성공: ${updateSuccess}행`);
  if (updateFailed > 0) {
    console.log(`⚠️ UPDATE 실패/0행: ${updateFailed}건`);
  }
}

main().catch((err) => {
  console.error("❌ 실행 실패:", err);
  process.exit(1);
});
