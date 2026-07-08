import type { PerspectiveMode } from "./types";

// Labs(app/analyze)의 6축 정의를 curate/Labs 공통 단일 소스로 승격.
// curate 전용이었던 tech-social·desc-crit 축과 custom(직접 입력) 관점은 모두
// 폐기(2026-07-09 결정, CLAUDE.md 참고). 이제 curate·Labs 모두 이 6축만 사용.
export const PERSPECTIVE_AXES = [
  {
    id: "indiv-struct",
    labelA: "개인",
    labelB: "구조",
    description: { A: "개인 노력·선택·심리 중심", B: "사회·제도·시스템 중심" },
  },
  {
    id: "neutral-critical",
    labelA: "중립적 분석",
    labelB: "비판적 성찰",
    description: {
      A: "사실 전달·현상 정리 중심",
      B: "기존 구조에 문제 제기·비판",
    },
  },
  {
    id: "now-future",
    labelA: "현재 진단",
    labelB: "미래 전망",
    description: { A: "현 상황 분석·진단", B: "미래 가능성·시나리오" },
  },
  {
    id: "cause-solution",
    labelA: "원인 분석",
    labelB: "방안 제시",
    description: { A: "문제의 원인·배경 분석 중심", B: "해결책·대안 제시 중심" },
  },
  {
    id: "acad-pop",
    labelA: "학술·전문",
    labelB: "대중·실용",
    description: { A: "이론·연구 중심", B: "경험·실천 중심" },
  },
  {
    id: "narrative-explain",
    labelA: "서사 중심",
    labelB: "설명 중심",
    description: { A: "이야기·사례 중심 서술", B: "논리·개념 중심 서술" },
  },
] as const;

export type PerspectiveAxisId = (typeof PERSPECTIVE_AXES)[number]["id"];

// public/data/analyze_scores.csv 컬럼명(prefix_a, prefix_b) 매핑 — 기존 lib/analyzeAxes.ts의
// AXIS_CSV_PREFIX와 동일. STEP 4에서 curate 판단 로직이 이 CSV를 조회할 때도 재사용.
export const AXIS_CSV_PREFIX: Record<PerspectiveAxisId, string> = {
  "indiv-struct": "indiv",
  "neutral-critical": "neutral",
  "now-future": "now",
  "cause-solution": "cause",
  "acad-pop": "acad",
  "narrative-explain": "narrative",
};

// custom(직접 입력)은 폐기(2026-07-09 결정) — 6축 외 자유 입력 관점은 더 이상 지원하지 않는다.
export const PERSPECTIVES: PerspectiveMode[] = PERSPECTIVE_AXES.map(
  ({ id, labelA, labelB }): PerspectiveMode => ({ id, labelA, labelB })
);
