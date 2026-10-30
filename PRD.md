# 📄 [PRD] 상식 퀴즈 게임 (Trivia Quiz Game)

## 1. 개요 (Overview)
* **제품명:** 지식왕 도전
* **목적:** 다양한 분야의 상식 문제 풀이를 통해 사용자에게 재미와 학습 기회를 제공하고, 점수 및 순위 시스템으로 몰입도를 강화함.
* **주요 타겟사용자:1. 연령 : 중학생 이상(14+)
	                   2. 특징 : 상식 퀴즈와 학습에 관심이 있는 사용자
			   3. 이용 환경 : 모바일/웹 브라우저

## 2. 주요 기능 및 규칙 (Key Features & Rules)

### 2.1. 퀴즈 구조

* **문제 형식:** 4지선다 객관식 (Single Choice)
* **카테고리 (총 4개):**
1. 한국사 (10문제)
2. 과학 (10문제)
3. 지리 (10문제)
4. 일반상식 (10문제)
* **총 문제 수:** 40문제

### 2.2. 게임 진행 및 피드백
* **게임 모드:**
  * **전체 도전:** 전체 40문제 연속 풀이
  * **카테고리별:** 선택한 카테고리 10문제
  * **스피드 퀴즈:** 전체에서 무작위 20문제, 문제당 15초 제한. 시간이 끝나면 오답으로 처리하고 정답·해설을 보여 준다.
* **50:50 힌트:** 문제마다 한 번, 오답 보기 2개를 지운다. 힌트를 쓴 문제는 힌트 미사용 보너스를 받지 못한다.
* **실시간 피드백:**
* 사용자가 답안을 선택하는 즉시 정답/오답 여부 표시.
* 오답일 경우 정답 및 간단한 해설/설명 제공.

### 2.3. 점수 및 순위 (Scoring & Leaderboard)
* **점수 계산 (맞힌 문제만 점수를 받는다):**
  * **기본 점수:** 10점 × 난이도 배수 (쉬움 1배 = 10점, 보통 1.5배 = 15점, 어려움 2배 = 20점)
  * **시간 보너스:** 문제가 나온 뒤 10초 미만에 맞히면 +3점
  * **힌트 미사용 보너스:** 50:50 힌트를 쓰지 않고 맞히면 +2점
  * **연속 정답 콤보 보너스:** 연속 3번째 정답 +2점, 5번째 +5점, 10번째 +10점 (연속이 끊기면 처음부터 다시 센다)
* **결과 화면:**
* 풀이 완료 후 최종 점수, 정답률, 카테고리별 맞힌 개수 요약 제공.


* **순위 기록:**
* 닉네임 입력 후 최종 점수를 리더보드(순위표)에 등록.
* 전체 사용자 상위 랭킹(Top 10/Top 50) 조회 기능.

## 3. 사용자 흐름 (User Flow)

1. **메인 화면:** [게임 시작] / [순위 보기] / [카테고리 선택]
2. **퀴즈 진행 화면:**
* 문제 텍스트 및 보기 4개 표시
* 진행 상황 안내 (예: `한국사 3 / 10`)


3. **답안 선택 및 피드백:**
* 클릭 즉시 정/오답 연출 (색상 변경, 음향 효과 등)
* [다음 문제] 버튼을 눌러 이동


4. **최종 결과 화면:**
* 최종 점수 확인
* 닉네임 입력 후 점수 제출


5. **순위 화면:**
* 최고 점수 순위 확인 및 재도전 버튼 제공

## 4. 데이터 요구사항 (Data Requirements)

* **퀴즈 데이터 구조:**
* `id`: 문제 식별자
* `category`: 카테고리명 (한국사/과학/지리/일반상식)
* `question`: 문제 내용
* `options`: 보기 4개 배열
* `answer_index`: 정답 인덱스 (0~3)
* `explanation`: 정답 해설
* `difficulty`: 난이도 (`easy` / `medium` / `hard`)


* **사용자 점수 데이터 Structure:**
* `username`: 닉네임
* `score`: 최종 점수
* `created_at`: 기록 일시

## 5. 향후 확장 고려사항 (Future Improvements)
* **힌트 아이템:** 찬스 등 50:50 외의 힌트 추가 (타임어택(스피드 퀴즈)과 50:50 힌트는 구현됨)
* **카테고리 추가:** 대중문화, IT, 세계사 등 확장

---

# 🛠 기술 구현 계획 (Technical Implementation Plan)

## 6. 기술 스택 및 아키텍처 (Tech Stack & Architecture)

### 6.1. 기술 스택
| 영역 | 기술 |
|---|---|
| 프레임워크 | Next.js 15 (App Router, `output: 'standalone'`), React 19, TypeScript |
| 스타일 | Tailwind CSS (모바일 퍼스트 반응형) |
| 데이터 | PostgreSQL 16, Prisma ORM, zod (입력 검증) |
| 테스트 | Vitest (도메인 로직·API), Playwright (E2E 핵심 흐름) |
| 인프라 | Docker, Azure Container Registry (ACR), Azure Container Apps (ACA), Azure Database for PostgreSQL Flexible Server, Log Analytics |

### 6.2. 시스템 구성
```
[모바일/웹 브라우저]
        │ HTTPS
        ▼
[Azure Container Apps]  ── 이미지 pull ──  [Azure Container Registry]
  └─ Next.js 컨테이너 (단일 앱)
       ├─ 페이지: / , /quiz , /result/[sessionId] , /leaderboard
       └─ API Route: /api/*  (세션·채점·리더보드)
        │ Prisma (TLS, sslmode=require)
        ▼
[Azure Database for PostgreSQL Flexible Server]

로그/메트릭 → Log Analytics Workspace
```
* UI와 API를 한 Next.js 앱으로 묶어 **컨테이너 1개 = Container App 1개**로 배포한다.
* 페이지는 서버 컴포넌트로 데이터를 읽고, 퀴즈 진행(답 선택·피드백)은 클라이언트 컴포넌트가 API를 호출해 처리한다.

