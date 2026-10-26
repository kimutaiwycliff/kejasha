# syntax=docker/dockerfile:1.7
# Static docs site (ADR-020). Build from the repo root: docker build -f apps/docs/Dockerfile .
FROM node:22-alpine AS build
ENV HUSKY=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @kejasha/docs...
RUN pnpm --filter @kejasha/docs build

FROM caddy:2-alpine
COPY apps/docs/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/docs/out /srv
EXPOSE 80
