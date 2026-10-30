-- CreateIndex
CREATE INDEX "quiz_sessions_question_ids_idx" ON "quiz_sessions" USING GIN ("question_ids");

-- 세션이 참조하는 문제는 지우거나 id를 바꿀 수 없다.
-- question_ids는 배열이라 외래 키를 걸 수 없어 트리거로 강제한다. 막지 않으면 결과 화면과 점수 등록의
-- 만점이 어긋나고, 진행 중인 세션은 사라진 문제에 답할 수 없어 끝낼 수 없게 된다.
CREATE FUNCTION "prevent_orphaning_session_questions"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "quiz_sessions" WHERE "question_ids" @> ARRAY[OLD."id"]) THEN
    RAISE EXCEPTION 'quiz session references question % (cannot delete or change its id)', OLD."id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "questions_protect_referenced_delete"
  BEFORE DELETE ON "questions"
  FOR EACH ROW EXECUTE FUNCTION "prevent_orphaning_session_questions"();

CREATE TRIGGER "questions_protect_referenced_id_change"
  BEFORE UPDATE OF "id" ON "questions"
  FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id")
  EXECUTE FUNCTION "prevent_orphaning_session_questions"();
