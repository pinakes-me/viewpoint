"use client";

import React, { useMemo, useRef, useState } from "react";
import { BookCard } from "@/components/BookCard";
import { Navbar } from "@/components/Navbar";
import { SkeletonCard } from "@/components/SkeletonCard";
import { useShelf } from "@/hooks/useShelf";
import type { CurationResult, PerspectiveMode, ShelfItem } from "@/lib/types";
import { PERSPECTIVES, PRESET_TOPICS } from "@/lib/perspectives";

function groupByTopic(items: ShelfItem[]) {
  const order: string[] = [];
  const map = new Map<string, ShelfItem[]>();
  for (const item of items) {
    const key = item.topic.trim() || "기타";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(item);
  }
  return { order, map };
}

function EmptyShelfIllustration() {
  return (
    <svg
      className="mx-auto h-24 w-24 text-sepia-200"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M11.25 4.533A9 9 0 006 3.75C4.757 3.75 3.562 3.988 2.47 4.42V18.47A10.97 10.97 0 006 18c1.85 0 3.56.46 5.07 1.27V6.77A8.97 8.97 0 0111.25 4.533zM12.75 6.77v12.47a10.97 10.97 0 015.07-1.27c1.438 0 2.813.31 4.05.87V4.42A9.02 9.02 0 0018 3.75a9 9 0 00-5.25 3.02z" />
    </svg>
  );
}

