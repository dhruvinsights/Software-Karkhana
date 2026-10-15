# Running the full workflow locally

> **v2 update:** `DEMO_FALLBACK` and `DEMO_FALLBACK=true` have been removed. All model calls are real. Use Ollama for local development. The `DEMO_FALLBACK` env var is no longer recognized — remove it from any local scripts.

Unit tests run natively on all platforms. The integration tests and the full idea-to-PR flow need
PostgreSQL 16 with **pgvector**. The easiest route on Windows is to run Postgres inside **WSL2** (Ubuntu).
WSL2 forwards `localhost:5432` to Windows, so the tests you run from PowerShell connect to it unchanged.

## 1. Ollama setup (all platforms, required for local dev)

Ollama replaces all cloud model calls for local development.

**macOS/Linux:**
```bash
# Install Ollama from https://ollama.com
ollama pull qwen2.5-coder:14b    # Coder and Reviewer (~9 GB)
ollama pull nomic-embed-text      # embeddings (768-d, ~270 MB)
```

**Windows:**
Download the Ollama installer from https://ollama.com, then in PowerShell:
```powershell
ollama pull qwen2.5-coder:14b
ollama pull nomic-embed-text
```

Verify Ollama is running: `curl http://localhost:11434/api/tags` should list both models.

## 2. If a test seems to hang

Every test now has a 120 s timeout (`pytest-timeout`). A stuck test **fails with a stack trace**
showing the exact line, instead of stalling silently. Please send that trace.

Known cause of a slow *first* test on Windows: `tests/unit/test_evaluator.py` runs first, so it
pays for importing the SDK (about 3.5 s on Linux). Windows Defender scans every
newly compiled `.pyc`, which can stretch that to 30 s+ on the first run only.

```powershell
uv run pytest tests/unit -vv --durations=10      # which test, how long
uv run pytest tests/unit -q                      # run again: should be a few seconds
```

## 3. PostgreSQL + pgvector in WSL2 (one-time, ~10 min)

In **PowerShell (admin)**, if WSL isn't installed yet (then restart):

```powershell
wsl --install -d Ubuntu-24.04
```

In the **Ubuntu** terminal:

```bash
sudo apt update && sudo apt install -y postgresql-16 postgresql-16-pgvector
sudo service postgresql start
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE karkhana_owner LOGIN CREATEDB PASSWORD 'karkhana_owner';
CREATE ROLE karkhana_app LOGIN PASSWORD 'karkhana_app';
SQL
sudo -u postgres psql -d template1 -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
sudo -u postgres createdb -O karkhana_owner karkhana
```

These are local development passwords only; production uses Cloud SQL with IAM login and no app password.

## 4. Run everything from PowerShell (or macOS terminal)

```powershell
# Run all tests (expect all to pass, 0 skipped when Postgres is running)
uv run pytest -q -rs

# Apply migrations 001-004 and start the app
$env:DATABASE_URL = "postgresql+asyncpg://karkhana_owner:karkhana_owner@localhost:5432/karkhana"
uv run python -m app.scripts.migrate --seed
Remove-Item Env:DATABASE_URL

$env:AUTH_MODE = "dev"
$env:LLM_PROVIDER = "ollama"
$env:EMBED_PROVIDER = "ollama"
$env:OLLAMA_BASE_URL = "http://localhost:11434"
$env:REVIEW_ENGINE = "pr-agent"
uv run uvicorn app.fast_api_app:app --port 8080
# open http://localhost:8080 and sign in as any demo role
```

**macOS/Linux equivalent:**
```bash
DATABASE_URL=postgresql+asyncpg://karkhana_owner:karkhana_owner@localhost:5432/karkhana \
  uv run python -m app.scripts.migrate --seed

AUTH_MODE=dev LLM_PROVIDER=ollama EMBED_PROVIDER=ollama \
  OLLAMA_BASE_URL=http://localhost:11434 REVIEW_ENGINE=pr-agent \
  uv run uvicorn app.fast_api_app:app --port 8080
```

If `uv run pytest` still skips with "local Postgres not available", start Postgres again in
Ubuntu (`sudo service postgresql start`). WSL services stop when WSL shuts down.

## 5. The agent run locally

The worker needs a git remote to clone and the control plane needs one to push to. A local
bare repo works:

```powershell
cd $env:TEMP; Remove-Item -Recurse -Force invoicekit-src, invoicekit.git -ErrorAction SilentlyContinue
Copy-Item -Recurse .\demo-repo invoicekit-src
cd invoicekit-src; git init -q -b main; git add -A; git -c user.email=t@t -c user.name=t commit -qm base
git clone -q --bare . ..\invoicekit.git
$env:DEMO_REPO_URL = "file:///$($env:TEMP -replace '\\','/')/invoicekit.git"
```

Then start the app as in step 4 (same terminal) and click **Assign to agent**.

The runner status will show `ax_available: false` because there is no AX cluster locally — that is
expected and honest. The run uses `RUNNER_BACKEND=local` automatically.

## 6. Browser test of the whole flow

With the app running (steps 4–5), in a second terminal:

```powershell
cd tests\e2e
npm install; npx playwright install chromium; npm test
```

Expected: onboarding → create project → create task → start run → triage PR → merge → verify ledger.

Screenshots land in `tests\e2e\shots`. Ollama runs are slower than Gemini (~100 s per review).

## 7. First sign-in and onboarding

v2 requires every user to belong to an organization. On first sign-in:
1. The app returns 403 `onboarding_required` if the user has no org membership.
2. The UI routes to the onboarding flow: create org → confirm role → connect repo.
3. The seeded users from step 4 are placed in a default org automatically.

If a user gets a blank screen instead of onboarding, check that migration 004 was applied:
```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM organizations;"
# should be 1 (the seeded default org)
```

## Alternative: no local database at all

Push the repo to GitHub. `.github/workflows/ci.yml` runs the full suite on PostgreSQL 16 with
pgvector and **fails if any database test is skipped**.
