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
   치렀음. 같은 실수를 반복하지 말 것.)
5. CSV를 다룰 때는 RFC 4180 표준(따옴표 필드 내 줄바꿈 허용)을 준수하는
   파서를 쓴다. 줄 단위 split은 이전에 실제 버그를 냈었다.
6. 계획에 없던 애매한 설계 결정이나 파괴적/비가역적 작업(삭제, force push,
   Supabase apply 등)이 새로 필요해지면 그 시점에는 멈추고 Hailey에게
   확인을 받는다.

## 지금까지의 작업 이력 (요약)

- 시소러스(`lib/thesaurus.ts`): 12개 클러스터 + META_GENRE, 3라운드 개정 거쳐 확정.
  대표태그/유의어/관련어/제외어 구조.
- 관점 축 채점 파이프라인: `/api/analyze-score`(GPT-4o-mini, temperature 0)가
  책마다 6축 membership degree(a, b 각 0~1, 독립값)를 반환. `scripts/analyze-batch.mjs`가
  해시 캐싱(title+topics)으로 293권 전체를 증분 배치 채점 → `data/analyze_scores.csv`.
- 태그 표본 감사(2026-07-07) + 원천 태그 정규화(층위 B, 2026-07-08 완료):
  Supabase books.topics 갱신 완료, GitHub 최초 커밋(`3ca07c4`).
- v4 재채점 완료: `data/analyze_scores_v4_20260708.csv` / `data/book_clusters_v4_20260708.csv`.
- **2026-07-08 저녁, 관점 축 통합 + UI 실험을 커밋 없이 진행하다 꼬여서
  `3ca07c4`로 전체 롤백함.** 작업 내용은 `git stash`(`stash@{0}`, 메시지
  "rollback-2026-07-08: 관점축 통합 작업 + UI 변경분 백업")에 참고용으로
  보존되어 있으나, **그대로 재적용하지 말 것** — 아래 최종 아키텍처 결정과
  다른 설계였음(즉석 GPT 이항분류를 membership 조회로 바꾸되 curate/Labs가
  여전히 별도로 채점하는 구조였음). diff는 코드 작성 시 참고 자료로만 사용.
- 롤백 여파로 `3ca07c4` 이후 작업(커밋 안 된 상태였던 `clusterId` 시소러스
  검색 경로: `lib/supabase.ts`의 `searchBooksByIds`, `app/api/curate/route.ts`의
  `clusterId` 처리)도 함께 유실됨 → 아래 STEP 계획에 복원 포함.

## 🎯 최종 확정 아키텍처 (2026-07-09, 여러 차례 논의 끝에 확정 — 재논의 불필요)

**문제였던 것**: 같은 책("슬픈 살인")이 `/curate`와 `/analyze`에서 다른 관점으로
분류됨. 원인은 두 화면이 서로 다른 시점에 서로 다른 GPT 호출로 판단했기 때문.

**확정된 해결 원칙 — "검색은 이원화, 판단은 단일화"**

1. **검색(책을 찾는 방법)은 두 경로를 모두 유지한다.**
   - 자유텍스트 입력 (세세한 주제 탐색용, 기존 topicVariants/ilike 경로 그대로)
   - 시소러스 칩 (컬렉션을 대표하는 주제로 빠른 진입, `clusterId` → `book_clusters.csv`
     정확 매칭 경로)
   - 검색창은 없애지 않는다. 시소러스 칩만 남기고 검색창을 제거하는 방향은
     "세세한 주제를 찾고 싶은 이용자" 니즈를 못 채워서 기각됨.

2. **판단(그 책이 어느 관점인지)은 무조건 하나의 소스만 쓴다.**
   - `/curate`가 즉석으로 GPT를 불러 그때그때 이항분류하던 방식을 **폐기**한다.
   - 검색으로 어떤 책이 나왔든, 관점 분류(membership degree)는 항상
     `data/analyze_scores.csv`(v4 계열, 배치 재실행으로 최신화)를 **조회**해서
     가져온다. GPT를 curate 요청마다 다시 불러 분류하지 않는다.
   - `/analyze`(Labs)의 배치 채점 시스템(v3/v4 스냅샷, 히트맵, 스펙트럼)은
     **그대로 유지한다. 폐기 대상 아님.** 논문 데이터이자 curate가 참조하는
     단일 소스이기도 하므로 오히려 이번 결정으로 중요도가 더 커짐.
   - 이 방식이면 curate와 Labs는 같은 행(row)을 보는 것이므로 불일치가
     구조적으로 발생할 수 없음.

