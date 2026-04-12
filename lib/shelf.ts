import type { ShelfItem } from "./types";

export const SHELF_KEY = "viewpoint_shelf";

export function getShelf(): ShelfItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SHELF_KEY) || "[]"
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ShelfItem[];
  } catch {
    return [];
  }
}

export function addToShelf(item: Omit<ShelfItem, "id" | "savedAt">): void {
  if (typeof window === "undefined") return;
  const shelf = getShelf();
  shelf.push({
    ...item,
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
  });
  localStorage.setItem(SHELF_KEY, JSON.stringify(shelf));
}

export function removeFromShelf(id: string): void {
  if (typeof window === "undefined") return;
  const shelf = getShelf().filter((i) => i.id !== id);
  localStorage.setItem(SHELF_KEY, JSON.stringify(shelf));
}

export function isInShelf(title: string, author: string): boolean {
  if (typeof window === "undefined") return false;
  return getShelf().some((i) => i.title === title && i.author === author);
}

export function clearShelf(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SHELF_KEY);
}
