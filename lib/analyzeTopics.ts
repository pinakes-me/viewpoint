export const ANALYZE_TOPICS = [
  {
    id: "ai-tech",
    label: "AI·기술·미래",
    keywords: ["인공지능", "AI", "미래기술", "미래사회", "기술과인간"],
  },
  {
    id: "environment",
    label: "환경·생태",
    keywords: ["기후", "환경", "생태", "자연과공존", "생물다양성"],
  },
  {
    id: "inequality",
    label: "불평등·사회구조",
    keywords: ["불평등", "빈곤", "자본주의", "신자유주의", "노동"],
  },
  {
    id: "psychology",
    label: "심리·정서·실존",
    keywords: ["심리", "불안", "고독", "고립", "자기성찰", "삶의의미", "행복"],
  },
  {
    id: "relation",
    label: "관계·공동체",
    keywords: ["관계", "가족", "공동체", "세대", "대화"],
  },
  {
    id: "science",
    label: "자연과학·생명",
    keywords: ["생명과학", "자연과학", "뇌과학", "진화", "생물"],
  },
  {
    id: "politics",
    label: "정치·외교",
    keywords: ["국제", "외교", "패권", "극우", "미중"],
  },
  {
    id: "gender",
    label: "여성·젠더",
    keywords: ["여성", "젠더", "페미니즘", "가부장제", "성평등"],
  },
  {
    id: "history",
    label: "역사·사회",
    keywords: ["역사", "4·3", "근현대사", "민족", "역사속일상"],
  },
  {
    id: "culture",
    label: "문화·예술·음식",
    keywords: ["예술", "음식", "미술", "식문화", "사진"],
  },
] as const;

// 장르 필터 키워드 개정 2026-07-20: ① '판타지' 부분 문자열 거짓 적중(#남성판타지,
// 유형②) 교정 → '판타지소설'로 조이기 ② 에세이는 비문학으로 확정 — 문학 필터의
// 조작적 정의는 '관점 축이 무의미한 서사 픽션'(소설·그림책·어린이문학)이며 KDC
// 문학류 개념과 의도적으로 다름 (Hailey 판정).
// 이 배열은 Labs의 장르 필터(isFiction)와 채점 API의 P1 코드 강제(enforceFictionZero)가
// 공유하는 단일 출처다 — 두 정의가 각자 진화하며 생긴 불일치의 재발 방지.
export const FICTION_KEYWORDS = [
  "소설",
  "어린이문학",
  "SF소설",
  "판타지소설",
  "그림책",
] as const;

export type AnalyzeTopicId = (typeof ANALYZE_TOPICS)[number]["id"];
