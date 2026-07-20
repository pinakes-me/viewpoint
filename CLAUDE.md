# ViewPoint 프로젝트 — Claude Code 작업 지침

## 프로젝트 개요
**ViewPoint** — 관점 기반 북큐레이션 웹앱(`/curate`) + 연구 도구 **ViewPoint Labs**(`/analyze`)
- Next.js 14 (App Router) + TypeScript + Tailwind + Supabase(PostgreSQL) + GPT-4o-mini
- 배포: https://viewpoint-curation.vercel.app
- 이중 목적: (1) 실사용 큐레이션 서비스, (2) 문헌정보학+DH 학위논문의 연구 도구
- 개발자 Hailey는 예비사서(2026년 9월 자격증 취득 예정), 비개발자. Cursor 바이브코딩에서
  Claude Code로 전환.

## ⚠️ 절대 규칙 (매 세션 최우선 확인)

1. **버전 스냅샷 파일(`data/analyze_scores_v3_20260705.csv`,
   `data/book_clusters_v3_20260705.csv`, `data/analyze_scores_v4_20260708.csv`,
   `data/book_clusters_v4_20260708.csv`, `data/analyze_scores_v5_20260720.csv`)은
   절대 덮어쓰지 않는다.** v3는 학위논문 고정 데이터, 이후 버전은 재현용 동결본.
   (스냅샷↔프롬프트 버전 대응표는 아래 별도 섹션 참고.)
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
   마진 비교는 IEEE754 부동소수점 오차를 흡수하는 epsilon(`MARGIN_EPSILON`)을
   두고 있고, 각 그룹은 최대 6권까지 노출하며, 마진 미달로 어느 쪽에도
   배정되지 못한 책은 diff 절댓값이 작은 순으로 상위 4권을 `middleGround`
   필드로 별도 반환한다(2026-07-08 STEP B~D, 아래 이력 참고).
3. **북카드 "관점 스펙트럼 확인" 버튼**: 새 API 호출 없이, curate 응답에
   이미 포함된 6축 membership 값(`scores` 필드)을 그대로 시각화
   (`components/BookCard.tsx`). `stance`는 `"A"|"B"|"neutral"`을 지원하며
   `middleGround` 카드는 neutral(세피아 톤)로 표시된다(STEP E).
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
  ~~`public/data/`에도 동기화되어 있어~~ → 실제로는 `public/data/analyze_scores.csv`가
  v3 사본인 채로 방치돼 있었음(2026-07-08 STEP A에서 발견, STEP B-2에서 수정 —
  아래 이력 참고). `book_clusters.csv`는 처음부터 정상 동기화 상태였음.
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
- **2026-07-08, 테스트 중 발견된 버그 진단 + 수정 (STEP A~F, 매 STEP/조각마다 커밋)**:
  - STEP A 진단만(커밋 없음): (1) `public/data/analyze_scores.csv`가 v4가 아니라
    v3 사본으로 방치된 사실 발견 — "근접한 세계"(book_id 100) narrative_b 값이
    배포본 0.7 vs v4 파일 0.5로 불일치했던 게 그 증상. (2) 심리 클러스터 마진
    0.2 분류 재계산 중 `diff = a - b` 부동소수점 비교가 정확히 경계값(예:
    0.6-0.4)에서 실패하는 별도 버그를 추가로 발견(구조 그룹이 부당하게 0권으로
    나옴).
  - STEP B-1 `classifyByMembership`에 `MARGIN_EPSILON` 도입해 부동소수점 경계값
    버그 수정 (`7e38017`)
  - STEP B-2 `public/data/analyze_scores.csv`를 v4로 재동기화 +
    `scripts/analyze-batch.mjs`가 `data/`·`public/data` 양쪽에 동시 저장하도록
    수정, `npm run sync-public-data` 안전망 추가 (`ad22b63`)
  - STEP B-3 조사만(커밋 없음): 마진 미달 비율(클러스터당 평균 27.8%)과
    결과 카드 레이아웃이 캡 확장을 견딜 수 있는 구조인지 확인
  - STEP C 그룹당 캡 4→6, 마진 미달 도서를 diff 작은 순으로 최대 4권
    `middleGround` 필드로 반환 + 접이식 UI 섹션 추가 (`28a3842`)
  - STEP D `middleGround` 카드에 기존 `BookCard` 컴포넌트 재사용(신규 컴포넌트
    없음) — 스펙트럼 뷰가 stance와 무관해 별도 처리 없이도 정상 동작 (`0a1051c`)
  - STEP E `BookCard`의 `stance`를 `"A"|"B"|"neutral"`로 확장해 `middleGround`
    알약 색상을 개인/구조와 구분되는 세피아 톤으로 분리 (`63fcbab`)
  - STEP F-1 히어로 문구를 실제 축 라벨(중립·비판)과 일치하도록 수정 (`e8dc12a`)
  - STEP F-2 주제 둘러보기 칩에서 META_GENRE(문학 장르) 제외 (`0d7b85b`)
  - STEP F-3 칩/자유텍스트 입력은 선택만, 실행은 "큐레이션 시작" 버튼 클릭이
    트리거하도록 전환 (`f7470a6`)
  - STEP F-4 Labs 접근성 개선: `/analyze`에 "← ViewPoint로 돌아가기" 링크 추가,
    curate 양쪽의 Labs 링크 텍스트/스타일을 "ViewPoint Labs 🧪" 버튼으로 통일
    (`79ded38`)
  - STEP F-5 문서화만: 알려진 이슈에 membership 품질 이슈 + neutral stance
    캐스팅 이슈 기록 (`48d966b`)
  - 추가로 "중립적 분석↔비판적 성찰" 축 설명 문구에서 "·변화 촉구" 제거 (`1252315`)