### 6.3. 결정 사항 (2.3절 미확정 항목 확정 포함)
* **점수 체계 (`src/lib/scoring.ts`, 순수 함수):** 2.3절의 규칙대로 서버가 계산한다.
  * 난이도는 문제마다 `questions.difficulty`에 둔다. 카테고리마다 쉬움 3 · 보통 4 · 어려움 3으로 맞춰, 카테고리 만점이 모두 같다(217점 = 기본 150 + 보너스 (3+2)×10 + 콤보 2+5+10).
  * 시간은 **서버 시계**로 잰다. 문제를 화면에 띄울 때 `POST /api/sessions/:id/views`를 부르면 그 시각을 기록하고, 답안이 도착한 시각과의 차이(`elapsed_ms`)로 시간 보너스·제한 시간을 판단한다. 클라이언트가 보낸 시간은 믿지 않는다.
  * 연속 정답은 답한 시각이 아니라 **출제 순서**로 센다(문제는 출제 순서대로만 열 수 있으므로 실제로도 같다).
  * **만점(`max_score`)**은 "전부 정답" 점수가 아니라 얻을 수 있는 최고 점수다. 콤보는 연속이 끊기면 다시 받으므로, 문제가 많으면 쉬운 문제 하나를 틀려 10연속 콤보를 한 번 더 받는 쪽이 더 높을 수 있다(예: 전체 40문제를 id 순으로 풀면 전부 정답 817점, 만점 821점). 출제 순서와 난이도로 연속 정답 수별 최고 점수를 차례로 계산한다.
  * 결과 화면은 점수 구성(기본·시간·힌트·콤보), 최대 연속 정답, 스피드 퀴즈의 시간 초과 수를 함께 보여 준다.
