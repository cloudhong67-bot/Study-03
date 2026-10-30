-- CreateEnum
CREATE TYPE "QuizMode" AS ENUM ('ALL', 'CATEGORY');

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" SERIAL NOT NULL,
    "category_id" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "answer_index" SMALLINT NOT NULL,
    "explanation" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_sessions" (
    "id" UUID NOT NULL,
    "mode" "QuizMode" NOT NULL,
    "category_id" INTEGER,
    "question_ids" INTEGER[],
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "quiz_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_answers" (
    "session_id" UUID NOT NULL,
    "question_id" INTEGER NOT NULL,
    "selected_index" SMALLINT NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "answered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_answers_pkey" PRIMARY KEY ("session_id","question_id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" SERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "username" VARCHAR(12) NOT NULL,
    "score" INTEGER NOT NULL,
    "max_score" INTEGER NOT NULL,
    "correct_count" INTEGER NOT NULL,
    "total_count" INTEGER NOT NULL,
    "mode" "QuizMode" NOT NULL,
    "category_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "questions_category_id_idx" ON "questions"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "scores_session_id_key" ON "scores"("session_id");

-- CreateIndex
CREATE INDEX "scores_mode_category_id_score_created_at_idx" ON "scores"("mode", "category_id", "score" DESC, "created_at");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_sessions" ADD CONSTRAINT "quiz_sessions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_answers" ADD CONSTRAINT "session_answers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "quiz_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_answers" ADD CONSTRAINT "session_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "quiz_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma 스키마로 표현할 수 없는 제약 (PRD 8.1)
ALTER TABLE "questions" ADD CONSTRAINT "questions_answer_index_check" CHECK ("answer_index" BETWEEN 0 AND 3);
ALTER TABLE "questions" ADD CONSTRAINT "questions_options_count_check" CHECK (cardinality("options") = 4);
ALTER TABLE "quiz_sessions" ADD CONSTRAINT "quiz_sessions_mode_category_check" CHECK (("mode" = 'CATEGORY') = ("category_id" IS NOT NULL));
ALTER TABLE "session_answers" ADD CONSTRAINT "session_answers_selected_index_check" CHECK ("selected_index" BETWEEN 0 AND 3);
ALTER TABLE "scores" ADD CONSTRAINT "scores_mode_category_check" CHECK (("mode" = 'CATEGORY') = ("category_id" IS NOT NULL));
