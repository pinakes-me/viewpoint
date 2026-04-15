export interface ShelfItem {
  id: string;
  title: string;
  author: string;
  year: number;
  reason: string;
  cover_url: string;
  topic: string;
  label: string;
  stance: "A" | "B";
  savedAt: string;
}

export interface BookItem {
  title: string;
  author: string;
  year: number;
  reason: string;
  cover_url?: string | null;
}

export interface CurationResult {
  summary: string;
  groupA: BookItem[];
  groupB: BookItem[];
}

export interface PerspectiveMode {
  id: string;
  labelA: string;
  labelB: string;
}

export interface BookResult {
  id: number;
  title: string;
  author: string;
  category: string;
  isbn: string;
  cover_url: string;
  recommendation: string;
  period: string;
  topics: string;
  author_full?: string;
  translator?: string;
  description?: string;
}
