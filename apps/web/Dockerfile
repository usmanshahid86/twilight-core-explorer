# Web image — the Next.js explorer UI. Build context is the REPO ROOT (npm workspace), not apps/web:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_BASE_URL=http://localhost:8080 .
#
# ⚠ NEXT_PUBLIC_API_BASE_URL is INLINED AT BUILD TIME. The web client runs in the browser, so this
#   must be the origin the BROWSER uses to reach the API (e.g. http://localhost:8080 locally, or the
#   public API origin on AWS) — NOT the compose-internal `api:8080`. Changing it requires a REBUILD.
#
# Phase-14: switch next.config to `output: 'standalone'` for a slim runtime image. This validation
# image keeps it simple and runs `next start` with the full dependency tree.
FROM node:20-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json              apps/api/package.json
COPY apps/indexer/package.json          apps/indexer/package.json
COPY apps/web/package.json              apps/web/package.json
COPY packages/chain-client/package.json packages/chain-client/package.json
COPY packages/config/package.json       packages/config/package.json
COPY packages/db/package.json           packages/db/package.json
COPY packages/decoder/package.json      packages/decoder/package.json
COPY packages/proto/package.json        packages/proto/package.json
RUN npm ci

COPY . .
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN npm --prefix apps/web run build

ENV NODE_ENV=production
EXPOSE 3000
# `next start -p 3000` (per apps/web/package.json) binds 0.0.0.0 by default.
CMD ["npm", "--prefix", "apps/web", "start"]