* **스피드 퀴즈:** 서버는 문제를 연 뒤 15초 + 여유 2초(`SPEED_DEADLINE_GRACE_MS`, 네트워크 지연분)가 지나 도착한 답안을 정답이어도 시간 초과 오답으로 기록한다. 화면의 타이머가 끝나면 클라이언트가 `selectedIndex: null`을 보내 바로 시간 초과 피드백을 받는다. 다른 모드에서 `null`은 `400`이다.
* **50:50 힌트:** 서버가 정답이 아닌 보기 2개를 무작위로 골라 `session_question_views.hint_removed`에 저장하고, 답안에 `hint_used`를 복사해 둔다. 한 문제에 다시 요청하면 처음 고른 보기를 돌려준다(멱등). 답한 뒤에는 `409`. 힌트 수에는 제한이 없고, 쓸 때마다 그 문제의 +2점을 포기한다.
* **서버 채점:** 문제를 받을 때 클라이언트에는 `answer_index`를 보내지 않는다. 답을 선택할 때마다 서버가 정답 여부, 정답, 해설을 돌려준다. 최종 점수도 서버가 세션 기록으로 계산하므로 클라이언트가 점수를 조작할 수 없다.
* **리더보드 분리:** 만점이 다르기 때문에 모드별(전체 40문제 / 카테고리별 / 스피드)로 순위를 따로 집계한다. 동점이면 먼저 기록한 사람이 위에 온다.
* **닉네임:** 2~12자, 로그인은 없다. NFC로 정규화하고 앞뒤 공백을 제거한 뒤 글자 수를 센다. 순위표 사칭을 막기 위해 제어·서식 문자(방향 전환 U+202E, 폭 없는 공백 U+200B 등)와 빈 글자(한글 채움 문자 U+3164·U+115F·U+1160·U+FFA0, 점자 빈칸 U+2800)는 거부한다. 단, 이모지를 잇는 ZWJ(👨‍👩‍👧)는 허용한다.
* **보안 헤더:** 모든 응답에 CSP(`frame-ancestors 'none'`, 같은 출처만 허용), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`을 붙이고 `X-Powered-By`는 끈다(`next.config.ts`). App Router 하이드레이션 때문에 script-src에는 `'unsafe-inline'`이 필요하다(nonce 방식 CSP는 이후 과제).
* **요청 횟수 제한(앱 내부, `src/lib/rate-limit.ts`):** IP별 고정 윈도 카운터를 Postgres(`rate_limits`)에 둔다. 여러 replica가 같은 한도를 공유하고 재시작해도 유지된다. 한도는 세션 생성 10분 30회, 문제 열기·힌트·답안 각각 1분 300회, 점수 등록 1시간 20회이며, 넘으면 `429`와 `Retry-After`를 돌려준다. 학교처럼 여러 사람이 공인 IP 하나를 쓰는 환경을 고려해 넉넉하게 잡았다. IPv6는 /64 단위로 묶는다.
  * 클라이언트 IP는 `X-Forwarded-For`의 **오른쪽**에서 `TRUSTED_PROXY_HOPS`번째 값으로 판별한다(ACA는 1). 왼쪽 값은 클라이언트가 위조할 수 있으므로 쓰지 않는다. Next.js는 이 헤더가 없을 때만 소켓 주소로 채우므로, 프록시 없이 인터넷에 직접 노출하는 배포(0단)에서는 위조를 막을 수 없다. ACA 인그레스 뒤에서만 운영한다.
* **답안 간격 제한:** 같은 세션에서 직전 답안(첫 답안은 세션 시작)으로부터 1초 안에 온 답안은 `429`로 거절한다. 세션 행을 잠그고(`FOR UPDATE`) 검사하므로 여러 답안을 동시에 보내도 하나만 통과한다. 퀴즈 화면은 이 1초를 스스로 채운 뒤 전송하므로 정상 사용자는 거절을 보지 않는다.
* **세션 만료·정리:** 점수를 등록하지 않은 세션은 시작 후 24시간이 지나면 만료된다(답안·등록 시 `404`). 만료 세션과 끝난 카운터는 세션 생성 요청 때 인스턴스마다 1시간에 한 번 지운다(`src/lib/maintenance.ts`, 별도 스케줄러 없음).
* **장애 대응(타임아웃·재시도·멱등성):**
  * DB 연결 문자열에 `connect_timeout=5`, `pool_timeout=10`, `socket_timeout=10`(초)을 기본으로 넣는다(`src/lib/prisma.ts`, 이미 지정한 값은 유지). Prisma 기본값은 쿼리 응답 대기 무제한이라, DB가 멈추면 요청이 끝나지 않는다.
  * DB 일시 장애(Prisma P1001·P1002·P1008·P1017·P2024·P2028·P2034, 연결 초기화 실패)는 500이 아니라 `503 SERVICE_UNAVAILABLE` + `Retry-After: 5`로 응답해 클라이언트가 재시도할 수 있게 한다.
  * `/api/health`는 3초 안에 DB가 답하지 않으면 `503 { database: "timeout" }`. DB가 멈춰도 probe가 무한정 기다리지 않는다.
  * 문제 열기·힌트·답안 제출·점수 등록은 **멱등**이다. 응답이 유실돼 같은 요청(같은 보기·같은 닉네임)을 다시 보내면 처음 결과를 돌려준다(문제 열기는 처음 연 시각 그대로, 힌트는 처음 지운 보기 그대로, 답안 200, 점수 등록 재전송은 201 대신 200). 다른 보기·다른 닉네임이면 409.
  * 브라우저(`src/lib/http-client.ts`)는 모든 API 호출에 10초 시간 제한을 두고, 멱등인 문제 열기·힌트·답안·점수 등록만 네트워크 오류·502/503/504에서 최대 2번 자동 재시도한다(`Retry-After`는 5초까지 따름). 세션 생성은 재시도하면 세션이 새로 생기므로 사용자가 [다시 시도]를 누르게 한다.
  * 답안 전송이 끝내 실패하면 고른 보기를 고정한 채 [다시 시도]로 **같은 보기만** 다시 보낸다(서버에 이미 기록됐을 수 있어 다른 보기로 바꾸면 409에 막히기 때문). 세션이 만료(404)됐으면 새 퀴즈 시작 화면으로 바꾼다.
  * 서버 컴포넌트 화면의 오류(`error.tsx`)에서 [다시 시도]는 `router.refresh()`와 `reset()`을 함께 실행해 서버 결과를 다시 받아 온다(`reset()`만으로는 복구되지 않는다).
* **순위표 조작에 대한 한계:** 오답 시 정답을 보여 주는 요구사항(2.2) 때문에, 버리는 세션으로 정답을 수집한 뒤 만점을 등록하는 것 자체는 막을 수 없다. 세션 생성 응답에 모든 문제가 들어 있으므로, 스크립트는 문제를 미리 읽고 문제를 열자마자 답해 시간 보너스를 받을 수도 있다. 위 제한들은 그 속도를 사람 수준으로 늦추고(문제당 1초 이상, IP당 등록 1시간 20회) 대량 등록을 막는 데 목적이 있다. 여러 IP를 동원한 공격까지 막으려면 CAPTCHA나 로그인 같은 별도 수단이 필요하다.
* **카테고리 확장성:** 카테고리는 코드에 하드코딩하지 않고 `categories` 테이블로 관리한다(5장 향후 확장 대비).
* **출제 순서:** 세션을 만들 때 문제 순서를 섞어 `quiz_sessions.question_ids`에 고정한다. 보기 순서는 원본 그대로 쓴다.

## 7. 파일 구조 (Project Structure)
```
.
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx
│  │  ├─ page.tsx, MainMenu.tsx            # 메인: [게임 시작] / [카테고리 선택] / [순위 보기]
│  │  ├─ error.tsx, not-found.tsx          # 공통 오류 / 404 화면
│  │  ├─ quiz/                             # page.tsx(?mode=all | ?mode=speed | ?category=<slug>), QuizRunner.tsx(화면),
│  │  │                                    # quiz-state.ts(상태 전이), use-quiz-session.ts(서버 통신·진행)
│  │  ├─ result/[sessionId]/               # page.tsx(결과 요약) + ScoreSubmitForm.tsx(닉네임 제출)
│  │  ├─ leaderboard/page.tsx              # ?mode=ALL|CATEGORY|SPEED&category=<slug>&limit=10|50&highlight=<rank>
│  │  └─ api/
│  │     ├─ categories/route.ts            # GET
│  │     ├─ sessions/route.ts              # POST  세션 생성
│  │     ├─ sessions/[id]/views/route.ts   # POST  문제 열기 (서버가 답안 시간 측정 시작)
│  │     ├─ sessions/[id]/hints/route.ts   # POST  50:50 힌트
│  │     ├─ sessions/[id]/answers/route.ts # POST  답안 제출 → 즉시 피드백·점수
│  │     ├─ sessions/[id]/result/route.ts  # GET   결과 요약
│  │     ├─ sessions/[id]/submit/route.ts  # POST  닉네임 → 점수 등록
│  │     ├─ leaderboard/route.ts           # GET
│  │     └─ health/route.ts                # GET   ACA health probe
│  ├─ components/                          # QuestionCard, OptionButton, ProgressBar, Countdown(스피드 타이머),
│  │                                       # FeedbackPanel, ResultSummary, LeaderboardTable, button-styles
│  └─ lib/
│     ├─ quiz/                             # 도메인: sessions.ts(출제·문제 열기·힌트·채점·결과·만료), scores.ts(등록·순위표),
│     │                                    #         categories.ts, summary.ts(결과 집계, 순수 함수)
│     ├─ errors.ts                         # AppError(예상된 오류)와 오류 코드
│     ├─ db-errors.ts                      # Prisma 오류 분류(고유 제약 위반, 일시 장애)
│     ├─ api.ts                            # 라우트 공통: 오류 → HTTP 상태 변환, 본문(parseJson)·경로 파라미터 읽기
│     ├─ rate-limit.ts, client-ip.ts       # IP별 요청 횟수 제한 / 클라이언트 IP 판별
│     ├─ maintenance.ts                    # 만료 세션·카운터 정리
│     ├─ http-client.ts                    # 브라우저용 API 호출(시간 제한·재시도·한국어 오류)
│     ├─ page-helpers.ts                   # 서버 페이지 공통(orNotFound, searchParams)
│     ├─ limits.ts                         # 닉네임 길이·스피드 문제 수·제한 시간 등 클라이언트·서버 공용 상수 (zod 없음)
│     ├─ prisma.ts                         # PrismaClient 싱글톤
│     ├─ scoring.ts                        # 점수 규칙(난이도 배수·보너스·콤보), 만점·정답률 계산
│     ├─ hint.ts                           # 50:50 힌트로 지울 보기 고르기
│     ├─ routes.ts                         # 화면 이동 URL·카테고리 아이콘
│     ├─ sound.ts                          # 정/오답 효과음 (Web Audio 합성, 음원 파일 없음)
│     └─ validation.ts                     # zod 스키마 (요청 본문·쿼리)
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  ├─ seed.mjs                             # categories + 40문제 upsert (런타임 이미지에서 바로 실행되도록 순수 JS)
│  └─ data/questions.json                  # 4장 데이터 구조를 따르는 문제 원본
├─ tests/
│  ├─ unit/                                # Vitest
│  └─ e2e/                                 # Playwright
├─ Dockerfile
├─ docker-entrypoint.sh
├─ docker-compose.yml
├─ .dockerignore
├─ .env.example                            # DATABASE_URL=
└─ .github/workflows/ci.yml                # CI: quality(lint·타입·단위/통합·빌드) → e2e(Docker·Playwright)
                                            # (배포 워크플로 deploy.yml은 ACA 배포 단계에서 추가)