export default function HomePage() {
  const { shelf, removeFromShelf, clearShelf } = useShelf();
  const shelfCount = shelf.length;

  const [topic, setTopic] = useState("");
  const [customLabelA, setCustomLabelA] = useState("");
  const [customLabelB, setCustomLabelB] = useState("");
  const [selectedMode, setSelectedMode] = useState<PerspectiveMode>(
    PERSPECTIVES[1]
  );
  const [result, setResult] = useState<CurationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [suggestedPerspectives, setSuggestedPerspectives] = useState<
    { labelA: string; labelB: string; description: string }[]
  >([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [selectedSuggestedIndex, setSelectedSuggestedIndex] = useState<number | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestRef = useRef<HTMLDivElement>(null);

  const { order, map } = useMemo(() => groupByTopic(shelf), [shelf]);

  async function handleCopyAll() {
    const text = shelf.map((i) => `${i.title} · ${i.author} (${i.year})`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("복사할 내용:", text);
    }
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  }

  function handleClearAll() {
    if (!window.confirm("정말 모두 삭제할까요?")) return;
    clearShelf();
  }

  function handleResetToHero() {
    setHasResult(false);
    setResult(null);
    setTopic("");
    setShelfOpen(false);
    setError(null);
  }

  function handleLogoClick() {
    if (shelfOpen) setShelfOpen(false);
    else handleResetToHero();
  }

  async function handleSubmit(overrideMode?: PerspectiveMode) {
    const mode = overrideMode ?? selectedMode;
    const q = topic.trim();
    if (!q) {
      setError("주제를 입력하거나 선택해 주세요.");
      return;
    }

    let labelA: string;
    let labelB: string;

    if (selectedSuggestedIndex !== null && overrideMode === undefined) {
      const sp = suggestedPerspectives[selectedSuggestedIndex];
      labelA = sp.labelA;
      labelB = sp.labelB;
      // 추천 관점으로 실행 → 기존 관점 탭 선택 상태 초기화
      setSelectedMode(PERSPECTIVES[1]);
    } else {
      if (
        mode.id === "custom" &&
        (customLabelA.trim() === "" || customLabelB.trim() === "")
      ) {
        setError("관점 A와 B를 모두 입력해주세요.");
        return;
      }
      labelA = mode.id === "custom" ? customLabelA.trim() : mode.labelA;
      labelB = mode.id === "custom" ? customLabelB.trim() : mode.labelB;
      // 기존 관점 탭으로 실행 → 추천 관점 선택 상태 초기화
      setSelectedSuggestedIndex(null);
    }

    setLoading(true);
    setError(null);
    setShelfOpen(false);
    setResult(null);

    try {
      const res = await fetch("/api/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: q,
          labelA,
          labelB,
        }),
      });

      const data = (await res.json()) as CurationResult | { error?: string };
      if (!res.ok) {
        throw new Error(
          "error" in data && typeof data.error === "string"
            ? data.error
            : "큐레이션 요청에 실패했습니다."
        );
      }

      if ("summary" in data && "groupA" in data && "groupB" in data) {
        setResult(data as CurationResult);
        setHasResult(true);
      } else {
        throw new Error("응답 형식이 올바르지 않습니다.");
      }
    } catch (e: any) {
      setError(e?.message ?? "네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmitFromForm(e: React.FormEvent) {
    e.preventDefault();
    void handleSubmit();
  }

  function handleModeChange(mode: PerspectiveMode) {
    setSelectedMode(mode);
    if (hasResult) {
      void handleSubmit(mode);
    }
  }

  async function fetchSuggestedPerspectives(t: string) {
    setIsSuggesting(true);
    try {
      const res = await fetch("/api/suggest-perspectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: t }),
      });
      const data = await res.json();
      if (Array.isArray(data.perspectives)) {
        setSuggestedPerspectives(data.perspectives);
        if (suggestRef.current) {
          const y = suggestRef.current.getBoundingClientRect().top + window.scrollY - 120;
          window.scrollTo({ top: y, behavior: "smooth" });
        }
      }
    } catch {
      // silently ignore
    } finally {
      setIsSuggesting(false);
    }
  }

  const activeLabelA =
    selectedSuggestedIndex !== null
      ? suggestedPerspectives[selectedSuggestedIndex]?.labelA ?? selectedMode.labelA
      : selectedMode.labelA;
  const activeLabelB =
    selectedSuggestedIndex !== null
      ? suggestedPerspectives[selectedSuggestedIndex]?.labelB ?? selectedMode.labelB
      : selectedMode.labelB;

  const heroVisible = !hasResult;
  const resultsVisible = hasResult;
  const pageMinH = hasResult
    ? "min-h-[calc(100dvh-3rem)]"
    : "min-h-dvh";

  return (
    <>
      <div className={shelfOpen ? "hidden" : ""}>
        <Navbar
          hasResult={hasResult}
          shelfOpen={shelfOpen}
          shelfCount={shelfCount}
          onLogoClick={handleLogoClick}
          onShelfClick={() => setShelfOpen(true)}
        />
      </div>
      <div className={`relative flex-1 bg-sepia-50 ${pageMinH}`}>
      <div
        className={
          `absolute inset-0 flex flex-col items-center overflow-y-auto px-4 pt-20 pb-16 transition-all duration-500 ease-in-out ${pageMinH} ` +
          (heroVisible
            ? "z-20 opacity-100"
            : "pointer-events-none z-0 scale-[0.98] opacity-0")
        }
        aria-hidden={!heroVisible}
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-transparent p-0 text-inherit focus:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
            aria-label="ViewPoint"
          >
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#5a7a3a" />
              <path
                d="M6 9 L16 23 L26 9"
                stroke="#faf7f2"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <circle cx="6" cy="9" r="3" fill="#c8dfa8" />
              <circle cx="26" cy="9" r="3" fill="#f4c4a8" />
            </svg>
            <span className="font-serif text-2xl font-medium text-sepia-900">
              ViewPoint
            </span>
          </button>
          <p className="text-xs font-medium uppercase tracking-widest text-sepia-500">
            관점 기반 북큐레이션
          </p>
          <h1 className="mt-6 font-serif text-4xl font-medium leading-tight text-sepia-900 sm:text-5xl">
            같은 주제,
            <br />
            <span className="italic text-forest">다른 시선으로</span>
            {" 읽다"}
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-sepia-600 sm:text-lg">
            관점을 선택하면 AI가 개인·구조, 설명·비판 등 다양한 시각의
            <br className="hidden sm:inline" /> {/* 테블릿/PC 이상에서만 줄바꿈 */}
            도서를 큐레이션 해드립니다.
          </p>

          <form
            onSubmit={handleSubmitFromForm}
            className="mt-10 w-full max-w-lg space-y-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <input
                type="text"
                value={topic}
                onChange={(e) => {
                  const val = e.target.value;
                  setTopic(val);
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  if (val === "") {
                    setSuggestedPerspectives([]);
                    setSelectedSuggestedIndex(null);
                  } else if (val.trim().length >= 2) {
                    debounceRef.current = setTimeout(() => {
                      void fetchSuggestedPerspectives(val.trim());
                    }, 500);
                  }
                }}
                placeholder="주제를 입력하세요"
                className="min-h-11 flex-1 rounded-xl border border-sepia-300 bg-white px-4 text-sepia-900 shadow-sm placeholder:text-sepia-400 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
                aria-label="주제"
              />
              <button
                type="submit"
                disabled={loading}
                className="min-h-11 shrink-0 rounded-xl bg-forest px-6 font-medium text-white shadow-sm transition-colors hover:bg-forest/90 disabled:opacity-60"
              >
                큐레이션 시작
              </button>
            </div>
          </form>

          {loading ? (
            <div className="mt-8 w-full max-w-2xl">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <SkeletonCard key={`hero-a-${i}`} />
                  ))}
                </div>
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <SkeletonCard key={`hero-b-${i}`} />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {error &&
          !hasResult &&
          error !== "관점 A와 B를 모두 입력해주세요." ? (
            <p
              className="mt-4 max-w-lg rounded-xl border border-rust/40 bg-rust-bg px-4 py-2 text-sm text-rust"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {(isSuggesting || suggestedPerspectives.length > 0) && (
            <div ref={suggestRef} className="mt-6 w-full max-w-lg">
              <p className="text-xs text-sepia-400 tracking-widest uppercase mb-2">
                추천 관점
              </p>
              {isSuggesting ? (
                <div className="flex flex-col gap-2">
                  {[0, 1].map((i) => (
                    <div
                      key={i}
                      className="animate-pulse rounded-xl border border-sepia-200 bg-sepia-100 px-4 py-3"
                    >
                      <div className="h-4 w-2/3 rounded bg-sepia-200" />
                      <div className="mt-2 h-3 w-full rounded bg-sepia-200" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {suggestedPerspectives.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedSuggestedIndex(i)}
                      className={
                        "w-full rounded-xl border px-4 py-3 text-left transition-colors " +
                        (selectedSuggestedIndex === i
                          ? "border-[#5a7a3a] bg-[#eef4e6]"
                          : "border-[#ddd5c4] bg-[#f4f0e8] hover:bg-sepia-100")
                      }
                    >
                      <p className="text-sm font-medium text-sepia-900">
                        {p.labelA} ↔ {p.labelB}
                      </p>
                      <p className="mt-1 text-xs text-sepia-600">{p.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-8 w-full max-w-lg">
            <p className="text-xs text-sepia-400 tracking-widest uppercase mb-2">
              빠른 주제
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {PRESET_TOPICS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTopic(t);
                    void fetchSuggestedPerspectives(t);
                  }}
                  className={
                    "rounded-full border-[0.5px] border-sepia-300 px-3 py-1.5 text-sm text-sepia-600 transition-colors " +
                    (topic === t
                      ? "border-forest bg-forest-bg text-forest"
                      : "bg-white hover:bg-sepia-50")
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 w-full max-w-2xl">
            <p className="text-xs text-sepia-400 tracking-widest uppercase mb-2">
              관점 설정
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PERSPECTIVES.map((p) => {
                const active = selectedMode.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedMode(p);
                      setSelectedSuggestedIndex(null);
                      if (error === "관점 A와 B를 모두 입력해주세요.") {
                        setError(null);
                      }
                    }}
                    className={
                      active && selectedSuggestedIndex === null
                        ? "rounded-lg border border-sepia-900 bg-sepia-900 px-3 py-1.5 text-sm font-medium text-white transition-colors"
                        : "rounded-lg border border-sepia-400 bg-transparent px-3 py-1.5 text-sm font-medium text-sepia-700 transition-colors hover:bg-sepia-100/50"
                    }
                  >
                    {p.labelA} / {p.labelB}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedMode.id === "custom" ? (
            <div className="mt-4 flex w-full max-w-lg flex-col gap-2">
              <div>
                <div className="text-xs text-sepia-500">관점 A</div>
                <input
                  type="text"
                  placeholder="관점 A  예: 기술 낙관주의, 시장 옹호론..."
                  value={customLabelA}
                  onChange={(e) => {
                    setCustomLabelA(e.target.value);
                    if (error === "관점 A와 B를 모두 입력해주세요.") {
                      setError(null);
                    }
                  }}
                  className="mt-1 min-h-11 w-full rounded-xl border border-sepia-300 bg-sepia-50 px-4 text-sepia-900 shadow-sm placeholder:text-sepia-400 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
                />
              </div>
              <div>
                <div className="text-xs text-sepia-500">관점 B</div>
                <input
                  type="text"
                  placeholder="관점 B  예: 생태주의, 구조적 비판론..."
                  value={customLabelB}
                  onChange={(e) => {
                    setCustomLabelB(e.target.value);
                    if (error === "관점 A와 B를 모두 입력해주세요.") {
                      setError(null);
                    }
                  }}
                  className="mt-1 min-h-11 w-full rounded-xl border border-sepia-300 bg-sepia-50 px-4 text-sepia-900 shadow-sm placeholder:text-sepia-400 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
                />
              </div>
              {error === "관점 A와 B를 모두 입력해주세요." ? (
                <p className="text-xs text-rust" role="alert">
                  관점 A와 B를 모두 입력해주세요.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div
        className={
          `absolute inset-0 flex min-h-[100dvh] md:min-h-[calc(100dvh-3rem)] flex-col transition-all duration-500 ease-in-out ` +
          (resultsVisible
            ? "z-20 opacity-100"
            : "pointer-events-none z-0 opacity-0")
        }
        aria-hidden={!resultsVisible}
      >
        <div className="relative flex h-full min-h-0 flex-1 overflow-hidden">
          <aside className="hidden md:flex h-full w-[260px] shrink-0 flex-col gap-3 border-r border-sepia-300 bg-sepia-100 px-4 pt-4 pb-0">
            <button
              type="button"
              onClick={handleResetToHero}
              className="w-full shrink-0 cursor-pointer text-left font-serif text-lg font-medium text-sepia-900 transition-opacity hover:opacity-70"
            >
              ViewPoint
            </button>

            <form onSubmit={handleSubmitFromForm} className="space-y-2 shrink-0">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-sepia-600">
                주제 입력
              </h2>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="주제"
                className="w-full rounded-lg border border-sepia-300 bg-white px-3 py-2 text-sm text-sepia-900 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-forest py-2.5 text-sm font-medium text-white hover:bg-forest/90 disabled:opacity-60"
              >
                다시 큐레이션
              </button>
            </form>

            <section className="shrink-0">
              <p className="text-xs text-sepia-400 tracking-widest uppercase mb-2">
                빠른 주제
              </p>
              <div className="flex flex-col gap-2">
                {PRESET_TOPICS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTopic(t)}
                    className={
                      "w-full rounded-full border-[0.5px] border-sepia-300 px-3 py-1.5 text-left text-sm text-sepia-600 transition-colors " +
                      (topic === t
                        ? "border-forest bg-forest-bg text-forest"
                        : "bg-white hover:bg-sepia-50")
                    }
                  >
                    {t}
                  </button>
                ))}
              </div>
            </section>

            <section className="overflow-y-auto pb-18">
              <p className="text-xs text-sepia-400 tracking-widest uppercase mb-2">
                관점 설정
              </p>
              <nav className="flex flex-col gap-1.5" aria-label="관점 선택">
                {PERSPECTIVES.map((p) => {
                  const active = selectedMode.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleModeChange(p)}
                      className={
                        active
                          ? "w-full rounded-lg border border-sepia-900 bg-sepia-900 px-3 py-2.5 text-left text-sm font-medium text-white transition-colors"
                          : "w-full rounded-lg border border-sepia-400 bg-transparent px-3 py-2.5 text-left text-sm font-medium text-sepia-700 transition-colors hover:bg-sepia-100/50"
                      }
                    >
                      <span className="block text-[11px] opacity-80">
                        {p.labelA}
                      </span>
                      <span className="block text-[11px] opacity-80">
                        {p.labelB}
                      </span>
                    </button>
                  );
                })}
              </nav>
              {selectedMode.id === "custom" && (
                <div className="mt-3 mb-8 flex flex-col gap-2">
                  <div>
                    <div className="text-xs text-sepia-400">관점 A</div>
                    <input
                      type="text"
                      placeholder="예: 기술 낙관주의..."
                      value={customLabelA}
                      onChange={(e) => setCustomLabelA(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-sepia-300 bg-sepia-50 px-3 py-2 text-sm text-sepia-900 placeholder:text-sepia-400 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-sepia-400">관점 B</div>
                    <input
                      type="text"
                      placeholder="예: 생태주의..."
                      value={customLabelB}
                      onChange={(e) => setCustomLabelB(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-sepia-300 bg-sepia-50 px-3 py-2 text-sm text-sepia-900 placeholder:text-sepia-400 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30"
                    />
                  </div>
                </div>
              )}
            </section>

          </aside>

          <main
            className="min-h-0 flex-1 overflow-y-auto p-3 pb-32 md:p-5 md:pb-5"
            style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            {error && hasResult ? (
              <p
                className="mb-4 rounded-xl border border-rust/40 bg-rust-bg px-4 py-3 text-sm text-rust"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <div className="rounded-xl border border-sepia-300 bg-sepia-100 px-4 py-3 text-sm text-sepia-800">
              {result ? (
                <p className="leading-relaxed">
                  {topic} · {activeLabelA} vs {activeLabelB}{" "}
                  — {result.summary}
                </p>
              ) : (
                <p className="text-sepia-500">요약을 불러오는 중…</p>
              )}
            </div>

            <p className="mt-1.5 text-right text-[11px] text-sepia-400">
              * AI는 실수할 수 있습니다. 책 정보는 직접 확인해주세요.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <section className="min-w-0 space-y-3">
                <div className="flex items-center gap-2 border-b border-sepia-200 pb-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-forest"
                    aria-hidden
                  />
                  <h3 className="min-w-0 truncate font-serif text-sm font-medium text-sepia-900">
                    {activeLabelA}
                  </h3>
                  <span className="ml-auto shrink-0 rounded-full border border-sepia-300 bg-sepia-50 px-2 py-0.5 text-xs font-medium tabular-nums text-sepia-700">
                    {loading ? "…" : result?.groupA.length ?? 0}권
                  </span>
                </div>
                <div className="space-y-3">
                  {loading
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <SkeletonCard key={`a-${i}`} />
                      ))
                    : result && result.groupA.length === 0 ? (
                        <div
                          style={{
                            padding: "2rem",
                            textAlign: "center",
                            color: "#9c8c78",
                            fontSize: "14px",
                            border: "0.5px dashed #ddd5c4",
                            borderRadius: "12px",
                          }}
                        >
                          지금은 이 관점에 맞는 책을 찾지 못했어요.
                        </div>
                      )
                    : result?.groupA.map((item, i) => (
                        <BookCard
                          key={`${item.title}-${item.author}-${i}`}
                          title={item.title}
                          author={item.author}
                          year={item.year}
                          reason={item.reason}
                          cover_url={item.cover_url}
                          isbn={(item as any).isbn}
                          stance="A"
                          label={activeLabelA}
                          topic={topic}
                        />
                      ))}
                </div>
              </section>

              <section className="min-w-0 space-y-3">
                <div className="flex items-center gap-2 border-b border-sepia-200 pb-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-rust"
                    aria-hidden
                  />
                  <h3 className="min-w-0 truncate font-serif text-sm font-medium text-sepia-900">
                    {activeLabelB}
                  </h3>
                  <span className="ml-auto shrink-0 rounded-full border border-sepia-300 bg-sepia-50 px-2 py-0.5 text-xs font-medium tabular-nums text-sepia-700">
                    {loading ? "…" : result?.groupB.length ?? 0}권
                  </span>
                </div>
                <div className="space-y-3">
                  {loading
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <SkeletonCard key={`b-${i}`} />
                      ))
                    : result && result.groupB.length === 0 ? (
                        <div
                          style={{
                            padding: "2rem",
                            textAlign: "center",
                            color: "#9c8c78",
                            fontSize: "14px",
                            border: "0.5px dashed #ddd5c4",
                            borderRadius: "12px",
                          }}
                        >
                          지금은 이 관점에 맞는 책을 찾지 못했어요.
                        </div>
                      )
                    : result?.groupB.map((item, i) => (
                        <BookCard
                          key={`${item.title}-${item.author}-${i}`}
                          title={item.title}
                          author={item.author}
                          year={item.year}
                          reason={item.reason}
                          cover_url={item.cover_url}
                          isbn={(item as any).isbn}
                          stance="B"
                          label={activeLabelB}
                          topic={topic}
                        />
                      ))}
                </div>
              </section>
            </div>
          </main>

          {/* STATE 3: Shelf drawer */}
          <div
            className={
              "absolute inset-y-0 right-0 z-30 w-[420px] max-w-full transition-opacity " +
              (shelfOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")
            }
            aria-hidden={!shelfOpen}
          >
            <div
              className="absolute inset-y-0 left-[-100vw] right-[420px] bg-black/10"
              onClick={() => setShelfOpen(false)}
            />

            <div
              className={
                "absolute right-0 top-0 flex h-full w-[420px] max-w-full flex-col border-l border-sepia-300 bg-sepia-50 shadow-xl transition-transform duration-300 " +
                (shelfOpen ? "translate-x-0" : "translate-x-full")
              }
            >
              <div className="flex items-center justify-between gap-3 border-b border-sepia-300 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setShelfOpen(false)}
                  className="cursor-pointer text-sm font-medium text-sepia-600 hover:opacity-70"
                >
                  ← 결과로 돌아가기
                </button>
                <div className="font-serif text-lg font-medium text-sepia-900">
                  내 서재
                </div>
                <span className="w-28" aria-hidden />
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyAll()}
                    disabled={shelf.length === 0}
                    className="rounded-lg border border-sepia-300 bg-sepia-50 px-3 py-2 text-sm font-medium text-sepia-800 transition-colors hover:bg-sepia-100 disabled:cursor-default disabled:opacity-60"
                  >
                    전체 복사
                  </button>
                  {copySuccess && (
                    <p className="text-xs text-forest mt-1">✓ 복사되었습니다.</p>
                  )}
                  <button
                    type="button"
                    onClick={handleClearAll}
                    disabled={shelf.length === 0}
                    className="rounded-lg border border-rust/40 bg-rust-bg px-3 py-2 text-sm font-medium text-rust transition-colors hover:bg-rust-bg/80 disabled:cursor-default disabled:opacity-60"
                  >
                    전체 삭제
                  </button>
                </div>

                {shelf.length === 0 ? (
                  <div className="flex flex-col items-center text-center">
                    <EmptyShelfIllustration />
                    <p className="mt-4 font-serif text-lg text-sepia-800">
                      아직 저장된 책이 없어요.
                    </p>
                    <p className="mt-3 text-sepia-600">
                      큐레이션하고 마음에 드는 책을 담아보세요.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {order.map((t) => (
                      <section key={t}>
                        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-sepia-500">
                          {t}
                        </h2>
                        <div className="space-y-4">
                          {map.get(t)!.map((item) => (
                            <BookCard
                              key={item.id}
                              variant="compact"
                              title={item.title}
                              author={item.author}
                              year={item.year}
                              reason={item.reason}
                              stance={item.stance}
                              label={item.label}
                              topic={item.topic}
                          cover_url={item.cover_url}
                              savedAt={item.savedAt}
                              onRemove={() => removeFromShelf(item.id)}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
