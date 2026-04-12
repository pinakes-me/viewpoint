"use client";

import { useShelf } from "@/hooks/useShelf";

export type BookCardProps = {
  title: string;
  author: string;
  year: number;
  reason: string;
  isbn?: string;
  cover_url?: string | null;
  stance: "A" | "B";
  label: string;
  topic: string;
  variant?: "default" | "compact";
  savedAt?: string;
  onRemove?: () => void;
};

function formatSavedAt(iso: string) {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function BookCard({
  title,
  author,
  year,
  reason,
  isbn,
  cover_url,
  stance,
  label,
  topic,
  variant = "default",
  savedAt,
  onRemove,
}: BookCardProps) {
  const { addToShelf, isInShelf } = useShelf();
  const saved = isInShelf(title, author);
  const compact = variant === "compact";

  const isA = stance === "A";
  const pillClass = isA
    ? "border-forest/25 bg-forest-bg text-forest"
    : "border-rust/25 bg-rust-bg text-rust";
  const coverClass = isA
    ? "bg-forest-mid/35 ring-1 ring-forest-mid/25"
    : "bg-rust-mid/35 ring-1 ring-rust-mid/25";

  const handleSave = () => {
    if (compact) return;
    if (saved) return;
    addToShelf({
      title,
      author,
      year,
      reason,
      topic,
      label,
      stance,
      cover_url: cover_url || "",
    });
  };

  const booksUrl = isbn
    ? `https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Book&query=${encodeURIComponent(isbn)}&KeyWord=${encodeURIComponent(isbn)}`
    : `https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Book&query=${encodeURIComponent(title)}`;

  return (
    <article className="rounded-xl border border-sepia-300 bg-sepia-50 p-3">
      <div className="flex gap-2">
        <div className="flex shrink-0 flex-col items-start gap-1.5">
          <span
            className={`inline-flex max-w-[9rem] rounded-full border px-1.5 py-px text-[11px] font-medium leading-tight ${pillClass}`}
          >
            {label}
          </span>
          {cover_url && cover_url.startsWith("http") ? (
            <div
              style={{
                width: "56px",
                height: "80px",
                flexShrink: 0,
                position: "relative",
              }}
            >
              <img
                src={cover_url}
                alt={title}
                width={56}
                height={80}
                style={{
                  borderRadius: "4px",
                  objectFit: "cover",
                  width: "56px",
                  height: "80px",
                }}
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  const placeholder =
                    e.currentTarget.nextElementSibling as HTMLElement;
                  if (placeholder) placeholder.style.display = "block";
                }}
              />
              <div
                style={{
                  display: "none",
                  width: "56px",
                  height: "80px",
                  borderRadius: "4px",
                  background: stance === "A" ? "#C0DD97" : "#F7C1C1",
                }}
              />
            </div>
          ) : (
            <div
              style={{
                width: "56px",
                height: "80px",
                borderRadius: "4px",
                flexShrink: 0,
                background: stance === "A" ? "#C0DD97" : "#F7C1C1",
              }}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[14px] font-semibold leading-snug text-sepia-900">
            {title}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="text-[12px] text-sepia-500">{author}</span>
            <span className="inline-flex rounded border border-sepia-300 bg-sepia-100 px-1 py-px text-[12px] font-medium tabular-nums text-sepia-700">
              {year}
            </span>
          </p>
          <p className="mt-2 text-[12px] leading-[1.6] text-sepia-600">{reason}</p>

          {compact ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-sepia-200/80 pt-2">
              {savedAt ? (
                <time
                  className="text-[11px] text-sepia-500"
                  dateTime={savedAt}
                >
                  저장 {formatSavedAt(savedAt)}
                </time>
              ) : (
                <span />
              )}
              {onRemove ? (
                <button
                  type="button"
                  onClick={onRemove}
                  className="rounded-md border border-rust/30 bg-rust-bg px-2 py-1 text-[12px] font-medium text-rust transition-colors hover:bg-rust-bg/80"
                >
                  삭제
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saved}
                className="rounded-md border border-sepia-300 bg-sepia-100 px-2 py-1 text-[12px] font-medium text-sepia-800 transition-colors hover:bg-sepia-200 disabled:cursor-default disabled:opacity-80"
              >
                {saved ? "✓ 저장됨" : "내 서재에 저장"}
              </button>
              <a
                href={booksUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-medium text-forest underline-offset-2 transition-colors hover:text-forest-mid hover:underline"
              >
                알라딘에서 보기 →
              </a>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
