import fs from "fs";
import path from "path";
import { parseCsvRows } from "./csv";
import { AXIS_CSV_PREFIX, type PerspectiveAxisId } from "./perspectiveAxes";

// curate와 Labs가 같은 행(row)을 보게 하는 단일 소스.
// Labs의 배치 채점 파이프라인(scripts/analyze-batch.mjs)이 갱신하는 파일을 그대로 조회한다.
const CSV_PATH = path.join(process.cwd(), "public/data/analyze_scores.csv");

type AxisScore = { a: number; b: number };
type BookScores = Record<PerspectiveAxisId, AxisScore>;

let cache: Map<number, BookScores> | null = null;

function loadScores(): Map<number, BookScores> {
  if (cache) return cache;

  const text = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parseCsvRows(text);
  const header = rows[0];
  const colIndex = (name: string) => header.indexOf(name);
  const bookIdCol = colIndex("book_id");

  const map = new Map<number, BookScores>();
  for (const cells of rows.slice(1)) {
    const bookId = Number(cells[bookIdCol]);
    if (!Number.isFinite(bookId)) continue;

    const scores = {} as BookScores;
    for (const axisId of Object.keys(AXIS_CSV_PREFIX) as PerspectiveAxisId[]) {
      const prefix = AXIS_CSV_PREFIX[axisId];
      const a = Number(cells[colIndex(`${prefix}_a`)]);
      const b = Number(cells[colIndex(`${prefix}_b`)]);
      scores[axisId] = {
        a: Number.isFinite(a) ? a : 0,
        b: Number.isFinite(b) ? b : 0,
      };
    }
    map.set(bookId, scores);
  }

  cache = map;
  return map;
}

// v4 배치에 없는 신규 도서는 null 반환 (아직 채점되지 않음 - 알려진 트레이드오프, CLAUDE.md 참고).
export function getMembershipScore(
  bookId: number,
  axisId: PerspectiveAxisId
): AxisScore | null {
  return loadScores().get(bookId)?.[axisId] ?? null;
}

// "관점 스펙트럼 확인" 버튼용 - 6축 전체 값을 한 번에 반환 (새 API 호출 없이 시각화).
export function getAllMembershipScores(bookId: number): BookScores | null {
  return loadScores().get(bookId) ?? null;
}
