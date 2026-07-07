import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INPUT_PATH = path.join(ROOT, "data", "audit", "tags_to_add_20260708.csv");
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

function stripHash(tag) {
  const s = String(tag ?? "").trim();
  return s.startsWith("#") ? s.slice(1) : s;
}

function splitTags(topics) {
  if (!topics || typeof topics !== "string") return [];
  return topics
    .split("#")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function backupDateStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function loadAddTagRows() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`❌ 입력 CSV가 없습니다: ${INPUT_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT_PATH, "utf8").replace(/^\uFEFF/, "");
  const table = parseCsv(raw);
  if (table.length < 2) {
    console.error("❌ 입력 CSV에 데이터 행이 없습니다.");
    process.exit(1);
  }

  const header = table[0];
  const idx = (name) => header.indexOf(name);
  for (const col of ["book_id", "add_tag", "reason"]) {
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
      addTag: cells[idx("add_tag")] ?? "",
      reason: cells[idx("reason")] ?? "",
    });
  }
  return rows;
}

// book_id → add_tag[] (CSV 순서 유지)
function groupTagsByBook(rows) {
  const byBook = new Map();
  for (const row of rows) {
    if (!byBook.has(row.bookId)) byBook.set(row.bookId, []);
    byBook.get(row.bookId).push(row.addTag);
  }
  return byBook;
}

function appendTags(originalTopics, tagsToAdd) {
  let result = (originalTopics ?? "").trim();
  const existing = new Set(splitTags(result));
  let added = 0;
  let skipped = 0;

  for (const rawTag of tagsToAdd) {
    const tag = stripHash(rawTag);
    if (!tag) continue;
    if (existing.has(tag)) {
      skipped++;
      continue;
    }
    const display = `#${tag}`;
    result = result.length === 0 ? display : `${result} ${display}`;
    existing.add(tag);
    added++;
  }

  return { newTopics: result, added, skipped };
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

  const inputRows = loadAddTagRows();
  const tagsByBook = groupTagsByBook(inputRows);

  const supabase = createClient(
    supabaseUrl,
    APPLY ? serviceKey : env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const books = await fetchAllBooks(supabase);
  const bookById = new Map(books.map((b) => [String(b.id), b]));

  let totalAdded = 0;
  let totalSkipped = 0;
  const changes = [];

  for (const [bookId, tagsToAdd] of tagsByBook) {
    const book = bookById.get(String(bookId));
    if (!book) {
      console.warn(`⚠️ book_id=${bookId} — DB에 없어 건너뜀`);
      continue;
    }

    const { newTopics, added, skipped } = appendTags(book.topics, tagsToAdd);
    totalAdded += added;
    totalSkipped += skipped;

    if (newTopics !== (book.topics ?? "").trim()) {
      changes.push({
        bookId,
        title: book.title,
        oldTopics: book.topics ?? "",
        newTopics,
      });
    }
  }

  console.log(
    APPLY
      ? "🔧 태그 추가 적용 모드 (--apply)"
      : "👀 태그 추가 프리뷰 모드 (DB 무변경)"
  );
  console.log(`대상 행 수: ${inputRows.length}행`);
  console.log(`실제 추가될 태그 수: ${totalAdded}건`);
  console.log(`이미 존재해 스킵된 태그 수: ${totalSkipped}건`);
  console.log(`영향받는 책 수: ${changes.length}권`);

  if (changes.length === 0) {
    console.log("\n변경 대상 없음.");
    return;
  }

  console.log("\n--- 변경 목록 ---");
  for (const c of changes) {
    console.log(`[${c.bookId}] ${c.title}`);
    console.log(`  기존: ${c.oldTopics}`);
    console.log(`  새값: ${c.newTopics}`);
  }

  if (!APPLY) {
    console.log("\n실제 반영: node scripts/add-tags-apply.mjs --apply");
    return;
  }

  const backupPath = path.join(
    AUDIT_DIR,
    `topics_backup_add_${backupDateStamp()}.csv`
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