- **M3 채점 프롬프트 실험 (2026-07-13)**: v4a의 P1 프롬프트 규칙(소설 축
  건너뛰기 지시)이 0/0 남발을 재정당화해 비문학까지 오염 → v4c/v4d(P1
  프롬프트 규칙 제거, 코드 강제만 유지)로 해소, **v4d 승격 결정**
  (동시대 v3 49.3% → 58.5%, 안정률 88.9%). 실험 데이터:
  `data/experiments/M3_*_20260713.csv` (15권×5후보×3회 = 1350행).
- **M4 v4d 승격 (2026-07-20)**: 기본 promptVersion을 v3 → **v4d**로 전환
  (API·배치 양쪽). analyze-batch에 버전 인지 캐싱 도입(해시 일치 + 행의
  prompt_version == 실행 버전일 때만 캐시). 293권 전량 v4d 재채점 후
  `data/analyze_scores_v5_20260720.csv`로 스냅샷 동결.
- **장르 필터 키워드 개정 + P1 서사픽션 확장 (2026-07-20)**: **문학 필터의
  조작적 정의를 "관점 축이 무의미한 서사 픽션"(소설·그림책·어린이문학)으로
  확정** — KDC 문학류 개념과 의도적으로 다름 (Hailey 판정). 이에 따라
  `lib/analyzeTopics.ts`의 `FICTION_KEYWORDS`에서 '판타지'→'판타지소설'
  조이기(#남성판타지 유형② 거짓 적중 교정), '에세이' 제거(book 51 비문학
  복귀). P1 코드 강제(`enforceFictionZero`)의 판정 조건을 '#소설' 단독에서
  `FICTION_KEYWORDS` 공유로 확장 — 현행 적용 태그: 소설(부분 문자열,
  SF소설·판타지소설·성장소설 등 포함)·어린이문학·그림책. 영향 도서
  15권(어린이문학·그림책류) 재채점, 문학 필터 50권 전권 ②③④⑤ 회색 확인.
  ※ 이 건은 시소러스 개정 계보(R1~R4)와 별개 — META_GENRE는 무변경.

## 스냅샷 ↔ 프롬프트 버전 대응표

⚠️ 스냅샷 버전(v3/v4/v5)과 채점 프롬프트 버전(v3/v4a~v4d)은 **별개 체계**.

