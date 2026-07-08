"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ANALYZE_AXES, type AnalyzeAxisId } from "@/lib/analyzeAxes";
import { FICTION_KEYWORDS } from "@/lib/analyzeTopics";
import {
  THESAURUS_CLUSTERS,
  type ThesaurusClusterId,
} from "@/lib/thesaurus";

type AxisScore = { a: number; b: number };

type BookRow = {
  bookId: string;
  title: string;
  source: string;
  topics: string;
  coverUrl: string;
  scores: Record<AnalyzeAxisId, AxisScore>;
};

function isFiction(book: BookRow): boolean {
  return FICTION_KEYWORDS.some((k) => book.topics.includes(k));
}

const AXIS_CSV_PREFIX: Record<AnalyzeAxisId, string> = {
  "indiv-struct": "indiv",
  "neutral-critical": "neutral",
  "now-future": "now",
  "cause-solution": "cause",
  "acad-pop": "acad",
  "narrative-explain": "narrative",
};

const SOURCE_COLORS: Record<string, string> = {
  notion: "#5a7a3a",
  nlk: "#185FA5",
};

const SOURCE_LABELS: Record<string, string> = {
  notion: "주요 일간지 서평",
  nlk: "국립중앙도서관 사서추천",
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
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

function parseCsv(text: string): BookRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);
  const idx = (name: string) => header.indexOf(name);

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const num = (name: string) => {
      const n = Number(cells[idx(name)]);
      return Number.isFinite(n) ? n : 0;
    };
    const scores = {} as Record<AnalyzeAxisId, AxisScore>;
    for (const axis of ANALYZE_AXES) {
      const prefix = AXIS_CSV_PREFIX[axis.id];
      scores[axis.id] = { a: num(`${prefix}_a`), b: num(`${prefix}_b`) };
    }
    const cell = (name: string) => {
      const i = idx(name);
      return i >= 0 ? cells[i] ?? "" : "";
    };
    return {
      bookId: cell("book_id"),
      title: cell("title"),
      source: cell("source"),
      topics: cell("topics"),
      coverUrl: cell("cover_url"),
      scores,
    };
  });
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function lerpColor(from: string, to: string, t: number): string {
  const c1 = hexToRgb(from);
  const c2 = hexToRgb(to);
  const mix = c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

// 0 → 테라코타, 0.5 → 옅은 베이지, 1 → 청록 선형 보간
function positionColor(position: number): string {
  if (position <= 0.5) {
    return lerpColor("#c26a4a", "#f0ebe0", position * 2);
  }
  return lerpColor("#f0ebe0", "#3a7a6a", (position - 0.5) * 2);
}

function truncateTitle(title: string, max = 18): string {
  return title.length > max ? `${title.slice(0, max)}…` : title;
}

function HeatmapView({
  books,
  axes,
}: {
  books: BookRow[];
  axes: (typeof ANALYZE_AXES)[number][];
}) {
  const sortedBooks = useMemo(() => {
    return [...books].sort((x, y) => {
      if (x.source !== y.source) return x.source === "notion" ? -1 : 1;
      return x.title.localeCompare(y.title, "ko");
    });
  }, [books]);

  const summaryRows = useMemo(() => {
    return (["notion", "nlk"] as const).map((source) => {
      const sourceBooks = sortedBooks.filter((b) => b.source === source);
      const averages = axes.map((axis) => {
        const positions = sourceBooks
          .map((b) => b.scores[axis.id])
          .filter((s) => !(s.a === 0 && s.b === 0))
          .map((s) => (s.b - s.a + 1) / 2);
        if (positions.length === 0) return null;
        return positions.reduce((sum, p) => sum + p, 0) / positions.length;
      });
      return { source, label: `${SOURCE_LABELS[source]} 평균`, averages };
    });
  }, [sortedBooks, axes]);

  const downloadCsv = () => {
    const quote = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const header = [
      "title",
      "source",
      ...axes.map((axis) => `${axis.labelA}↔${axis.labelB}`),
    ];
    const lines = [header.map(quote).join(",")];
    for (const book of sortedBooks) {
      const cells: (string | number)[] = [book.title, book.source];
      for (const axis of axes) {
        const { a, b } = book.scores[axis.id];
        cells.push(a === 0 && b === 0 ? "" : ((b - a + 1) / 2).toFixed(2));
      }
      lines.push(cells.map(quote).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "viewpoint_heatmap.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border border-[#e8e0d2] bg-white/70 p-4 sm:p-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-2 text-left font-semibold text-[#4a4238]">
                도서
              </th>
              {axes.map((axis) => (
                <th
                  key={axis.id}
                  className="p-2 text-center font-semibold text-[#4a4238]"
                >
                  {axis.labelA}↔{axis.labelB}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedBooks.map((book) => (
              <tr key={book.bookId}>
                <td className="whitespace-nowrap p-2 text-[#5a5142]">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          SOURCE_COLORS[book.source] ?? "#8a7a62",
                      }}
                    />
                    {truncateTitle(book.title)}
                  </span>
                </td>
                {axes.map((axis) => {
                  const { a, b } = book.scores[axis.id];
                  const empty = a === 0 && b === 0;
                  const position = (b - a + 1) / 2;
                  return (
                    <td
                      key={axis.id}
                      title={`${book.title} / ${axis.labelA}↔${axis.labelB} / a=${a}, b=${b}`}
                      className="h-8 min-w-[72px] border border-white/60 p-0 text-center"
                      style={{
                        backgroundColor: empty
                          ? "#e5e0d5"
                          : positionColor(position),
                      }}
                    >
                      {empty && <span className="text-[#9a8f7d]">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {summaryRows.map(({ source, label, averages }) => (
              <tr key={source} className="border-t-2 border-[#c4b69c]">
                <td className="whitespace-nowrap p-2 font-semibold text-[#4a4238]">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: SOURCE_COLORS[source] }}
                    />
                    {label}
                  </span>
                </td>
                {averages.map((avg, i) => (
                  <td
                    key={axes[i].id}
                    className="h-8 border border-white/60 p-0 text-center font-semibold text-[#3a3226]"
                    style={{
                      backgroundColor:
                        avg === null ? "#e5e0d5" : positionColor(avg),
                    }}
                  >
                    {avg === null ? "—" : avg.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={downloadCsv}
          className="rounded-lg border border-[#d8ccb8] bg-white/60 px-4 py-1.5 text-xs text-[#5a5142] transition-colors hover:bg-[#f3eee2]"
        >
          CSV 다운로드
        </button>
      </div>
    </div>
  );
}

function HoverCard({ book, position }: { book: BookRow; position: number }) {
  // 화면 가장자리에서 카드가 잘리지 않도록 좌우로 살짝 클램프
  const cardLeft = Math.min(88, Math.max(12, position * 100));

  return (
    <div
      className="pointer-events-none absolute bottom-full z-10 mb-2 w-44 -translate-x-1/2 rounded-lg border border-[#e0d6c2] bg-white p-2 shadow-md"
      style={{ left: `${cardLeft}%` }}
    >
      <div className="flex gap-2">
        {book.coverUrl && (
          <img
            src={book.coverUrl}
            alt=""
            className="h-auto w-12 shrink-0 self-start rounded"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <div className="min-w-0">
          <p className="line-clamp-2 text-xs font-semibold leading-snug text-[#3a3226]">
            {book.title}
          </p>
          <p className="mt-1 text-[10px] text-[#9a8f7d]">
            {SOURCE_LABELS[book.source] ?? book.source}
          </p>
        </div>
      </div>
    </div>
  );
}

function SpectrumBar({
  axis,
  books,
}: {
  axis: (typeof ANALYZE_AXES)[number];
  books: BookRow[];
}) {
  const [activeBookId, setActiveBookId] = useState<string | null>(null);

  const dots = books
    .map((book) => {
      const { a, b } = book.scores[axis.id];
      if (a === 0 && b === 0) return null;
      const position = (b - a + 1) / 2;
      const size = Math.min(14, Math.max(6, 6 + (a + b) * 4));
      return { book, position, size };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  // 위치값이 0.02 이내로 몰린 점들은 세로로 4px씩 어긋나게 배치 (최대 ±8px)
  const jitterByBookId = new Map<string, number>();
  const sortedDots = [...dots].sort((x, y) => x.position - y.position);
  let cluster: typeof sortedDots = [];
  const assignCluster = () => {
    cluster.forEach((dot, i) => {
      const step = Math.ceil(i / 2) * 4;
      const offset = i % 2 === 1 ? -step : step;
      jitterByBookId.set(
        dot.book.bookId,
        Math.max(-8, Math.min(8, offset))
      );
    });
    cluster = [];
  };
  for (const dot of sortedDots) {
    const prev = cluster[cluster.length - 1];
    if (prev && dot.position - prev.position > 0.02) assignCluster();
    cluster.push(dot);
  }
  assignCluster();

  const activeDot = dots.find((d) => d.book.bookId === activeBookId) ?? null;

  return (
    <div className="rounded-xl border border-[#e8e0d2] bg-white/70 p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between text-sm font-semibold text-[#4a4238]">
        <span>{axis.labelA}</span>
        <span>{axis.labelB}</span>
      </div>
      <div className="relative h-10">
        <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[#d8ccb8]" />
        <div className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-[#c4b69c]" />
        {dots.map(({ book, position, size }) => (
          <span
            key={book.bookId}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full opacity-80 transition-opacity hover:z-20 hover:opacity-100"
            style={{
              left: `${position * 100}%`,
              marginTop: `${jitterByBookId.get(book.bookId) ?? 0}px`,
              width: `${size}px`,
              height: `${size}px`,
              backgroundColor: SOURCE_COLORS[book.source] ?? "#8a7a62",
            }}
            onMouseEnter={() => setActiveBookId(book.bookId)}
            onMouseLeave={() => setActiveBookId(null)}
            onClick={() =>
              setActiveBookId((prev) =>
                prev === book.bookId ? null : book.bookId
              )
            }
          />
        ))}
        {activeDot && (
          <HoverCard book={activeDot.book} position={activeDot.position} />
        )}
      </div>
      <p className="mt-2 text-right text-xs text-[#9a8f7d]">
        표시된 책: {dots.length}권{" "}
        <span className="text-[10px] text-[#b3a992]">
          · 겹침 주의: 비슷한 위치의 책은 위아래로 흩어 표시됩니다
        </span>
      </p>
    </div>
  );
}

function AnalyzeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topicFilter = searchParams.get("topic")?.trim() || null;

  const [books, setBooks] = useState<BookRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [enabledAxes, setEnabledAxes] = useState<Set<AnalyzeAxisId>>(
    () => new Set(ANALYZE_AXES.slice(0, 3).map((axis) => axis.id))
  );
  const [sourceFilter, setSourceFilter] = useState<"all" | "notion" | "nlk">(
    "all"
  );
  const [selectedTopic, setSelectedTopic] =
    useState<ThesaurusClusterId | null>(null);
  const [clusterMap, setClusterMap] = useState<Map<string, string[]>>(
    () => new Map()
  );
  const [genreFilter, setGenreFilter] = useState<
    "all" | "nonfiction" | "fiction"
  >("all");
  const [viewMode, setViewMode] = useState<"spectrum" | "heatmap">("spectrum");

  useEffect(() => {
    fetch("/data/analyze_scores.csv")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => setBooks(parseCsv(text)))
      .catch(() => setLoadError(true));

    fetch("/data/book_clusters.csv")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const map = new Map<string, string[]>();
        for (const line of lines.slice(1)) {
          const [bookId, clusterIds] = parseCsvLine(line);
          map.set(
            bookId ?? "",
            (clusterIds ?? "").split("|").filter(Boolean)
          );
        }
        setClusterMap(map);
      })
      .catch(() => {
        // 클러스터 파일이 없으면 토픽 칩 카운트가 0으로 표시될 뿐, 페이지는 동작
      });
  }, []);

  // URL ?topic= 필터 + source/장르 필터까지 적용된 기본 집합 (칩 필터 제외)
  const baseBooks = useMemo(() => {
    if (!books) return [];
    let result = books;
    if (topicFilter) {
      result = result.filter((b) => b.topics.includes(topicFilter));
    }
    if (sourceFilter !== "all") {
      result = result.filter((b) => b.source === sourceFilter);
    }
    if (genreFilter !== "all") {
      result = result.filter((b) =>
        genreFilter === "fiction" ? isFiction(b) : !isFiction(b)
      );
    }
    return result;
  }, [books, sourceFilter, topicFilter, genreFilter]);

  const matchesTopic = (book: BookRow, clusterId: ThesaurusClusterId) =>
    (clusterMap.get(book.bookId) ?? []).includes(clusterId);

  const filteredBooks = useMemo(() => {
    // URL 필터가 있으면 칩 필터는 무시 (URL 우선)
    if (topicFilter || !selectedTopic) return baseBooks;
    return baseBooks.filter((b) => matchesTopic(b, selectedTopic));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseBooks, selectedTopic, topicFilter, clusterMap]);

  const topicCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cluster of THESAURUS_CLUSTERS) {
      counts[cluster.id] = baseBooks.filter((b) =>
        (clusterMap.get(b.bookId) ?? []).includes(cluster.id)
      ).length;
    }
    return counts;
  }, [baseBooks, clusterMap]);

  const toggleAxis = (id: AnalyzeAxisId) => {
    setEnabledAxes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <main className="min-h-screen bg-[#faf7f2] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#7a6f5d] transition-colors hover:text-[#3a3226]"
        >
          ← ViewPoint로 돌아가기
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-[#3a3226] sm:text-3xl">
          ViewPoint Labs 🧪
        </h1>
        <p className="mt-2 text-sm text-[#7a6f5d] sm:text-base">
          책들은 관점의 지도 위 어디에 있을까요? 스펙트럼과 히트맵으로 자유롭게
          탐험해보세요.
        </p>
        {topicFilter && (
          <p className="mt-3 rounded-lg border border-[#e0d6c2] bg-[#f3eee2] px-4 py-2 text-sm text-[#5a5142]">
            &lsquo;{topicFilter}&rsquo; 관련 도서만 표시 중 (
            <button
              type="button"
              onClick={() => router.replace("/analyze")}
              className="underline underline-offset-2 hover:text-[#3a3226]"
            >
              전체 보기
            </button>
            )
          </p>
        )}

        <section className="mt-6 rounded-xl border border-[#e8e0d2] bg-white/70 p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-[#4a4238]">관점 축 선택</h2>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {ANALYZE_AXES.map((axis) => (
              <label
                key={axis.id}
                className="flex cursor-pointer items-center gap-2 text-sm text-[#5a5142]"
              >
                <input
                  type="checkbox"
                  checked={enabledAxes.has(axis.id)}
                  onChange={() => toggleAxis(axis.id)}
                  className="h-4 w-4 accent-[#5a7a3a]"
                />
                {axis.labelA} ↔ {axis.labelB}
              </label>
            ))}
          </div>

          <h2 className="mt-5 text-sm font-semibold text-[#4a4238]">
            출처 필터
          </h2>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                { value: "all", label: "전체" },
                { value: "notion", label: SOURCE_LABELS.notion },
                { value: "nlk", label: SOURCE_LABELS.nlk },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 text-sm text-[#5a5142]"
              >
                <input
                  type="radio"
                  name="source-filter"
                  checked={sourceFilter === option.value}
                  onChange={() => setSourceFilter(option.value)}
                  className="h-4 w-4 accent-[#5a7a3a]"
                />
                {option.label}
              </label>
            ))}
          </div>

          <h2 className="mt-5 text-sm font-semibold text-[#4a4238]">
            장르 필터
          </h2>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                { value: "all", label: "전체" },
                { value: "nonfiction", label: "비문학" },
                { value: "fiction", label: "문학" },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 text-sm text-[#5a5142]"
              >
                <input
                  type="radio"
                  name="genre-filter"
                  checked={genreFilter === option.value}
                  onChange={() => setGenreFilter(option.value)}
                  className="h-4 w-4 accent-[#5a7a3a]"
                />
                {option.label}
              </label>
            ))}
          </div>

          <h2 className="mt-5 text-sm font-semibold text-[#4a4238]">
            토픽 필터
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedTopic(null)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                selectedTopic === null
                  ? "border-[#2c2416] bg-[#2c2416] text-[#faf7f2]"
                  : "border-[#d8ccb8] bg-white/60 text-[#5a5142] hover:bg-[#f3eee2]"
              }`}
            >
              전체 ({baseBooks.length})
            </button>
            {THESAURUS_CLUSTERS.map((cluster) => (
              <button
                key={cluster.id}
                type="button"
                onClick={() =>
                  setSelectedTopic((prev) =>
                    prev === cluster.id ? null : cluster.id
                  )
                }
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  selectedTopic === cluster.id
                    ? "border-[#2c2416] bg-[#2c2416] text-[#faf7f2]"
                    : "border-[#d8ccb8] bg-white/60 text-[#5a5142] hover:bg-[#f3eee2]"
                }`}
              >
                {cluster.label} ({topicCounts[cluster.id] ?? 0})
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[#7a6f5d]">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: SOURCE_COLORS.notion }}
              />
              {SOURCE_LABELS.notion}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: SOURCE_COLORS.nlk }}
              />
              {SOURCE_LABELS.nlk}
            </span>
            <span>점 크기 = 두 관점 소속도의 합</span>
          </div>
        </section>

        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
          {(
            [
              { value: "spectrum", label: "스펙트럼" },
              { value: "heatmap", label: "히트맵" },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 text-sm text-[#5a5142]"
            >
              <input
                type="radio"
                name="view-mode"
                checked={viewMode === option.value}
                onChange={() => setViewMode(option.value)}
                className="h-4 w-4 accent-[#5a7a3a]"
              />
              {option.label}
            </label>
          ))}
        </div>

        <section className="mt-4 flex flex-col gap-4">
          {loadError && (
            <p className="rounded-xl border border-[#e8d0c0] bg-[#fdf3ec] p-4 text-sm text-[#a05a3a]">
              데이터 파일을 찾을 수 없습니다
            </p>
          )}
          {!loadError && books === null && (
            <p className="p-4 text-sm text-[#7a6f5d]">데이터 불러오는 중...</p>
          )}
          {books !== null &&
            viewMode === "spectrum" &&
            ANALYZE_AXES.filter((axis) => enabledAxes.has(axis.id)).map(
              (axis) => (
                <SpectrumBar key={axis.id} axis={axis} books={filteredBooks} />
              )
            )}
          {books !== null && viewMode === "heatmap" && (
            <HeatmapView
              books={filteredBooks}
              axes={ANALYZE_AXES.filter((axis) => enabledAxes.has(axis.id))}
            />
          )}
        </section>

        <p className="mt-8 text-center text-xs text-[#9a9488]">
          이 실험실은 ViewPoint의 관점 분류 연구 공간입니다. 점수는 AI가 계산한
          참고용 값이에요.
        </p>
      </div>
    </main>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#faf7f2] px-4 py-8 sm:px-8">
          <p className="p-4 text-sm text-[#7a6f5d]">불러오는 중...</p>
        </main>
      }
    >
      <AnalyzeContent />
    </Suspense>
  );
}