3. **북카드의 "관점 스펙트럼 확인" 버튼**은 새 API 호출이 아니라, 이미
   조회해온 membership 값을 그대로 시각화한다. `/analyze`와 완전히 같은 숫자.

4. **reason 문장 생성만 GPT를 쓴다**, 역할을 명확히 한정해서:
   - GPT가 다시 분류하지 않는다(membership 값은 이미 정해져 있음).
   - "이미 나온 membership 값의 근거를 topics·서평 헤드라인·책소개(있는 경우)에서
     찾아 문장으로 설명"하는 역할만 맡긴다.
   - 근거 자료를 프롬프트에 반드시 포함할 것 — 이게 빠지면 "구조 관점으로
     분류된 책입니다" 같은 부실한 reason이 나온다는 게 이미 확인됨
     (2026-07-08 저녁 시행착오).

5. **관점 축은 하나로 통일한다.** `lib/perspectives.ts`(curate, 5축)와
   `lib/analyzeAxes.ts`(Labs, 6축)의 이원화를 없애고 단일 소스(`lib/perspectiveAxes.ts`
   가칭)로 합친다. Labs의 6축(indiv-struct, neutral-critical, now-future,
   cause-solution, acad-pop, narrative-explain)을 기준으로 통합하는 방향이나,
   `tech-social` 축을 완전히 버릴지 다른 축에 흡수할지는 **코드를 직접 확인한
   뒤 Hailey와 다시 확정할 것** (아직 완전 확정 아님).

6. **알려진 트레이드오프 (수용됨)**: v4 배치에 없는 신규 도서는 재배치
   전까지 관점 분류가 뜨지 않는다(검색은 되지만 스펙트럼 값이 없음 —
   "아직 채점되지 않음" 같은 안내 필요). 노션 파이프라인 자동화는 별도
   작업으로, 이번 스코프에 포함하지 않는다.

## 다음 세션 STEP 계획 (제안 순서 — Claude Code가 코드 확인 후 세부 조정)

- **STEP 1**: 코드 정찰. 현재 `lib/perspectives.ts`, `lib/analyzeAxes.ts`,
  `app/api/curate/route.ts`, `app/api/analyze-score/route.ts`,
  `app/page.tsx`, `app/analyze/page.tsx`를 읽고 현재 상태 보고 (아직 수정 없음).
- **STEP 2**: `clusterId` 시소러스 검색 경로 복원 (`searchBooksByIds`,
  `book_clusters.csv` 파싱) — 유실됐던 검증 완료 기능 되살리기. **완료 즉시 커밋.**
- **STEP 3**: 관점 축 단일화 (`lib/perspectiveAxes.ts`). UI는 아직 안 건드림.
  tech-social 처리 방향 이 STEP에서 확정. **완료 즉시 커밋.**
- **STEP 4**: `/curate` 판단 로직을 v4 CSV 조회 방식으로 전환. reason 생성
  프롬프트에 근거 자료(topics/서평 헤드라인) 포함. "슬픈 살인" 등 몇 권으로
  검증(같은 책이 curate·Labs에서 동일한 값으로 나오는지 직접 대조).
  **완료 즉시 커밋.**
- **STEP 5**: UI — 검색창 유지 + 시소러스 칩 추가(칩은 `clusterId` 전송),
  북카드에 "관점 스펙트럼 확인" 버튼(응답에 이미 포함된 membership 시각화),
  `/analyze`로 가는 링크. **완료 즉시 커밋.**
- STEP 5 이후: 기존에 확인된 "알려진 이슈"(custom 관점 라벨 표시 버그)는
  축 통합으로 custom 개념 자체가 어떻게 되는지에 따라 재확인 필요.

## 작업 방식 선호

- STEP 단위로 계획을 세우고, 계획이 확정되면 이어서 진행하되 **STEP마다 커밋**.
- 파일 변경 범위를 항상 먼저 명시.
- 애매한 설계 결정은 임의로 정하지 말고 옵션과 추천안을 제시해 확인받은 뒤 진행.
- 큰 구조 변경 전에는 관련 파일을 전부 읽고 현재 상태를 보고한 뒤 계획을 세운다.
- 응답은 한국어, 프로처럼 정확하되 다정한 톤 유지.