| 스냅샷 파일 | 채점 프롬프트 | 비고 |
|---|---|---|
| `analyze_scores_v3_20260705.csv` | prompt v3 | 학위논문 고정 데이터 (동결) |
| `analyze_scores_v4_20260708.csv` | prompt v3 | + 원천 태그 정규화 반영 (동결) |
| `analyze_scores_v5_20260720.csv` | **prompt v4d** | v4d 전량 채점본, 현행 라이브와 동일 (동결) |

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
- membership degree 측정 품질(GPT가 명시적 신호에도 0.6 부근으로 보수적으로
  수렴하는 경향)은 UI로 해결할 수 없는 장기 과제. 지금은 손대지 않고 별도
  트랙으로 남겨둠 — 연구노트 3장 프롬프트 튜닝 로그, 8장 한계 참고.
  ~~reason 문장이 매번 달라져 일관성이 낮은 문제~~ → temperature 0 + 금지어
  맵(`REASON_BANNED_VOCAB`)으로 완화(골격 고정, 꼬리 절만 간헐 변동 — API
  수준 비결정성으로 잔존, 2026-07-13).
- generateReasons의 groupB 행동적 누락 편향: 특정 그룹 전체가 JSON에서
  누락되는 실패 모드가 3/3회 모두 groupB에서 관측됨. finish_reason=stop
  확인으로 토큰 잘림(length) 가설은 기각 — 기계적 원인 아닌 행동적 누락.
  재시도 로직(`generateReasonsWithRetry`)이 회수 중. 검증 아이디어: 그룹
  나열 순서 스왑 관측.
- "관점모순 잔존" 로그(`⚠️ 관점모순 잔존: {제목} (배정: {라벨})`)는 M2 채점
  오류 후보 수집기 — reason이 정직하게 반대 관점을 서술한다는 신호일 수
  있으므로 주기적으로 확인할 것.
- `REASON_BANNED_VOCAB`(app/api/curate/route.ts)은 위반이 실제 관측된
  neutral-critical 축만 등재된 확장 구조 — 다른 축에서 위반 관측 시 항목만
  추가하면 됨.
- ④원인↔방안 축은 채점 프롬프트에 정의 앵커가 없음(P2 학술↔대중, P3
  현재↔미래, P4 개인↔구조만 앵커 보유) — 다음 프롬프트 튜닝 후보.
- 표상 기인 채점 오류 잔존 사례: "공감사회를 위한 담론들"이 ⑤학술↔대중
  축에서 M3 실험 15회 전부 일관되게 오판됨 — 프롬프트가 아니라 태그·소개
  표상의 문제일 가능성이 높아 태그 감사 후보.
- 장르 정의 단일 출처화(정리 후보): 장르 신호 출처가 세 곳으로 분산돼
  있었음 — ① `lib/thesaurus.ts` META_GENRE(시소러스 칩·클러스터용)
  ② `lib/analyzeTopics.ts` FICTION_KEYWORDS(Labs 장르 필터)
  ③ `enforceFictionZero`(P1 코드 강제). 2026-07-20 개정으로 ②③은
  FICTION_KEYWORDS 공유로 통합됐으나 ①은 여전히 별도 — 세 정의가 각자
  진화하면 유형② 거짓 적중 같은 불일치가 재발하므로 공유 상수로 완전
  통합하는 것이 정리 후보.
- `components/BookCard.tsx`의 `stance`가 `"A"|"B"|"neutral"`로 확장됐지만
  (STEP E), `hooks/useShelf.ts`/`ShelfItem`은 아직 `"A"|"B"`만 지원. "내 서재에
  저장" 시 `stance === "neutral"`이면 임시로 `"A"`로 캐스팅됨 — middleGround
  책을 서재에 저장하면 실제로는 개인 그룹으로 표시된다는 뜻. 서재 자체에
  중립 상태를 도입하려면 별도 STEP 필요.

## 작업 방식 선호

- STEP 단위로 계획을 세우고, 계획이 확정되면 이어서 진행하되 **STEP마다 커밋**.
- 파일 변경 범위를 항상 먼저 명시.
- 애매한 설계 결정은 임의로 정하지 말고 옵션과 추천안을 제시해 확인받은 뒤 진행.
- 큰 구조 변경 전에는 관련 파일을 전부 읽고 현재 상태를 보고한 뒤 계획을 세운다.
- UI/프론트 변경은 프리뷰 서버로 브라우저에서 직접 클릭해 검증한 뒤 완료 보고할 것
  (2026-07-09에 이 방식으로 진행해 효과적이었음 — 스크린샷 + 실제 클릭 이벤트로
  clusterId 유지, 스펙트럼 토글 등을 검증).
- 응답은 한국어, 프로처럼 정확하되 다정한 톤 유지.
