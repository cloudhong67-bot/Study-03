-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- AlterEnum
ALTER TYPE "QuizMode" ADD VALUE 'SPEED';

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM';

-- AlterTable
ALTER TABLE "session_answers" ADD COLUMN     "elapsed_ms" INTEGER,
ADD COLUMN     "hint_used" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timed_out" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "selected_index" DROP NOT NULL;

-- CreateTable
CREATE TABLE "session_question_views" (
    "session_id" UUID NOT NULL,
    "question_id" INTEGER NOT NULL,
    "viewed_at" TIMESTAMPTZ NOT NULL,
    "hint_removed" SMALLINT[] DEFAULT ARRAY[]::SMALLINT[],

    CONSTRAINT "session_question_views_pkey" PRIMARY KEY ("session_id","question_id")
);

-- AddForeignKey
ALTER TABLE "session_question_views" ADD CONSTRAINT "session_question_views_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "quiz_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_question_views" ADD CONSTRAINT "session_question_views_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma가 표현하지 못하는 CHECK 제약 (직접 추가)
-- 시간 초과 답안은 항상 오답이고, 보기를 고르지 않은 답안(selected_index NULL)은 시간 초과일 때만 있다.
ALTER TABLE "session_answers" ADD CONSTRAINT "session_answers_timed_out_check" CHECK (NOT ("timed_out" AND "is_correct"));
ALTER TABLE "session_answers" ADD CONSTRAINT "session_answers_selected_index_null_check" CHECK ("selected_index" IS NOT NULL OR "timed_out");
ALTER TABLE "session_answers" ADD CONSTRAINT "session_answers_elapsed_ms_check" CHECK ("elapsed_ms" >= 0);
-- 50:50 힌트는 0~3 중 보기 2개를 지운다 (안 썼으면 빈 배열).
ALTER TABLE "session_question_views" ADD CONSTRAINT "session_question_views_hint_removed_check"
  CHECK (cardinality("hint_removed") IN (0, 2) AND "hint_removed" <@ ARRAY[0, 1, 2, 3]::SMALLINT[]);
