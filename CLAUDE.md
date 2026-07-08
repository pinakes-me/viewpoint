# ViewPoint 프로젝트 — Claude Code 작업 지침

## 프로젝트 개요
**ViewPoint** — 관점 기반 북큐레이션 웹앱(`/curate`) + 연구 도구 **ViewPoint Labs**(`/analyze`)
- Next.js 14 (App Router) + TypeScript + Tailwind + Supabase(PostgreSQL) + GPT-4o-mini
- 배포: https://viewpoint-curation.vercel.app
- 이중 목적: (1) 실사용 큐레이션 서비스, (2) 문헌정보학+DH 학위논문의 연구 도구
- 개발자 Hailey는 예비사서(2026년 9월 자격증 취득 예정), 비개발자. Cursor 바이브코딩에서
  Claude Code로 전환.

## ⚠️ 절대 규칙 (매 세션 최우선 확인)

1. **`data/analyze_scores_v3_20260705.csv`, `data/book_clusters_v3_20260705.csv`는
   절대 덮어쓰지 않는다.** 학위논문 고정 데이터.
2. **Supabase 쓰기 작업은 반드시 프리뷰(dry-run) 모드를 기본값으로 하고,
   `--apply` 같은 명시적 플래그가 있어야 실제 UPDATE가 실행되게 만든다.**
   쓰기 직전에는 대상 데이터를 CSV로 백업한다.
3. **파일 변경 범위는 항상 명시적으로 한정한다.** "이 파일들만 고친다"고
   먼저 밝히고, 그 외 파일은 건드리지 않는다.
4. **작업은 작은 STEP 단위로 쪼개서 계획한다. STEP 하나가 안정적으로
   끝날 때마다 바로 커밋한다 — 다음 STEP으로 넘어가기 전에 반드시.**
   여러 STEP을 커밋 없이 몰아서 진행하지 않는다. (2026-07-08 저녁, 축
   통합+UI 작업을 커밋 없이 이어가다 꼬여서 전체 롤백한 전례 있음 — 그때
   이미 검증까지 끝났던 `clusterId` 검색 기능까지 함께 유실되는 대가를
   치렀음. 같은 실수를 반복하지 말 것. → 이 교훈대로 2026-07-09 재작업은
   STEP마다 커밋해서 완주함, 아래 이력 참고.)
5. CSV를 다룰 때는 RFC 4180 표준(따옴표 필드 내 줄바꿈 허용)을 준수하는
   파서를 쓴다. 줄 단위 split은 이전에 실제 버그를 냈었다. (→ `lib/csv.ts`로
   공용화 완료, 새로 CSV 다룰 일 있으면 이거 재사용할 것.)
6. 계획에 없던 애매한 설계 결정이나 파괴적/비가역적 작업(삭제, force push,
   Supabase apply 등)이 새로 필요해지면 그 시점에는 멈추고 Hailey에게
   확인을 받는다.

## 🎯 최종 확정 아키텍처 (2026-07-09 구현 완료 — 재논의 불필요)

**문제였던 것**: 같은 책("슬픈 살인")이 `/curate`와 `/analyze`에서 다른 관점으로
분류됨. 원인은 두 화면이 서로 다른 시점에 서로 다른 GPT 호출로 판단했기 때문.

**해결 원칙 — "검색은 이원화, 판단은 단일화"** (구현 완료)

1. **검색은 두 경로**: 자유텍스트 입력(기존 topicVariants/ilike 경로) +
   시소러스 칩(`clusterId` → `book_clusters.csv` 정확 매칭). 관점 탭을
   바꿔도 마지막에 쓴 경로(클러스터 vs 자유텍스트)가 유지됨
   (`app/page.tsx`의 `activeClusterId` state).
2. **판단은 단일 소스**: `/curate`가 통합 6축 요청을 받으면 즉석 GPT
   이항분류 대신 `public/data/analyze_scores.csv`의 membership degree를
   조회해 마진 0.2 규칙으로 분류를 확정한다(`app/api/curate/route.ts`의
   `classifyByMembership`). GPT는 이미 확정된 배정의 reason 문장 생성에만
   관여(`explainAssignmentPrompt`/`generateReasons`, 근거로 태그·서평·책소개
   포함). curate와 Labs가 같은 CSV 행을 보므로 불일치가 구조적으로 발생 불가.
3. **북카드 "관점 스펙트럼 확인" 버튼**: 새 API 호출 없이, curate 응답에
   이미 포함된 6축 membership 값(`scores` 필드)을 그대로 시각화
   (`components/BookCard.tsx`).
4. **관점 축은 Labs 6축으로 완전 통일**: `lib/perspectiveAxes.ts`가 단일
   소스. curate 전용이던 `tech-social`(기술 해결론/사회 해결론),
   `desc-crit`(설명적/비판적)와 **custom(직접 입력) 전부 폐기**(2026-07-09
   결정 — 처음엔 custom만 유지하는 방향이었다가 Hailey 요청으로 완전
   폐기로 변경됨). custom이 사라지면서 "추천 관점"(자유 텍스트 GPT 제안)
   기능도 구조적으로 성립 불가능해져 함께 삭제(`/api/suggest-perspectives`
   포함) — 토큰 낭비 우려로 어차피 불필요하다고 판단했던 기능이라 결과적으로
   정리가 자연스러웠음.
