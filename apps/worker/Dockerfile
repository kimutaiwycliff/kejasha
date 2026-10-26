# syntax=docker/dockerfile:1.7
# Build from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:22-alpine AS build
ENV HUSKY=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kejasha/worker build \
 && pnpm --filter @kejasha/worker deploy --prod /out \
 && cp -r apps/worker/dist /out/dist

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# pg_dump for the nightly backup (must match the server's major version: Postgres 17).
RUN apk add --no-cache postgresql17-client
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node

CMD ["node", "--enable-source-maps", "dist/main.js"]