```

## 8. DB 스키마 (Database Schema)

### 8.1. 테이블 요약
| 테이블 | 컬럼 | 제약/인덱스 |
|---|---|---|
| `categories` | `id` SERIAL PK, `slug` VARCHAR UNIQUE, `name` VARCHAR, `sort_order` INT | 시드: `korean-history`(한국사), `science`(과학), `geography`(지리), `general`(일반상식) |
| `questions` | `id` SERIAL PK, `category_id` FK, `question` TEXT, `options` TEXT[], `answer_index` SMALLINT, `explanation` TEXT, `difficulty` ENUM(`EASY`,`MEDIUM`,`HARD`), `created_at` TIMESTAMPTZ | CHECK `answer_index BETWEEN 0 AND 3`, CHECK `cardinality(options) = 4`, INDEX(`category_id`) |
| `quiz_sessions` | `id` UUID PK, `mode` ENUM(`ALL`,`CATEGORY`,`SPEED`), `category_id` FK NULL, `question_ids` INT[], `started_at` TIMESTAMPTZ, `completed_at` TIMESTAMPTZ NULL | `mode = CATEGORY`일 때만 `category_id`가 있다 |
| `session_answers` | `session_id` FK, `question_id` FK, `selected_index` SMALLINT NULL, `is_correct` BOOLEAN, `elapsed_ms` INT NULL, `hint_used` BOOLEAN, `timed_out` BOOLEAN, `answered_at` TIMESTAMPTZ | PK(`session_id`, `question_id`): 같은 문제에 두 번 답할 수 없다. CHECK: 시간 초과면 오답, `selected_index`가 NULL이면 시간 초과, `elapsed_ms >= 0` |
| `session_question_views` | `session_id` FK(CASCADE), `question_id` FK, `viewed_at` TIMESTAMPTZ, `hint_removed` SMALLINT[] | PK(`session_id`, `question_id`). 문제를 연 시각과 50:50 힌트로 지운 보기. CHECK: `hint_removed`는 0~3 중 0개 또는 2개 |
| `scores` | `id` SERIAL PK, `session_id` UUID UNIQUE FK, `username` VARCHAR(12), `score` INT, `max_score` INT, `correct_count` INT, `total_count` INT, `mode` ENUM, `category_id` FK NULL, `created_at` TIMESTAMPTZ | INDEX(`mode`, `category_id`, `score` DESC, `created_at` ASC) |
| `rate_limits` | `key` TEXT (`<규칙>:<IP>`), `window_start` TIMESTAMPTZ, `count` INT | PK(`key`, `window_start`), INDEX(`window_start`). 요청 횟수 제한용 고정 윈도 카운터 |

* `quiz_sessions.question_ids`는 배열이라 외래 키를 걸 수 없으므로, `questions`에 트리거를 두어 **세션이 참조하는 문제의 삭제와 id 변경을 거부**한다(GIN 인덱스 `question_ids`로 검사, Prisma에서는 P2003으로 보임). 막지 않으면 결과 화면과 점수 등록의 만점이 어긋나고, 진행 중인 세션은 끝낼 수 없게 된다. 결과 화면과 점수 등록은 같은 집계 함수(`summarizeSession`)를 쓰고, 만점은 항상 출제된 문제 목록 기준이다.
* `quiz_sessions`에는 만료 세션 정리용 INDEX(`started_at`)가 있다. `started_at`과 `answered_at`은 DB 기본값 대신 앱 서버 시계로 넣는다(답안 간격·만료 판단을 같은 시계로 하기 위해).
* 4장의 데이터 요구사항 필드명(`id`, `category`, `question`, `options`, `answer_index`, `explanation` / `username`, `score`, `created_at`)은 컬럼명과 API 응답에 그대로 쓴다. `category`는 API 응답에서 카테고리명으로 내려준다.

### 8.2. Prisma 스키마
```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum QuizMode {
  ALL
  CATEGORY
  /// 전체에서 무작위 20문제, 문제당 15초 제한
  SPEED
}

