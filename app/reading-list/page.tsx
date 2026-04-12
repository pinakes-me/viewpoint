"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { BookCard } from "@/components/BookCard";
import { Navbar } from "@/components/Navbar";
import { useShelf } from "@/hooks/useShelf";
import type { ShelfItem } from "@/lib/types";

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

export default function ReadingListPage() {
  const router = useRouter();
  const { shelf, clearShelf, removeFromShelf } = useShelf();

  const { order, map } = useMemo(() => groupByTopic(shelf), [shelf]);

  async function handleCopyAll() {
    const text = shelf
      .map((i) => `${i.title} · ${i.author} (${i.year})`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("복사할 내용:", text);
    }
  }

  function handleClearAll() {
    if (!window.confirm("정말 모두 삭제할까요?")) {
      return;
    }
    clearShelf();
  }

  return (
    <>
      <Navbar
        hasResult
        shelfOpen
        shelfCount={shelf.length}
        onLogoClick={() => router.push("/")}
        onShelfClick={() => {}}
      />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="font-serif text-3xl font-medium text-sepia-900">
          내 서재
        </h1>
        {shelf.length > 0 ? (
          <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
            <button
              type="button"
              onClick={() => void handleCopyAll()}
              className="rounded-lg border border-sepia-300 bg-sepia-50 px-3 py-2 text-sm font-medium text-sepia-800 transition-colors hover:bg-sepia-100"
            >
              전체 복사
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="rounded-lg border border-rust/40 bg-rust-bg px-3 py-2 text-sm font-medium text-rust transition-colors hover:bg-rust-bg/80"
            >
              전체 삭제
            </button>
          </div>
        ) : null}
      </div>

      {shelf.length === 0 ? (
        <div className="mx-auto mt-16 flex max-w-md flex-col items-center text-center sm:mt-24">
          <EmptyShelfIllustration />
          <p className="mt-8 font-serif text-lg text-sepia-800">
            아직 저장된 책이 없어요.
          </p>
          <p className="mt-3 text-sepia-600">
            큐레이션하고 마음에 드는 책을 담아보세요.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-forest px-6 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-forest/90"
          >
            큐레이션 시작하기 →
          </Link>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {order.map((topic) => (
            <section key={topic}>
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-sepia-500">
                {topic}
              </h2>
              <ul className="space-y-4">
                {map.get(topic)!.map((item) => (
                  <li key={item.id}>
                    <BookCard
                      variant="compact"
                      title={item.title}
                      author={item.author}
                      year={item.year}
                      reason={item.reason}
                      cover_url={item.cover_url}
                      stance={item.stance}
                      label={item.label}
                      topic={item.topic}
                      savedAt={item.savedAt}
                      onRemove={() => removeFromShelf(item.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
    </>
  );
}
