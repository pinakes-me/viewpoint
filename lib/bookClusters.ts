import fs from "fs";
import path from "path";
import { parseCsvRows } from "./csv";

const CSV_PATH = path.join(process.cwd(), "public/data/book_clusters.csv");

let cache: Map<string, number[]> | null = null;

function loadClusterMap(): Map<string, number[]> {
  if (cache) return cache;

  const map = new Map<string, number[]>();
  const text = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parseCsvRows(text).slice(1); // header: book_id,cluster_ids

  for (const [bookIdRaw, clusterIdsRaw] of rows) {
    const bookId = Number(bookIdRaw);
    if (!Number.isFinite(bookId)) continue;
    for (const clusterId of (clusterIdsRaw ?? "").split("|").filter(Boolean)) {
      const ids = map.get(clusterId) ?? [];
      ids.push(bookId);
      map.set(clusterId, ids);
    }
  }

  cache = map;
  return map;
}

export function getBookIdsForCluster(clusterId: string): number[] {
  return loadClusterMap().get(clusterId) ?? [];
}
