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

export const FICTION_KEYWORDS = [
  "소설",
  "어린이문학",
  "SF소설",
  "판타지",
  "그림책",
  "에세이",
] as const;

export type AnalyzeTopicId = (typeof ANALYZE_TOPICS)[number]["id"];
