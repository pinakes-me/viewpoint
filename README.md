# ViewPoint — 관점 기반 북큐레이션 웹앱

> 같은 주제, 다른 시선으로 읽다

**ViewPoint**는 사용자가 주제를 입력하면 AI가 관련 도서를 두 가지 관점으로 분류해서 보여주는 북큐레이션 웹앱입니다.  
사서의 주제 분석 전문성과 AI의 분류 능력을 결합하여, 단순 추천을 넘어 **다각적 독서 경험**을 제안합니다.

🔗 **배포 주소**: [viewpoint-curation.vercel.app](https://viewpoint-curation.vercel.app)

-----

## 주요 기능

### 관점별 도서 큐레이션

주제를 입력하면 AI가 두 가지 관점(예: 개인 차원 vs 구조 차원)으로 도서를 분류합니다.  
개인/구조, 기술 해결론/사회 해결론, 설명적/비판적 등 6가지 관점 세트를 제공하며, 직접 입력도 가능합니다.

### 주제별 추천 관점 카드

주제 입력 시 AI가 해당 주제에 맞는 관점 세트 2~3개를 먼저 제안합니다.  
이항대립(좋다/나쁘다)이 아닌, 사회과학·인문학적으로 의미있는 분석 렌즈를 제시합니다.

### 사서 큐레이션 데이터 기반

- 사서가 직접 수집한 **신문 서평 데이터** 166권 (경향·한겨레·동아·조선일보)
- **국립중앙도서관 사서추천 도서** 127권
- 총 293권의 검증된 도서 DB

### 내 서재

마음에 드는 책을 저장하고 관리할 수 있는 개인 서재 기능 (localStorage 기반)

-----

## 기술 스택

|분류    |기술                                               |
|------|-------------------------------------------------|
|프레임워크 |Next.js 14 (App Router) + TypeScript             |
|스타일링  |Tailwind CSS                                     |
|데이터베이스|Supabase (PostgreSQL)                            |
|AI    |GPT-4o-mini (OpenAI API)                         |
|폰트    |Gowun Batang, Playfair Display, Plus Jakarta Sans|
|배포    |Vercel                                           |

-----

## 시스템 구조

```
사용자 주제 입력
    ↓
Supabase에서 관련 도서 검색 (topics + title ilike)
    ↓
서평 헤드라인 + 주제 태그 → GPT-4o-mini에 전달
    ↓
GPT는 관점 분류 + reason만 반환 (책 정보 생성 금지)
    ↓
책 정보(표지, 저자, 연도)는 100% Supabase에서 조회
    ↓
결과 반환
```

> **환각 방지 설계**: AI는 도서 목록에서 제목을 선택하고 reason만 작성합니다.  
> 책 정보는 반드시 DB에서만 가져오도록 설계하여 존재하지 않는 책 추천을 원천 차단합니다.

-----

## 데이터 설계

### Supabase 테이블 구조

```
books (293권)
  - notion 출처: 사서 직접 수집 신문 서평 도서 (166권)
  - nlk 출처: 국립중앙도서관 사서추천 도서 (127권)

sources (4개 언론사)
  - 경향신문, 한겨레신문, 동아일보, 조선일보

reviews (245건)
  - 서평 헤드라인 → AI 관점 분류 근거로 활용
```

### 주제 태그 시스템

- 사서의 주제 분석 전문성을 바탕으로 AI가 자동 생성한 해시태그 기반 태그
- 예: `#자본주의비판`, `#소설`, `#디스토피아문학`
- 태그 기반으로 소설/비문학 장르를 구분하여 AI reason 문체를 다르게 적용

-----

## 프로젝트 배경

이 프로젝트는 **문헌정보학 + 디지털인문학**의 교차점에서 출발했습니다.

사서의 핵심 역량인 **주제 분석(Subject Analysis)** 을 AI와 결합하여, 단순한 도서 추천을 넘어 독자가 하나의 주제를 다양한 시선으로 탐색할 수 있는 경험을 설계했습니다.

신문 서평의 정치적 성향을 관점 분류 기준으로 삼는 대신, **주제 태그(Subject Tag)** 를 핵심 신호로 활용한 것이 이 프로젝트의 문헌정보학적 접근입니다.

-----

## 개발 과정

- 바이브코딩(Vibe Coding) 방식으로 개발 — Cursor + Claude + ChatGPT + Gemini 협업
- Ollama(로컬 LLM) → OpenAI GPT-4o-mini로 전환
- 단일 페이지 앱(히어로 → 결과 화면 state 전환)으로 UX 개선
- 환각 방지, 장르별 문체 구분, 관점 탭 개선 등 지속적인 품질 개선

-----

## 로컬 실행

```bash
# 저장소 클론
git clone https://github.com/pinakes-me/viewpoint.git
cd viewpoint

# 의존성 설치
npm install

# 환경변수 설정 (.env.local)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
OPENAI_API_KEY=...
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
NLK_API_KEY=...

# 개발 서버 실행
npm run dev
```

-----

## Made by

**Hailey** — 예비사서 + 디지털인문학 연구자 지망생  
문헌정보학의 주제 분석 전문성과 디지털 기술을 연결하는 프로젝트를 만들고 있습니다.