/// 기본 점수 배수: EASY 1배, MEDIUM 1.5배, HARD 2배 (src/lib/scoring.ts)
enum Difficulty {
  EASY
  MEDIUM
  HARD
}

model Category {
  id        Int           @id @default(autoincrement())
  slug      String        @unique
  name      String
  sortOrder Int           @default(0) @map("sort_order")
  questions Question[]
  sessions  QuizSession[]
  scores    Score[]

  @@map("categories")
}

model Question {
  id          Int                   @id @default(autoincrement())
  categoryId  Int                   @map("category_id")
  category    Category              @relation(fields: [categoryId], references: [id])
  question    String
  options     String[]
  answerIndex Int                   @map("answer_index") @db.SmallInt
  explanation String
  difficulty  Difficulty            @default(MEDIUM)
  createdAt   DateTime              @default(now()) @map("created_at") @db.Timestamptz
  answers     SessionAnswer[]
  views       SessionQuestionView[]

  @@index([categoryId])
  @@map("questions")
}

model QuizSession {
  id          String                @id @default(uuid()) @db.Uuid
  mode        QuizMode
  categoryId  Int?                  @map("category_id")
  category    Category?             @relation(fields: [categoryId], references: [id])
  questionIds Int[]                 @map("question_ids")
  startedAt   DateTime              @default(now()) @map("started_at") @db.Timestamptz
  completedAt DateTime?             @map("completed_at") @db.Timestamptz
  answers     SessionAnswer[]
  views       SessionQuestionView[]
  score       Score?

  // 오래된 미등록 세션 정리(cleanupExpiredSessions)용
  @@index([startedAt])
  // 세션이 참조하는 문제의 삭제를 막는 트리거(question_ids @> ARRAY[id])가 쓰는 인덱스
  @@index([questionIds], type: Gin)
  @@map("quiz_sessions")
}

model SessionAnswer {
  sessionId     String      @map("session_id") @db.Uuid
  session       QuizSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  questionId    Int         @map("question_id")
  question      Question    @relation(fields: [questionId], references: [id])
  /// null: 스피드 퀴즈에서 보기를 고르지 못하고 시간이 끝남
  selectedIndex Int?        @map("selected_index") @db.SmallInt
  isCorrect     Boolean     @map("is_correct")
  /// 문제를 연 시각(session_question_views)부터 답안이 도착할 때까지 서버가 잰 시간. 이전 버전의 답안은 null
  elapsedMs     Int?        @map("elapsed_ms")
  hintUsed      Boolean     @default(false) @map("hint_used")
  /// 스피드 퀴즈 제한 시간을 넘김 (항상 오답)
  timedOut      Boolean     @default(false) @map("timed_out")
  answeredAt    DateTime    @default(now()) @map("answered_at") @db.Timestamptz

  @@id([sessionId, questionId])
  @@map("session_answers")
}

/// 문제를 화면에 띄운 시각과 50:50 힌트 사용 기록. 시간 보너스·제한 시간을 서버 시계로 재기 위해 둔다.
model SessionQuestionView {
  sessionId   String      @map("session_id") @db.Uuid
  session     QuizSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  questionId  Int         @map("question_id")
  question    Question    @relation(fields: [questionId], references: [id])
  viewedAt    DateTime    @map("viewed_at") @db.Timestamptz
  /// 50:50 힌트로 지운 보기 2개. 비어 있으면 힌트를 쓰지 않았다
  hintRemoved Int[]       @default([]) @map("hint_removed") @db.SmallInt

  @@id([sessionId, questionId])
  @@map("session_question_views")
}

model Score {
  id           Int         @id @default(autoincrement())
  sessionId    String      @unique @map("session_id") @db.Uuid
  session      QuizSession @relation(fields: [sessionId], references: [id])
  username     String      @db.VarChar(12)
  score        Int
  maxScore     Int         @map("max_score")
  correctCount Int         @map("correct_count")
  totalCount   Int         @map("total_count")
  mode         QuizMode
  categoryId   Int?        @map("category_id")
  category     Category?   @relation(fields: [categoryId], references: [id])
  createdAt    DateTime    @default(now()) @map("created_at") @db.Timestamptz

  @@index([mode, categoryId, score(sort: Desc), createdAt])
  @@map("scores")
}

