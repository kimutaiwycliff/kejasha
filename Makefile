# Kejasha — see CLAUDE.md §9. Targets for later phases print where they land.
SHELL := /bin/bash
-include .env
export

COMPOSE := docker compose -f infra/compose.yml $(if $(wildcard .env),--env-file .env,)
DBMATE  := pnpm exec dbmate --no-dump-schema --migrations-dir infra/migrations

.PHONY: up down restart logs db-migrate db-rollback db-seed db-reset db-shell db-dump \
        dev-reset-limits dev-api dev-worker api-spec spec-check spec-lint client-gen \
        test test-unit test-int test-rls test-journeys test-contract test-e2e \
        typecheck lint build build-image deploy rollback daraja-reregister

up: ## start postgres, redis, minio, create buckets, apply migrations
	$(COMPOSE) up -d --wait postgres redis minio
	$(COMPOSE) exec -T minio sh -c 'mc alias set local http://localhost:9000 "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD" >/dev/null && \
	  mc mb --ignore-existing local/$(or $(S3_BUCKET_FILES),kejasha-files) local/$(or $(S3_BUCKET_BACKUPS),kejasha-backups)'
	$(MAKE) db-migrate

down:
	$(COMPOSE) down

restart: down up

logs:
	$(COMPOSE) logs -f --tail=200

db-migrate:
	$(DBMATE) --url "$(DATABASE_URL)" up

db-rollback:
	$(DBMATE) --url "$(DATABASE_URL)" rollback

db-seed: ## demo landlord + agency via the real API (idempotent)
	pnpm --filter @kejasha/api seed

db-reset: ## local only: recreate the database from migrations
	@if [ "$(NODE_ENV)" = "production" ]; then echo "refusing in production"; exit 1; fi
	$(DBMATE) --url "$(DATABASE_URL)" drop
	$(DBMATE) --url "$(DATABASE_URL)" create
	$(MAKE) db-migrate

db-shell:
	$(COMPOSE) exec postgres psql -U app_owner -d kejasha

db-dump:
	@mkdir -p infra/backups
	$(COMPOSE) exec -T postgres pg_dump -U app_owner -d kejasha -Fc > infra/backups/kejasha-$$(date +%Y%m%d-%H%M%S).dump

dev-reset-limits: ## local only: clear rate-limit counters (e.g. after a contract-test run)
	$(COMPOSE) exec -T redis redis-cli EVAL "for _,k in ipairs(redis.call('keys','kj:rl:*')) do redis.call('del',k) end return 1" 0

dev-api:
	pnpm --filter @kejasha/api dev

dev-worker:
	pnpm --filter @kejasha/worker dev

api-spec:
	pnpm --filter @kejasha/api spec

spec-check:
	pnpm --filter @kejasha/api spec:check

spec-lint:
	pnpm --filter @kejasha/api spec:lint

client-gen:
	pnpm --filter @kejasha/api-client generate

test:
	pnpm test

test-unit:
	pnpm test:unit

test-int:
	pnpm test:int

test-rls:
	pnpm test:rls

test-journeys:
	pnpm test:journeys

API_BASE ?= http://host.docker.internal:4000
# signOut is excluded: fuzzing it would revoke the very token the run authenticates with.
test-contract: ## Schemathesis against a running API (make up, make db-seed, make dev-api first)
	docker run --rm --add-host=host.docker.internal:host-gateway -v "$(CURDIR)/schemathesis.toml:/cfg/schemathesis.toml:ro" \
	  schemathesis/schemathesis:stable --config-file /cfg/schemathesis.toml \
	  run $(API_BASE)/openapi.json --url $(API_BASE) --checks all --max-examples 50 \
	  --exclude-operation-id signOut \
	  $(if $(wildcard apps/api/.seed-token),-H "Authorization: Bearer $$(cat apps/api/.seed-token)",)

test-e2e:
	@echo "test-e2e: Playwright arrives with track W (web), after the contract freeze (ADR-018)"

typecheck:
	pnpm typecheck

lint:
	pnpm lint

build:
	pnpm build

build-image:
	docker build -f apps/api/Dockerfile -t kejasha-api:local .
	docker build -f apps/worker/Dockerfile -t kejasha-worker:local .

deploy rollback:
	@echo "$@: arrives with B7 (hardening & launch)"

daraja-reregister:
	@echo "daraja-reregister: arrives with B3 (payments)"
