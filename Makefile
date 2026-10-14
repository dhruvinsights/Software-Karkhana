# Software Karkhana: common tasks. Run `make help`.
.PHONY: help install db-local migrate seed dev web test lint check-models playground deploy deploy-demo e2e

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  %-14s %s\n", $$1, $$2}'

install: ## Install Python and web dependencies
	uv sync
	cd web && npm ci

db-local: ## Create local Postgres roles and database (needs Postgres 16 + pgvector)
	sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$$\$$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='karkhana_owner') THEN CREATE ROLE karkhana_owner LOGIN CREATEDB PASSWORD 'karkhana_owner'; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='karkhana_app') THEN CREATE ROLE karkhana_app LOGIN PASSWORD 'karkhana_app'; END IF; END \$$\$$;"
	sudo -u postgres psql -d template1 -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
	sudo -u postgres createdb -O karkhana_owner karkhana || true

migrate: ## Apply migrations locally as the schema owner and seed demo users
	DATABASE_URL=postgresql+asyncpg://karkhana_owner:karkhana_owner@localhost:5432/karkhana uv run python -m app.scripts.migrate --seed

dev: ## Run the API on :8080 (dev auth, cached Gemini fallback on)
	AUTH_MODE=dev DEMO_FALLBACK=true uv run uvicorn app.fast_api_app:app --port 8080 --reload

web: ## Run the React dev server on :5173 (proxies /api to :8080)
	cd web && npm run dev

test: ## Unit + integration tests (integration needs `make db-local`)
	uv run --group dev pytest -q

lint: ## ruff + codespell + TypeScript
	uv run --group dev ruff check app tests
	uv run --group dev ruff format --check app tests
	uv run --group dev codespell
	cd web && npx tsc -b

check-models: ## Phase 0: which Gemini models can this project call?
	uv run python -m app.scripts.check_models

playground: ## Agent Starter Pack playground for the ADK Coder (adk web)
	uv run adk web . --port 8501 --reload_agents

deploy: ## Build and deploy with live models only (no cached fallbacks)
	gcloud builds submit --config cloudbuild.yaml --substitutions=_GITHUB_REPO=$(GITHUB_REPO),_SEED_USERS=$(SEED_USERS)

deploy-demo: ## Same as deploy, with labelled cached fallbacks on (stage safety net)
	gcloud builds submit --config cloudbuild.yaml --substitutions=_GITHUB_REPO=$(GITHUB_REPO),_SEED_USERS=$(SEED_USERS),_DEMO_FALLBACK=true

e2e: ## Browser test of the golden path against a running app (KARKHANA_URL)
	cd tests/e2e && npm install && npm test