/// IP별 요청 횟수 제한용 고정 윈도 카운터. 여러 replica가 같은 카운터를 공유하도록 DB에 둔다.
model RateLimit {
  key         String
  windowStart DateTime @map("window_start") @db.Timestamptz
  count       Int

  @@id([key, windowStart])
  @@index([windowStart])
  @@map("rate_limits")
}
```
* Prisma로 표현할 수 없는 CHECK 제약(`answer_index` 범위, 보기 4개, 8.1의 답안·힌트 제약)은 마이그레이션 SQL에 직접 추가한다.

## 9. API 명세 (API Specification)
모든 요청 본문과 쿼리는 zod로 검증한다(`src/lib/validation.ts`). 검증에 실패하면 `400`, 리소스가 없으면 `404`, 상태가 맞지 않으면 `409`, 요청 본문이 4KB를 넘으면 `413`, 요청 횟수 한도나 답안 간격 제한에 걸리면 `429`(+ `Retry-After` 초), 본문을 10초 안에 다 받지 못하면 `408`, 전송 중 끊기면 `400`, DB 일시 장애면 `503`(+ `Retry-After: 5`)을 돌려준다(Content-Length가 없어도 상한을 넘는 순간 읽기를 멈춘다). POST 라우트는 모두 본문을 읽기 전에 IP별 한도를 먼저 검사한다. 오류 응답 형식은 `{ error: { code, message, issues? } }`이고, `code`는 `BAD_REQUEST` / `NOT_FOUND` / `CONFLICT` / `REQUEST_TIMEOUT` / `PAYLOAD_TOO_LARGE` / `TOO_MANY_REQUESTS` / `SERVICE_UNAVAILABLE` / `INTERNAL_ERROR` 중 하나이다. 경로의 세션 id가 UUID 형식이 아니면 없는 세션과 똑같이 `404`로 처리한다.

| Method | Path | 요청 | 응답 |
|---|---|---|---|
| GET | `/api/categories` | - | `200` `[{ slug, name, questionCount }]` (sort_order 순) |
| POST | `/api/sessions` | `{ mode: "ALL" | "CATEGORY" | "SPEED", categorySlug? }` | `201` `{ sessionId, mode, timeLimitMs, questions: [{ id, category, difficulty, question, options }] }`. 정답·해설은 제외하고, 섞은 순서를 `question_ids`에 고정한다. `SPEED`는 전체에서 20문제, `timeLimitMs`는 `SPEED`면 `15000`, 아니면 `null`. 없는 카테고리는 `404` |
| POST | `/api/sessions/:id/views` | `{ questionId }` | `200` `{ questionId, timeLimitMs, remainingMs, removedOptions }`. 문제를 화면에 띄우기 직전에 부르며, 이때부터 서버가 답안 시간을 잰다. 출제 순서대로만 열 수 있다(앞 문제에 답하지 않았으면 `409`). 다시 열면 처음 연 시각 그대로 남은 시간(`remainingMs`, 제한 시간이 없으면 `null`)과 이미 쓴 힌트(`removedOptions`)를 돌려준다. 세션에 없는 문제는 `400`, 만료된 세션은 `404` |
| POST | `/api/sessions/:id/hints` | `{ questionId }` | `200` `{ questionId, removedOptions: [i, j] }` (오름차순, 정답은 포함하지 않음). 다시 요청하면 같은 보기. 문제를 열기 전이거나 이미 답한 문제면 `409`, 세션에 없는 문제는 `400`, 만료된 세션은 `404` |
| POST | `/api/sessions/:id/answers` | `{ questionId, selectedIndex: 0~3 | null }` | `200` `{ isCorrect, timedOut, answerIndex, explanation, points: { base, time, hint, combo, total }, streak, score }`. `points`는 이 문제에서 얻은 점수(오답·시간 초과면 모두 0), `streak`은 이 답안까지의 연속 정답 수, `score`는 지금까지의 총점이다. `null`은 스피드 퀴즈의 시간 초과이며 다른 모드에서는 `400`. 열지 않은 문제는 `409`. 이미 답한 문제에 **같은 보기**를 다시 보내면 처음과 같은 `200`(재전송), 다른 보기면 `409`, 세션에 없는 문제는 `400`, 직전 답안 후 1초가 안 됐으면 `429`, 만료된 세션(24시간)은 `404`. 마지막 답이 들어오면 `completed_at`을 기록한다 |
| GET | `/api/sessions/:id/result` | - | `200` `{ mode, category, categorySlug, completed, submitted, timedOutCount, score, maxScore, breakdown: { base, time, hint, combo }, maxStreak, correctCount, answeredCount, totalCount, accuracy, byCategory: [{ category, correct, total }] }`. `category`(이름)와 `categorySlug`는 카테고리 모드일 때만 값이 있고 아니면 `null`, `accuracy`는 % 단위로 소수점 첫째 자리까지, 답하지 않은 문제는 오답으로 센다 |
| POST | `/api/sessions/:id/submit` | `{ username }` (앞뒤 공백 제거, 2~12자) | `201` `{ rank, score, maxScore }`. 점수는 서버가 답안 기록으로 계산한다. 이미 등록한 세션에 **같은 닉네임**을 다시 보내면 처음 결과를 `200`으로(재전송), 다른 닉네임이면 `409`. 모든 문제에 답하기 전이면 `409`, 만료된 세션은 `404` |
| GET | `/api/leaderboard` | `?mode=ALL|CATEGORY|SPEED&category=<slug>&limit=10|50` (기본값 `ALL`, `10`) | `200` `[{ rank, username, score, maxScore, created_at }]`. 정렬은 score 내림차순 → created_at 오름차순(선착순)이다. `CATEGORY`인데 category가 없으면 `400`, `ALL`·`SPEED`면 category를 무시한다 |
| GET | `/api/health` | - | `200` `{ status: "ok" }` / DB 연결 실패 시 `503` `{ status: "error", database: "unreachable" }`, 3초 안에 답이 없으면 `503` `{ ..., database: "timeout" }` |

**사용자 흐름과 매핑:** 메인(`/api/categories`) → 퀴즈 시작(`POST /api/sessions`) → 문제마다 열기(`POST .../views`), 필요하면 힌트(`POST .../hints`), 답안 제출과 피드백(`POST .../answers`) → 결과(`GET .../result`) → 닉네임 제출(`POST .../submit`) → 순위(`GET /api/leaderboard`) → 재도전 시 다시 세션 생성.

## 10. Docker
실제 파일: `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.yml`, `.dockerignore` (이 장은 구조와 결정 사항만 요약한다).

### 10.1. Dockerfile (멀티 스테이지, node:22-alpine)
| 스테이지 | 하는 일 |
|---|---|
| `base` | `openssl` 설치 (Prisma musl 엔진에 필요), 텔레메트리 끄기 |
| `deps` | `npm ci --ignore-scripts`. postinstall(`prisma generate`)은 스키마가 필요해서 builder에서 실행 |
| `builder` | `prisma generate` → `next build` (lint·타입 검사 포함) |
| `prisma-cli` | package-lock과 같은 버전의 Prisma CLI만 따로 설치. 런타임 마이그레이션용이며, 쿼리 엔진은 지운다 |
| `runner` | standalone 산출물, `.next/static`, `public`, `prisma/`(마이그레이션·시드), Prisma CLI만 복사. 기본 non-root 사용자 `node`(uid 1000)로 실행 |

* Prisma Client와 musl 쿼리 엔진은 Next standalone 추적에 이미 포함된다. `@prisma/client`를 통째로 복사하면 사용하지 않는 DB별 wasm 런타임 약 70MB가 더 들어가므로 복사하지 않는다(이미지 약 530MB).

### 10.2. docker-entrypoint.sh
1. `prisma migrate deploy`: Prisma의 advisory lock 덕분에 replica가 여러 개 떠도 안전하다. DB가 아직 연결을 받지 않으면 3·6·9…초 간격으로 최대 `MIGRATE_MAX_ATTEMPTS`(기본 5)번 다시 시도하고, 끝내 실패하면 종료 코드 1로 끝내 오케스트레이터가 실패를 알게 한다.
2. `RUN_SEED=true`일 때만 `node prisma/seed.mjs` 실행 (upsert라 여러 번 실행해도 안전). 로컬 compose에서만 켜고, ACA에서는 최초 1회 수동으로 실행한다(11.2 8단계).
3. `exec node server.js` (`HOSTNAME=0.0.0.0`, `PORT=3000`)
* `.gitattributes`로 `*.sh`를 LF로 고정한다. Windows에서 CRLF로 체크아웃되면 컨테이너의 `sh`가 실패한다.

### 10.3. docker-compose.yml
* `db`: postgres:16, 볼륨 `pgdata`, `pg_isready` healthcheck, 호스트 **`127.0.0.1:5433`**
* `app`: `build: .`, `DATABASE_URL=postgresql://trivia:trivia@db:5432/trivia`, `RUN_SEED=true`, db가 healthy가 된 뒤 기동, `/api/health` healthcheck(wget), 호스트 **`${APP_HOST:-127.0.0.1}:${APP_PORT:-3001}`**
* 호스트 기본 포트를 5432/3000 대신 5433/3001로 둔 이유: 로컬 PostgreSQL이나 WSL 서비스와 겹치는 경우가 많기 때문이다.
* 포트는 **127.0.0.1에만** 연다. `0.0.0.0`으로 열면 같은 네트워크의 누구나 개발용 비밀번호(`trivia`)로 DB에 접속할 수 있다. 휴대폰 등 다른 기기에서 앱을 확인할 때만 `APP_HOST=0.0.0.0`으로 앱 포트를 연다(DB는 계속 로컬 전용).

