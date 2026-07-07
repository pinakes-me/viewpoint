import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = path.join(ROOT, "data", "audit", "normalize_dryrun_20260707.csv");
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

async function loadThesaurus() {
  const src = fs.readFileSync(path.join(ROOT, "lib", "thesaurus.ts"), "utf8");
  const js = src
    .replace(/\bas const\b/g, "")
    .replace(/^export type .*$/gm, "");
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(js)}`);
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

async function fetchAllBooks(supabase) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("books")
      .select("id, title, source, topics")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase 조회 실패: ${error.message}`);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

function buildSynonymMap(clusters) {
  const map = new Map();
  for (const cluster of clusters) {
    for (const synonym of cluster.synonyms) {
      map.set(synonym, cluster.representativeTag);
    }
  }
  return map;
}

function buildRepresentativeSet(clusters) {
  return new Set(clusters.map((c) => c.representativeTag));
}

function buildRelatedSet(clusters) {
  const set = new Set();
  for (const cluster of clusters) {
    for (const term of cluster.related) {
      set.add(term);
    }
  }
  return set;
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

  const { THESAURUS_CLUSTERS } = await loadThesaurus();
  const synonymMap = buildSynonymMap(THESAURUS_CLUSTERS);
  const representativeSet = buildRepresentativeSet(THESAURUS_CLUSTERS);
  const relatedSet = buildRelatedSet(THESAURUS_CLUSTERS);

  const supabase = createClient(supabaseUrl, supabaseKey);
  const books = await fetchAllBooks(supabase);

  // 전체 태그 빈도 (유지/검토 판정용)
  const tagFrequency = new Map();
  for (const book of books) {
    for (const tag of splitTags(book.topics)) {
      tagFrequency.set(tag, (tagFrequency.get(tag) ?? 0) + 1);
    }
  }

  const rows = [];
  const stats = { 치환: 0, 유지: 0, 검토: 0 };
  const booksWithReplace = new Set();
  const reviewTags = new Set();

  for (const book of books) {
    for (const tag of splitTags(book.topics)) {
      const tagDisplay = `#${tag}`;
      let action;
      let proposedTag = "";

      if (synonymMap.has(tag)) {
        action = "치환";
        proposedTag = `#${synonymMap.get(tag)}`;
        stats.치환++;
        booksWithReplace.add(String(book.id));
      } else if (representativeSet.has(tag) || relatedSet.has(tag)) {
        action = "유지";
        stats.유지++;
      } else if ((tagFrequency.get(tag) ?? 0) >= 2) {
        action = "유지";
        stats.유지++;
      } else {
        action = "검토";
        stats.검토++;
        reviewTags.add(tag);
      }

      rows.push([
        book.id,
        book.title,
        book.source ?? "",
        tagDisplay,
        action,
        proposedTag,
        "",
      ]);
    }
  }

  writeCsvWithBom(
    OUT_PATH,
    ["book_id", "title", "source", "tag", "action", "proposed_tag", "note"],
    rows
  );

  const totalTags = stats.치환 + stats.유지 + stats.검토;
  const reviewTop20 = [...reviewTags].sort((a, b) => a.localeCompare(b, "ko")).slice(0, 20);

  console.log("📋 태그 정규화 dry-run (쓰기 없음, SELECT만)");
  console.log(`전체 태그 수: ${totalTags}`);
  console.log(`  치환 예정: ${stats.치환}`);
  console.log(`  유지: ${stats.유지}`);
  console.log(`  검토 큐: ${stats.검토}`);
  console.log(`치환 발생 책 수: ${booksWithReplace.size}권`);
  console.log(`\n검토 큐 태그 상위 ${reviewTop20.length}개:`);
  for (const tag of reviewTop20) {
    console.log(`  - #${tag}`);
  }
  console.log(`\n✅ ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("❌ 실행 실패:", err);
  process.exit(1);
});
