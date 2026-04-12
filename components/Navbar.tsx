"use client";

export interface NavbarProps {
  hasResult?: boolean;
  shelfOpen?: boolean;
  shelfCount: number;
  onLogoClick: () => void;
  onShelfClick: () => void;
}

export function Navbar({
  hasResult = false,
  shelfOpen = false,
  shelfCount,
  onLogoClick,
  onShelfClick,
}: NavbarProps) {
  if (!hasResult) return null;

  return (
    <nav className="h-12 shrink-0 border-b border-sepia-300 bg-sepia-100">
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        {shelfOpen ? (
          <>
            <button
              type="button"
              onClick={onLogoClick}
              className="cursor-pointer font-serif text-lg font-medium text-sepia-900 transition-opacity hover:opacity-70"
            >
              ← 결과로 돌아가기
            </button>
            <div className="font-serif text-lg font-medium text-sepia-900">
              내 서재
            </div>
            <span className="w-24" aria-hidden />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onLogoClick}
              className="cursor-pointer font-serif text-lg font-medium text-sepia-900 transition-opacity hover:opacity-70"
            >
              ViewPoint
            </button>
            <button
              type="button"
              onClick={onShelfClick}
              className="inline-flex items-center gap-2 text-sm font-medium text-sepia-700 transition-colors hover:text-sepia-900"
            >
              <span className="hover:underline">내 서재</span>
              <span className="rounded-full bg-sepia-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-sepia-800">
                {shelfCount}권
              </span>
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
