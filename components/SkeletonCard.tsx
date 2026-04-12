export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-sepia-300 bg-sepia-50 p-3">
      <div className="flex gap-2">
        <div className="flex shrink-0 flex-col gap-1.5">
          <div className="h-4 w-14 animate-pulse rounded-full bg-sepia-200" />
          <div className="h-10 w-[28px] animate-pulse rounded-md bg-sepia-200" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
          <div className="h-3 max-w-[min(100%,14rem)] animate-pulse rounded bg-sepia-200" />
          <div className="h-2.5 w-24 animate-pulse rounded bg-sepia-200" />
          <div className="h-2.5 w-full animate-pulse rounded bg-sepia-200" />
          <div className="h-2.5 w-[92%] animate-pulse rounded bg-sepia-200" />
        </div>
      </div>
    </div>
  );
}