5. **알려진 트레이드오프 (수용됨)**: v4 배치에 없는 신규 도서는
   `getMembershipScore`가 null 반환 → 해당 책은 두 그룹 어디에도 배정되지
   않고 조용히 스킵됨(에러 아님). 재배치 전까지는 검색은 되지만 분류가 안
   뜨는 상태. 노션 파이프라인 자동화는 별도 작업, 이번 스코프 밖.

## 지금까지의 작업 이력 (요약)

- 시소러스(`lib/thesaurus.ts`): 12개 클러스터 + META_GENRE, 3라운드 개정 거쳐 확정.
- 관점 축 채점 파이프라인: `/api/analyze-score`(GPT-4o-mini, temperature 0)가
  책마다 6축 membership degree(a, b 각 0~1, 독립값)를 반환. `scripts/analyze-batch.mjs`가
  해시 캐싱(title+topics)으로 293권 전체를 증분 배치 채점 → `data/analyze_scores.csv`.
- 태그 표본 감사(2026-07-07) + 원천 태그 정규화(층위 B, 2026-07-08 완료):
  Supabase books.topics 갱신 완료, GitHub 최초 커밋(`3ca07c4`).
- v4 재채점 완료: `data/analyze_scores_v4_20260708.csv` / `data/book_clusters_v4_20260708.csv`.
  `public/data/`에도 동기화되어 있어 Labs와 curate가 같은 파일을 참조.
- **2026-07-08 저녁, 관점 축 통합 + UI 실험을 커밋 없이 진행하다 꼬여서
  `3ca07c4`로 전체 롤백함.** 그 시행착오는 `git stash`(`stash@{0}`, 메시지
  "rollback-2026-07-08: 관점축 통합 작업 + UI 변경분 백업")에 참고용으로만
  보존. 아래 2026-07-09 작업은 그 스택을 재적용한 게 아니라 처음부터 STEP
  단위로 다시 구현한 것.
- **2026-07-09, 위 "최종 확정 아키텍처" 전체 구현 완료 (STEP 1~5, 매 STEP마다 커밋)**:
  - STEP 1 코드 정찰 (커밋 없음, 보고만)
  - STEP 2 `clusterId` 시소러스 검색 경로 신규 구현 — `lib/csv.ts`, `lib/bookClusters.ts`,
    `lib/supabase.ts`의 `searchBooksByIds` (`a997678`)
  - STEP 3 `lib/perspectiveAxes.ts` 신설, 6축 단일화 + custom 폐기 결정 (`5e35f1f`)
  - STEP 4 curate 판단 로직을 membership CSV 조회로 전환, `lib/analyzeScores.ts` 신설 (`5741baf`)
  - STEP 5a curate 응답에 6축 scores 포함 (`63f2077`)
  - STEP 5 (5b~5f) UI 전환: `app/page.tsx` 통합 6축+시소러스 칩+clusterId 유지,
    `components/BookCard.tsx` 스펙트럼 버튼, Navbar/히어로 Labs 링크,
    `/api/suggest-perspectives` 삭제 (`6ab4f4a`)
  - "슬픈 살인"(book_id 5) 케이스로 실제 검증: curate·Labs 동일한 membership 값,
    같은 관점("개인")으로 일치 확인.

## 알려진 이슈

- ~~`/curate`의 custom(직접 입력) 관점 라벨 표시 버그~~ → custom 자체가 폐기되어
  자동 해소됨 (2026-07-09).
- `app/api/curate/route.ts`에 옛 축 ID(`tech-social`/`desc-crit`/`custom`) 요청을 위한
  즉석 GPT 분류 폴백 경로(`classifyFromCatalogPrompt`, `callOpenAI`, `FALLBACK_PROMPT`)가
  죽은 코드로 남아있음 — 새 UI는 이 axis id들을 더 이상 보내지 않음. 당장 문제는
  없으나 다음에 정리 대상 (Hailey 확인 후 삭제).
- `lib/perspectives.ts`(구 5축+custom)도 이제 아무 데서도 import되지 않음 — 삭제 후보.
- `hooks/useShelf.ts`/`ShelfItem`에는 `scores`가 없어서 "내 서재"에 저장된 책은
  스펙트럼 버튼이 안 뜸(의도된 축소 스코프). 필요해지면 추가.
- `app/analyze/page.tsx`(Labs)는 이번 리팩토링에서 의도적으로 건드리지 않음 —
  여전히 `lib/analyzeAxes.ts`(`ANALYZE_AXES`)를 직접 참조 중. `lib/perspectiveAxes.ts`와
  값은 동일하지만 파일은 아직 분리되어 있음 (완전 통합하려면 Labs도 마이그레이션
  필요 — 지금은 범위 밖으로 남겨둠, 필요시 별도 STEP으로).

## 작업 방식 선호

- STEP 단위로 계획을 세우고, 계획이 확정되면 이어서 진행하되 **STEP마다 커밋**.
- 파일 변경 범위를 항상 먼저 명시.
- 애매한 설계 결정은 임의로 정하지 말고 옵션과 추천안을 제시해 확인받은 뒤 진행.
- 큰 구조 변경 전에는 관련 파일을 전부 읽고 현재 상태를 보고한 뒤 계획을 세운다.
- UI/프론트 변경은 프리뷰 서버로 브라우저에서 직접 클릭해 검증한 뒤 완료 보고할 것
  (2026-07-09에 이 방식으로 진행해 효과적이었음 — 스크린샷 + 실제 클릭 이벤트로
  clusterId 유지, 스펙트럼 토글 등을 검증).
- 응답은 한국어, 프로처럼 정확하되 다정한 톤 유지.
