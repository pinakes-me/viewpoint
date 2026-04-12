import type { PerspectiveMode } from "./types";

export const PERSPECTIVES: PerspectiveMode[] = [
  { id: "indiv-struct", labelA: "개인 차원", labelB: "구조 차원" },
  { id: "tech-social", labelA: "기술 해결론", labelB: "사회 해결론" },
  { id: "desc-crit", labelA: "설명적 관점", labelB: "비판적 관점" },
  { id: "acad-pop", labelA: "학술·전문적", labelB: "대중·실용적" },
  { id: "now-future", labelA: "현재 진단", labelB: "미래 전망" },
  { id: "custom", labelA: "직접 입력 A", labelB: "직접 입력 B" },
];

export const PRESET_TOPICS = [
  "인공지능",
  "기후변화",
  "자본주의",
  "소셜미디어",
  "1인가구",
  "재택근무",
];