### 10.4. 로컬 실행·검증
```bash
docker compose up --build -d     # db + app (마이그레이션·시드 자동) → http://127.0.0.1:3001
npm run test:e2e                 # Playwright E2E (아래 10.5)
docker compose up -d db          # 개발 서버(npm run dev)용 DB만 띄울 때
```
* `.dockerignore`: `node_modules`, `.next`, `.env*`, `tests`, 테스트 리포트, `.git`, 문서 등. 빌드 컨텍스트를 줄이고 비밀 값이 이미지에 들어가지 않게 한다.

### 10.5. E2E (Playwright)
* `playwright.config.ts`: 대상은 `E2E_BASE_URL`(기본 `http://127.0.0.1:${APP_PORT:-3001}`). 프로젝트는 `mobile-360`(360×780)과 `desktop`이다. Windows에서는 `localhost`(::1)가 WSL의 다른 서비스로 갈 수 있어 `127.0.0.1`을 쓴다.
* `tests/e2e/quiz-flow.spec.ts`:
  * 핵심 흐름: 메인 → 카테고리 10문제(문제마다 피드백 검증) → 결과 점수 확인 → 닉네임 등록 → 순위표 강조 행 → 결과 재방문 시 "이미 등록" 표시
  * 전체 모드 시작과 키보드(1~4, Enter) 조작
  * 순위표 탭·Top 50 전환과 재도전
  * 404 화면
* `tests/e2e/security.spec.ts`: 실제 응답의 보안 헤더, CSP를 적용한 상태로 퀴즈를 진행할 때 위반이 0건인지(하이드레이션·클릭·키보드 동작), 다른 출처의 iframe 삽입 차단, 4KB 초과 본문 413
* 정리(global teardown): 로컬 대상일 때만(`E2E_BASE_URL` 미지정) 이번 실행이 만든 세션과 `E2E-` 닉네임 기록을 지운다. 기록이 쌓이면 새 기록이 Top 50 밖으로 밀려나 테스트가 불안정해지기 때문이다.

## 11. Azure Container Apps 배포 단계 (Deployment)

### 11.1. 변수
```bash
RG=rg-trivia
LOC=koreacentral
ACR=acrtrivia$RANDOM            # 전역에서 고유해야 한다
PG=pg-trivia-$RANDOM
PG_ADMIN=triviaadmin
PG_PASSWORD='<강력한 비밀번호>'
ENV=cae-trivia
APP=ca-trivia-web
LAW=law-trivia
```

### 11.2. 단계
1. **사전 준비**
   ```bash
   az login
   az extension add --name containerapp --upgrade
   az provider register --namespace Microsoft.App
   az provider register --namespace Microsoft.OperationalInsights
   ```
