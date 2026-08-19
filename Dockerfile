# syntax=docker/dockerfile:1

# ---- deps: 依存だけ先に入れて層キャッシュを効かせる ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: アプリをビルドし .next/standalone を生成 ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma Client を生成（@prisma/client の型・クエリエンジンを node_modules/.prisma へ出力）。
# schema の binaryTargets により linux-musl-arm64 のエンジンも取得される。
RUN npx prisma generate
# 設定はすべて実行時の環境変数から読むため、ビルド時の build-arg は不要
RUN npm run build

# ---- runner: 本番実行用の最小イメージ ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Prisma のクエリエンジン(linux-musl)は openssl を必要とする
RUN apk add --no-cache openssl
# 非 root ユーザで実行する
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# standalone 出力に含まれない public / static を個別にコピーする
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Prisma の生成物（クエリエンジン含む）を standalone の node_modules に確実に含める
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -T 5 -O /dev/null \
    --header="x-mono-log-origin-verify: ${CLOUDFRONT_ORIGIN_VERIFY_SECRET}" \
    http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
