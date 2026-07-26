# Cloud Run Job としてバッチ(fetch-daily-batch)を実行するためのイメージ。
# HTTPサーバーは持たない、実行して終了するバッチ用コンテナ。

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# prisma generate の生成物は本番用の依存関係インストールでは作られないため、
# build ステージから上書きコピーする。
# node:22-slim に標準で用意されている非rootユーザー "node"(uid/gid 1000)が
# /app を読めるように、コピー時点で所有者を切り替えておく。
COPY --from=build --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/dist ./dist

USER node
CMD ["node", "dist/scripts/fetch-daily-batch.js"]
