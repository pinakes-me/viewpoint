import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCORES_PATH = path.join(ROOT, "data", "analyze_scores.csv");
const OUT_PATH = path.join(ROOT, "public", "data", "book_clusters.csv");

// lib/thesaurus.ts는 데이터 전용 모듈이라 타입 구문만 제거하면 그대로 ESM으로 실행 가능
async function loadThesaurus() {
  const src = fs.readFileSync(path.join(ROOT, "lib", "thesaurus.ts"), "utf8");
  const js = src
    .replace(/\bas const\b/g, "")
    .replace(/^export type .*$/gm, "");
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(js)}`);
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

function csvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

// 판정 규칙: 제외어를 먼저 제거한 뒤 대표태그 → 유의어 → 관련어 순으로 부분 매칭
function assignClusters(topics, clusters) {
  const matched = [];
  for (const cluster of clusters) {
    let text = topics;
    for (const term of cluster.excluded) {
      text = text.split(term).join("");
    }
    const terms = [
      cluster.representativeTag,
      ...cluster.synonyms,
      ...cluster.related,
    ];
    if (terms.some((term) => text.includes(term))) {
      matched.push(cluster.id);
    }
  }
  return matched;
}

async function main() {
  if (!fs.existsSync(SCORES_PATH)) {
    console.error(`❌ ${SCORES_PATH} 파일이 없습니다. 배치 스크립트를 먼저 실행하세요.`);
    process.exit(1);
  }

  const { THESAURUS_CLUSTERS } = await loadThesaurus();

  const lines = fs
    .readFileSync(SCORES_PATH, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  const idx = (name) => header.indexOf(name);
  if (idx("book_id") === -1 || idx("topics") === -1) {
    console.error("❌ CSV에 book_id 또는 topics 컬럼이 없습니다.");
    process.exit(1);
  }

  const books = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return {
      bookId: cells[idx("book_id")] ?? "",
      title: cells[idx("title")] ?? "",
      topics: cells[idx("topics")] ?? "",
    };
  });

  const rows = [];
  const clusterCounts = new Map(THESAURUS_CLUSTERS.map((c) => [c.id, 0]));
  const unclassified = [];
  const multiMembership = [];

  for (const book of books) {
    const clusterIds = assignClusters(book.topics, THESAURUS_CLUSTERS);
    rows.push([book.bookId, clusterIds.join("|")].map(csvValue).join(","));

    for (const id of clusterIds) {
      clusterCounts.set(id, clusterCounts.get(id) + 1);
    }
    if (clusterIds.length === 0) unclassified.push(book);
    if (clusterIds.length >= 3) multiMembership.push({ book, clusterIds });
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    ["book_id,cluster_ids", ...rows].join("\n") + "\n",
    "utf8"
  );

  console.log(`📊 클러스터별 권수 (전체 ${books.length}권)`);
  for (const cluster of THESAURUS_CLUSTERS) {
    console.log(`  - ${cluster.label}: ${clusterCounts.get(cluster.id)}권`);
  }

  console.log(`\n❓ 미분류: ${unclassified.length}권`);
  for (const book of unclassified) {
    console.log(`  - [${book.bookId}] ${book.title} | ${book.topics}`);
  }

  console.log(`\n🔀 3개 이상 다중 소속: ${multiMembership.length}권`);
  for (const { book, clusterIds } of multiMembership) {
    console.log(`  - [${book.bookId}] ${book.title} → ${clusterIds.join(", ")}`);
  }

  console.log(`\n✅ 저장 완료 → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("❌ 실행 실패:", err);
  process.exit(1);
});
