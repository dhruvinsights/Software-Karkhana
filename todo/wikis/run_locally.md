# Run it locally

```
# database (Postgres, db "karkhana"), migrations as superuser
DATABASE_URL=postgresql+asyncpg://<you>@localhost:5432/karkhana uv run python -m app.scripts.migrate

# backend on :8080
uv run uvicorn app.fast_api_app:app --port 8080 --reload

# frontend on :5173
cd web && npm install && npm run dev
```

Local models: `ollama serve` with `qwen2.5-coder:14b`.

Checks before you push:

```
RESEND_API_KEY= uv run --group dev pytest -q
uv run ruff check app tests scripts
cd web && npx tsc -b && npx vite build
```

Next free migration number: check `db/migrations/` (at the time of writing, `027`).
