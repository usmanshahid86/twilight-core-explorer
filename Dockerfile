# Backend image — the indexer, the API, and the one-shot `prisma migrate deploy` all run from this
# single build (same monorepo, different start commands), mirroring how they deploy SEPARATELY on AWS
# (runbook §10: indexer = always-on task, API = service behind an ALB). Web has its own image.
#
# Build context is the repo root (npm workspaces). Phase-14 can slim this with a multi-stage prune;
# for the validation deploy we deliberately favor one reliable image over a lean-but-fiddly one.
FROM node:20-bookworm-slim

# Tools the runtime needs: curl + jq for the tick script's RPC polling; openssl for the Prisma query
# engine. bash is already in the Debian base. ca-certificates for HTTPS to a future TLS devnet.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl jq openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) Dependency layer — copy ONLY the manifests first so `npm ci` is cached across source-only edits.
#    Every workspace listed in the root package.json `workspaces` must be present for `npm ci` to
#    resolve the lockfile.
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

# 2) Source + build. We build only the backend workspaces (the indexer's `prebuild` already builds
#    chain-client/config/db/decoder + runs db:generate; the api's prebuild builds db + db:generate).
#    The Prisma client is generated INSIDE the image for this platform — never reuse a host client.
COPY . .
RUN npm run db:generate \
 && npm --prefix apps/indexer run build \
 && npm --prefix apps/api run build \
 && chmod +x scripts/devnet/run-indexer-tick.sh

# Default command; docker-compose overrides per service (migrate / indexer tick loop / api).
CMD ["node", "apps/api/dist/index.js"]
