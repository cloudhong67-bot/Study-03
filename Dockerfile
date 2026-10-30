# syntax=docker/dockerfile:1
# PRD 10.1: 멀티 스테이지 빌드 → Next.js standalone 산출물만 담은 non-root 런타임 이미지

FROM node:22-alpine AS base
# Prisma 엔진(linux-musl-openssl-3.0.x)이 OpenSSL을 필요로 한다.
RUN apk add --no-cache openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1

# ── 의존성 설치 ─────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
# postinstall(prisma generate)은 스키마가 필요하므로 builder 단계에서 직접 실행한다.
RUN npm ci --ignore-scripts --no-audit --no-fund

# ── 빌드 ───────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public \
 && npx prisma generate \
 && npm run build

# ── 런타임 마이그레이션용 Prisma CLI (devDependencies 전체를 싣지 않도록 따로 설치) ──
FROM base AS prisma-cli
WORKDIR /prisma-cli
COPY package-lock.json /tmp/package-lock.json
RUN PRISMA_VERSION="$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version")" \
 && npm init -y > /dev/null \
 && npm install --omit=dev --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
 # migrate deploy는 schema engine만 쓴다. 쿼리 엔진(~17MB)은 앱 쪽 Prisma Client에 이미 있다.
 && rm -f node_modules/@prisma/engines/libquery_engine-*

# ── 런타임 ─────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# node 이미지에 기본으로 있는 non-root 사용자(node, uid 1000)로 실행한다.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# 마이그레이션 SQL, 시드 스크립트·데이터
# (Prisma Client와 musl 쿼리 엔진은 standalone 추적에 이미 포함된다. @prisma/client를 통째로 복사하면
#  사용하지 않는 DB별 wasm 런타임 ~70MB가 함께 들어가므로 복사하지 않는다.)
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=prisma-cli --chown=node:node /prisma-cli/node_modules ./prisma-cli/node_modules
COPY --chown=node:node docker-entrypoint.sh ./

USER node
EXPOSE 3000
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
