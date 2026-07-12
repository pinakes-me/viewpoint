// 발견 사례 역추적으로 확정된 4권의 원천 태그(topics) 오류 수정 스크립트.
// 시소러스(lib/thesaurus.ts) 사안이 아니라 Supabase books.topics 원천 데이터 수정임.
//
// 기본 실행은 dry-run(변경 예정 내역만 출력, DB 무변경).
// 실제 반영: node scripts/fix-topics-4books.mjs --apply
// --apply 시 쓰기 직전 대상 4권의 현재 topics를 data/backup/topics_backup_YYYYMMDD.csv로 백업.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_DIR = path.join(ROOT, "data", "backup");
const PAGE_SIZE = 1000;

const APPLY = process.argv.includes("--apply");

// title 부분 일치로 찾되, 패턴당 정확히 1권만 매칭돼야 함(초과/미달 시 중단).
const FIXES = [
  {
    titlePattern: "최고의 수면법",
    newTopics: "#현대인의불안 #뇌와행동",
  },
  {
    titlePattern: "교육은 유전을 이길 수 있는가",
    newTopics: "#유전의시대 #교육과사회 #뇌과학과교육 #진화론적고찰",
  },
  {
    titlePattern: "독학이라는 세계",
    newTopics: "#학습의의미 #지적탐구 #교육 #독서",
  },
  {
    titlePattern: "마리아 지뷜라 메리안",
    newTopics: "#마리아지뷜라메리안 #문화와예술 #예술가의삶 #생명과학",
  },
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

function backupDateStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
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

  const supabase = createClient(
    supabaseUrl,
    APPLY ? serviceKey : env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const books = await fetchAllBooks(supabase);
  console.log(`📚 조회된 책: ${books.length}권`);

  // 패턴별 매칭 검증 - 정확히 1권씩 매칭되지 않으면 중단
  const changes = [];
  let matchError = false;

  for (const fix of FIXES) {
    const matched = books.filter((b) =>
      (b.title ?? "").includes(fix.titlePattern)
    );
    if (matched.length !== 1) {
      console.error(
        `❌ "${fix.titlePattern}" 매칭 ${matched.length}권 (정확히 1권이어야 함)` +
          (matched.length > 0
            ? ` — ${matched.map((b) => `[${b.id}] ${b.title}`).join(" / ")}`
            : "")
      );
      matchError = true;
      continue;
    }
    const book = matched[0];
    changes.push({
      bookId: book.id,
      title: book.title,
      oldTopics: book.topics ?? "",
      newTopics: fix.newTopics,
    });
  }

  if (matchError) {
    console.error("\n매칭 오류가 있어 중단합니다. DB는 변경되지 않았습니다.");
    process.exit(1);
  }

  console.log(
    APPLY
      ? "\n🔧 원천 태그 수정 적용 모드 (--apply)"
      : "\n👀 원천 태그 수정 프리뷰 모드 (DB 무변경)"
  );
  console.log(`대상: ${changes.length}권\n`);

  for (const c of changes) {
    const noop = c.oldTopics === c.newTopics ? " [변경 없음 - 이미 동일]" : "";
    console.log(`[${c.bookId}] ${c.title}${noop}`);
    console.log(`  기존: ${c.oldTopics}`);
    console.log(`  새값: ${c.newTopics}`);
  }

  const effective = changes.filter((c) => c.oldTopics !== c.newTopics);
  if (effective.length === 0) {
    console.log("\n실제 변경될 내용이 없습니다.");
    return;
  }

  if (!APPLY) {
    console.log("\n실제 반영: node scripts/fix-topics-4books.mjs --apply");
    return;
  }

  const backupPath = path.join(
    BACKUP_DIR,
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

  for (const c of effective) {
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

  // 반영 후 재조회로 실제 저장값 확인
  const ids = effective.map((c) => c.bookId);
  const { data: after, error: afterErr } = await supabase
    .from("books")
    .select("id, title, topics")
    .in("id", ids)
    .order("id", { ascending: true });

  if (afterErr) {
    console.error(`⚠️ 반영 후 재조회 실패: ${afterErr.message}`);
    return;
  }

  console.log("\n--- 반영 후 재조회 ---");
  for (const b of after ?? []) {
    console.log(`[${b.id}] ${b.title}`);
    console.log(`  topics: ${b.topics}`);
  }
}

main().catch((err) => {
  console.error("❌ 실행 실패:", err);
  process.exit(1);
});
