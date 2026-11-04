# Retfast API — developer targets. Requires Go 1.27, sqlc 1.31, PostgreSQL 17/18 + PostGIS, Redis.

DATABASE_URL ?= postgres:///retfast_dev?host=/tmp
REDIS_URL ?= redis://localhost:6379/0
RETFAST_TEST_DATABASE_URL ?= postgres:///retfast_test?host=/tmp
RETFAST_TEST_REDIS_URL ?= redis://localhost:6379/15
VERSION ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
BIN := bin
LDFLAGS := -s -w -X github.com/mdenizay/retfast/services/api/internal/app.Version=$(VERSION)
SIM_PILOTS ?= 20
SIM_PASSWORD ?= Sim-Pilot-Password-2026
SIM_ARGS ?=

export DATABASE_URL REDIS_URL

.PHONY: build test test-integration sqlc sqlc-check migrate migrate-status seed run simulate load lint fmt clean

build: ## build retfast-api and retfast-simulator into ./bin
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(BIN)/retfast-api ./cmd/api
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o $(BIN)/retfast-simulator ./cmd/simulator

test: ## unit tests (integration tests skip without RETFAST_TEST_DATABASE_URL)
	go test ./...

test-integration: ## unit + integration tests against real PostgreSQL and Redis
	RETFAST_TEST_DATABASE_URL="$(RETFAST_TEST_DATABASE_URL)" RETFAST_TEST_REDIS_URL="$(RETFAST_TEST_REDIS_URL)" go test -race -count=1 ./...

sqlc: ## regenerate internal/platform/db/dbq from queries/*.sql
	sqlc generate

sqlc-check: ## fail if generated code is stale
	sqlc diff

migrate: ## apply pending migrations
	go run ./cmd/api migrate up

migrate-status:
	go run ./cmd/api migrate status

seed: ## bootstrap users and the Çameli demo event (idempotent)
	go run ./cmd/api seed

run: ## serve on :8080 (metrics on :9090)
	go run ./cmd/api serve

simulate: ## fly $(SIM_PILOTS) simulated pilots against a local serve (dev: registers sim accounts)
	go run ./cmd/simulator --api http://localhost:8080/api/v1 --pilots $(SIM_PILOTS) --register --password "$(SIM_PASSWORD)" --forward-ip $(SIM_ARGS)

load: ## 60 s load run with WebSocket observers; writes load-report.json
	go run ./cmd/simulator --api http://localhost:8080/api/v1 --pilots $(SIM_PILOTS) --register --password "$(SIM_PASSWORD)" --forward-ip --load --report load-report.json $(SIM_ARGS)

lint: ## gofmt, go vet, sqlc diff
	@test -z "$$(gofmt -l .)" || (gofmt -l . && echo "gofmt: files need formatting" && exit 1)
	go vet ./...
	sqlc diff

fmt:
	gofmt -w .

clean:
	rm -rf $(BIN) load-report.json
