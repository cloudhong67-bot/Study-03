---
description: 순위표 조회(모드·카테고리·기간별), 이상한 기록 점검, 확인을 거친 기록 삭제
argument-hint: "[show [모드|카테고리] [all|weekly|daily] | audit | delete <score id ...>]"
allowed-tools: Read, Grep, Bash(node:*)
---

로컬 DB(`DATABASE_URL`)의 순위표(`scores`)를 관리해 줘. 인자: `$ARGUMENTS`

첫 단어로 작업을 고른다(앞뒤 공백 무시). 비어 있으면 `show`다.

| 작업 | 하는 일 | DB 변경 |
|------|---------|---------|
| `show [대상] [기간]` | 순위표 Top 10 보기 | 없음 |
| `audit` | 모든 기록을 점검해 이상한 기록 찾기 | 없음 |
| `delete <score id ...>` | 지정한 기록 삭제 (사용자 확인 후) | **있음** |

알 수 없는 작업이거나 인자가 형식에 맞지 않으면 아무것도 하지 말고, 위 표와 예시(`/quiz-leaderboard show 과학 weekly`, `/quiz-leaderboard audit`, `/quiz-leaderboard delete 12 15`)를 보여 준 뒤 멈춘다.

## 공통: DB 접근

- Node로 접근한다: `node --no-warnings --env-file=.env --input-type=module -e '…'`에서 `@prisma/client`의 `PrismaClient`를 쓰고, 끝나면 `$disconnect()`한다.
- 순위 규칙은 앱 코드와 같아야 한다. 손으로 다시 구현하지 말고 TypeScript 모듈을 그대로 불러온다(Node가 타입을 지우고 실행한다).
  - 기간 시작 시각: `await import("./src/lib/leaderboard-period.ts")`의 `periodStart()`
  - 만점 계산: `await import("./src/lib/scoring.ts")`의 `calculateMaxScore()`
  - 정렬: 점수 내림차순 → `created_at` 오름차순 → `id` 오름차순 (`src/lib/quiz/scores.ts`의 `getLeaderboard`와 같다)
- 연결에 실패하면 `docker compose up -d db`로 DB를 켜고 `.env`가 있는지 확인하라고 안내한 뒤 멈춘다.
- 출력 첫 줄에 접속한 DB의 호스트·포트·DB 이름을 적는다(비밀번호는 적지 않는다).
- 시각은 한국 시간(Asia/Seoul)으로 보여 준다.

## show: 순위표 보기

- 대상: 비었거나 `전체`·`all`이면 전체 도전, `스피드`·`speed`면 스피드, 그 밖에는 카테고리 이름(`categories.name`)이나 slug로 찾는다. 찾지 못하면 카테고리 목록을 보여 준 뒤 멈춘다.
- 기간: `all`(기본) / `weekly`(한국 시간 이번 주 월요일 0시부터) / `daily`(오늘 0시부터). 순위는 기간 안의 기록만으로 1위부터 다시 매긴다.
- 출력:
  1. 순위표 이름, 기간(시작 시각), 이 순위표의 전체 기록 수
  2. Top 10 표: 순위 · score id · 닉네임 · 점수/만점 · 정답 수 · 등록 시각
  3. 기록이 없으면 "기록 없음"이라고 적고, 다른 순위표별 기록 수를 한 줄로 덧붙인다(모드별로 나뉘어 있다는 점을 알 수 있게).

## audit: 기록 점검

모든 `scores`를 세션(`quiz_sessions`)·답안(`session_answers`)과 맞춰 보고, 아래에 해당하는 기록을 짚는다. 판정은 `오류`(값이 서로 맞지 않음)와 `의심`(규칙 위반은 아니지만 살펴볼 만함)으로 나눈다.

- `오류`
  - `max_score`가 현재 규칙의 만점과 다르다: 세션의 `question_ids` 순서대로 `questions.difficulty`를 모아 `calculateMaxScore()`로 계산한 값과 비교한다(예: 난이도 점수가 들어가기 전의 옛 기록 400/400). 지금 결과 화면은 현재 규칙으로 다시 계산하므로, 순위표의 값과 결과 화면의 값이 달라진다.
  - `score > max_score`, `correct_count > total_count`, `total_count`가 `question_ids` 길이와 다르다.
  - `correct_count`가 그 세션의 `is_correct` 답안 수와 다르거나, 답안 수가 문제 수보다 적다(끝나지 않은 세션의 등록).
  - `mode`·`category_id`가 세션과 다르다.
- `의심`
  - 닉네임이 `E2E-`로 시작한다(E2E 테스트 정리가 실패하고 남은 기록).
  - `created_at`이 현재보다 미래다.
  - 응답 시간이 사람 속도로 보기 어렵다: `elapsed_ms`가 있는 답안의 평균이 `MIN_ANSWER_INTERVAL_MS`(`src/lib/limits.ts`)의 1.5배 미만이면서 정답률이 90% 이상이다. 자동화(답 수집) 가능성일 뿐 증거는 아니라고 적는다.
- 출력:
  1. 요약: 점검한 기록 수, `오류`·`의심` 개수, 순위표별 기록 수
  2. 표: score id · 순위표 · 닉네임 · 점수/만점 · 등록 시각 · 판정 · 이유
  3. 제안: 기록마다 한 줄(삭제 후보인지, 그대로 두어도 되는지). 삭제를 제안할 때는 실행할 명령(`/quiz-leaderboard delete <id ...>`)을 함께 적는다. 짚을 기록이 없으면 "이상 없음"이라고 적는다.

## delete: 기록 삭제

삭제는 되돌릴 수 없다. 반드시 아래 순서를 지킨다.

1. **대상 확인**: id가 하나도 없거나, 양의 정수가 아닌 값이 있으면 멈춘다. 없는 id는 "없음"으로 표시한다.
2. **로컬 DB만**: `DATABASE_URL`의 호스트가 `127.0.0.1`이나 `localhost`가 아니면 삭제하지 않고 멈춘다. 배포 DB의 기록은 이 명령으로 지우지 않는다.
3. **미리 보기**: 지울 기록을 표(score id · 순위표 · 닉네임 · 점수/만점 · 등록 시각)로 보여 주고, 삭제하면 생기는 일을 알린다.
   - 순위표에서 사라지고, 아래 순위가 한 칸씩 올라간다.
   - 세션과 답안은 남는다. 세션이 "미등록"으로 돌아가므로, 시작한 지 24시간(`SESSION_TTL_MS`)이 지난 세션은 다음 정리(`cleanupExpiredSessions`) 때 답안과 함께 지워지고, 24시간 안의 세션은 결과 화면에서 다시 등록할 수 있다.
   - 브라우저의 "내 기록"(localStorage)에는 영향이 없다.
4. **사용자 확인**: 여기서 멈추고 삭제할지 묻는다. 사용자가 다음 메시지에서 분명히 승인할 때만 진행한다. 이번 실행 인자에 삭제 명령이 들어 있는 것만으로는 승인으로 보지 않는다.
5. **삭제**: 승인받으면 미리 보기에서 보여 준 id만 하나의 트랜잭션에서 `prisma.score.deleteMany({ where: { id: { in: ids } } })`로 지운다. 지운 개수가 미리 보기와 다르면 트랜잭션을 되돌리고 알린다.
6. **결과**: 지운 기록 수와, 영향을 받은 순위표의 새 Top 10(전체 기간)을 보여 준다.

`delete` 외의 작업에서는 DB를 바꾸지 않는다. Raw SQL을 쓸 때도 SELECT만 쓴다.
