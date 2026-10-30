#!/bin/sh
# PRD 10.2: 대기 중인 마이그레이션을 적용한 뒤 Next.js 서버를 시작한다.
# migrate deploy는 advisory lock을 잡으므로 replica가 동시에 떠도 안전하다.
set -e

# 앱이 DB보다 먼저 뜨거나(Azure PostgreSQL 재시작·네트워크 일시 장애) DB가 아직 연결을 받지 않으면
# 한 번 실패로 컨테이너가 죽어 재시작을 반복하지 않도록, 간격을 늘려 가며 다시 시도한다.
# 끝내 실패하면 0이 아닌 코드로 종료해 오케스트레이터(compose/ACA)가 실패를 알 수 있게 한다.
MIGRATE_MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-5}"
attempt=1
echo "[entrypoint] prisma migrate deploy"
until node ./prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema ./prisma/schema.prisma; do
  if [ "$attempt" -ge "$MIGRATE_MAX_ATTEMPTS" ]; then
    echo "[entrypoint] migrate deploy failed after ${attempt} attempts; exiting" >&2
    exit 1
  fi
  delay=$((attempt * 3))
  echo "[entrypoint] migrate deploy failed (attempt ${attempt}/${MIGRATE_MAX_ATTEMPTS}); retrying in ${delay}s" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done

# 로컬 compose처럼 RUN_SEED=true일 때만 시드한다 (upsert라 여러 번 실행해도 안전).
# ACA에서는 최초 1회 수동으로 실행한다 (PRD 11.2 8단계).
if [ "$RUN_SEED" = "true" ]; then
  echo "[entrypoint] seeding questions"
  node ./prisma/seed.mjs
fi

echo "[entrypoint] starting Next.js on ${HOSTNAME}:${PORT}"
exec node server.js