2. **리소스 그룹**
   ```bash
   az group create -n $RG -l $LOC
   ```
3. **Container Registry**
   ```bash
   az acr create -g $RG -n $ACR --sku Basic
   ```
4. **PostgreSQL Flexible Server**
   ```bash
   az postgres flexible-server create -g $RG -n $PG -l $LOC \
     --tier Burstable --sku-name Standard_B1ms --version 16 --storage-size 32 \
     --admin-user $PG_ADMIN --admin-password "$PG_PASSWORD" --public-access 0.0.0.0
   az postgres flexible-server db create -g $RG -s $PG -d trivia
   DATABASE_URL="postgresql://$PG_ADMIN:$PG_PASSWORD@$PG.postgres.database.azure.com:5432/trivia?sslmode=require"
   ```
   * `--public-access 0.0.0.0`은 Azure 서비스에서 들어오는 접속만 허용한다. 운영 단계에서는 VNet 통합과 Private Endpoint로 바꾸는 것을 검토한다.
5. **이미지 빌드·푸시** (로컬 Docker 없이 ACR에서 빌드)
   ```bash
   az acr build -r $ACR -t trivia-web:v1 .
   ```
6. **Container Apps 환경** (Log Analytics 연동)
   ```bash
   az monitor log-analytics workspace create -g $RG -n $LAW -l $LOC
   LAW_ID=$(az monitor log-analytics workspace show -g $RG -n $LAW --query customerId -o tsv)
   LAW_KEY=$(az monitor log-analytics workspace get-shared-keys -g $RG -n $LAW --query primarySharedKey -o tsv)
   az containerapp env create -g $RG -n $ENV -l $LOC \
     --logs-workspace-id $LAW_ID --logs-workspace-key $LAW_KEY
   ```
7. **Container App 생성** (시스템 할당 관리 ID로 ACR pull, DB 연결 문자열은 secret)
   ```bash
   az containerapp create -g $RG -n $APP --environment $ENV \
     --image $ACR.azurecr.io/trivia-web:v1 \
     --registry-server $ACR.azurecr.io --registry-identity system \
     --target-port 3000 --ingress external \
     --secrets db-url="$DATABASE_URL" \
     --env-vars DATABASE_URL=secretref:db-url TRUSTED_PROXY_HOPS=1 \
     --cpu 0.5 --memory 1.0Gi --min-replicas 0 --max-replicas 3
   ```
   * Health probe(liveness/readiness)는 `/api/health`로 설정한다(포털 또는 YAML `az containerapp update --yaml`).
   * 콜드 스타트가 문제가 되면 `--min-replicas 1`로 올린다.
8. **초기 데이터 시드** (최초 1회)
   ```bash
   az containerapp exec -g $RG -n $APP --command "node prisma/seed.mjs"
   ```
   * 대안: 같은 이미지로 Container Apps Job을 만들어 시드 명령을 수동으로 실행한다.
9. **검증**
   ```bash
   FQDN=$(az containerapp show -g $RG -n $APP --query properties.configuration.ingress.fqdn -o tsv)
   curl https://$FQDN/api/health
   az containerapp logs show -g $RG -n $APP --follow
   ```
   * 브라우저(모바일 포함)로 `https://$FQDN`에 접속해 메인 → 퀴즈 → 결과 → 순위 흐름을 확인한다.
10. **업데이트 배포**
    ```bash
    az acr build -r $ACR -t trivia-web:v2 .
    az containerapp update -g $RG -n $APP --image $ACR.azurecr.io/trivia-web:v2
    ```
    * 새 리비전이 만들어지고, 시작할 때 `migrate deploy`가 자동으로 실행된다.
11. **CD (배포 자동화, 예정):** CI(`.github/workflows/ci.yml`)는 이미 있다. 배포는 GitHub Actions에서 `azure/login`(OIDC)으로 로그인한 뒤 `az acr build`와 `az containerapp update`를 실행한다. `main` 브랜치에 push하면 이미지 태그를 커밋 SHA로 붙여 배포한다.

### 11.3. 리소스 정리
```bash
az group delete -n $RG --yes --no-wait
```

## 12. 구현 로드맵 (Roadmap)
| 단계 | 작업 | 완료 기준 |
|---|---|---|
| 1 | 프로젝트 초기화 (Next.js, TypeScript, Tailwind, ESLint, Prisma, Vitest) | `npm run dev`, `npm run lint` 통과 |
| 2 | Prisma 스키마, 마이그레이션, 40문제 시드 데이터 작성 | `npm run db:seed` 후 카테고리별 10문제씩 조회됨 |
| 3 | 도메인 로직(`src/lib/quiz/*`)과 API Route 구현, 단위 테스트 | 채점·중복 답안(409)·점수 계산 테스트 통과 |
| 4 | 화면 4종(메인/퀴즈/결과/순위), 정/오답 연출(색상·효과음) | 모바일 폭(360px)에서 전체 흐름 동작 |
| 5 | Dockerfile과 compose로 통합 검증, Playwright E2E | `docker compose up` 후 E2E 통과 |
| 6 | Azure ACA 배포 (11장), (선택) CI/CD | 공개 FQDN에서 전체 흐름과 리더보드 등록 확인 |

### 12.1. 예정 npm 스크립트
| 스크립트 | 명령 |
|---|---|
| `dev` | `next dev` |
| `build` | `next build` |
| `start` | `next start` |
| `lint` | `eslint` (ESLint 9 flat config, `next build`에서도 실행됨) |
| `test` | `vitest run` (단일 파일: `npx vitest run tests/unit/scoring.test.ts`) |
| `test:e2e` | `playwright test` |
| `db:migrate` | `prisma migrate dev` |
| `db:seed` | `prisma db seed` (`package.json`의 `prisma.seed`: `node prisma/seed.mjs`) |