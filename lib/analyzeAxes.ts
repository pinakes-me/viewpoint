export const ANALYZE_AXES = [
  { id: "indiv-struct", labelA: "개인", labelB: "구조" },
  { id: "neutral-critical", labelA: "중립적 분석", labelB: "비판적 성찰" },
  { id: "now-future", labelA: "현재 진단", labelB: "미래 전망" },
  { id: "cause-solution", labelA: "원인 분석", labelB: "방안 제시" },
  { id: "acad-pop", labelA: "학술·전문", labelB: "대중·실용" },
  { id: "narrative-explain", labelA: "서사 중심", labelB: "설명 중심" },
] as const;

export type AnalyzeAxisId = (typeof ANALYZE_AXES)[number]["id"];
