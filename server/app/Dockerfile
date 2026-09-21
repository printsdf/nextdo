# @nextdo/server — the Hono backend (Node 24).
#
# Build context is the REPO ROOT: the committed workspace lockfile is the
# source of truth for resolution, and @nextdo/server has ZERO workspace
# dependencies, so the filtered install only fetches its own external
# dependencies (hono, @hono/node-server, jose, pg):
#
#   docker build -f server/app/Dockerfile -t nextdo-server .
#
# Run:
#   docker run --rm -p 8787:8787 \
#     -e DATABASE_URL=postgresql://user:pass@host:5432/nextdo \
#     -e NEXTDO_OWNER_TOKEN=... \
#     -e JWT_SECRET=... \
#     nextdo-server
#
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

# Workspace manifests + the committed lockfile (frozen install). All six
# manifests must match pnpm-lock.yaml; only @nextdo/server's dependencies
# are actually fetched.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY server/app/package.json server/app/package.json
RUN pnpm install --frozen-lockfile --filter @nextdo/server

COPY server/app/tsconfig.json server/app/tsconfig.json
COPY server/app/src server/app/src
RUN pnpm --filter @nextdo/server build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
# pnpm's node_modules layout is symlink-relative (server/app/node_modules ->
# /repo/node_modules/.pnpm), so both trees keep their relative positions.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/server/app ./server/app
USER node
EXPOSE 8787
CMD ["node", "server/app/dist/index.js"]
