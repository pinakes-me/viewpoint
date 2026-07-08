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
  // 통합 6축 membership 값 (axisId -> {a,b}). "관점 스펙트럼 확인" 버튼이 새 API
  // 호출 없이 이 값을 그대로 시각화한다. 옛 축 경로(폴백)에는 없을 수 있음.
  scores?: Record<string, { a: number; b: number }>;
}

export interface CurationResult {
  summary: string;
  groupA: BookItem[];
  groupB: BookItem[];
  // 마진 미달로 groupA/groupB 어디에도 배정되지 않은 "중간지대" 책 (diff 작은 순 최대 4권).
  // 옛 축 경로(폴백)에는 없을 수 있음.
  middleGround?: BookItem[];
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
