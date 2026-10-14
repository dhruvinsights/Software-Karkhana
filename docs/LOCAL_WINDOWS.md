# Running the full workflow on Windows

Unit tests run natively on Windows. The integration tests and the full idea-to-PR flow need
PostgreSQL 16 with **pgvector**, which has no simple Windows installer. The easiest route is
to run Postgres inside **WSL2** (Ubuntu). WSL2 forwards `localhost:5432` to Windows, so the
tests you already run from PowerShell connect to it unchanged.

## 1. If a test seems to hang

Every test now has a 120 s timeout (`pytest-timeout`). A stuck test **fails with a stack trace**
showing the exact line, instead of stalling silently. Please send that trace.

Known cause of a slow *first* test on Windows: `tests/unit/test_evaluator.py` runs first, so it
pays for importing the Google Gen AI SDK (about 3.5 s on Linux). Windows Defender scans every
newly compiled `.pyc`, which can stretch that to 30 s+ on the first run only.

```powershell
uv run pytest tests/unit -vv --durations=10      # which test, how long
uv run python -X importtime -c "import app.ai.evaluator" 2> import-times.txt
uv run pytest tests/unit -q                      # run again: should be a few seconds
```

If the second run is fast, it was the cold import, not a hang.

## 2. PostgreSQL + pgvector in WSL2 (one-time, ~10 min)

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

These are local development passwords only, the same ones CI uses. Production uses Cloud SQL
with IAM login and no app password.

## 3. Run everything from PowerShell

```powershell
cd C:\Users\eskha\Downloads\karkhana\karkhana
uv run pytest -q -rs                       # expect 46 passed, 0 skipped

# Migrate + seed the dev database, then start the app
$env:DATABASE_URL = "postgresql+asyncpg://karkhana_owner:karkhana_owner@localhost:5432/karkhana"
uv run python -m app.scripts.migrate --seed
Remove-Item Env:DATABASE_URL

$env:AUTH_MODE = "dev"; $env:DEMO_FALLBACK = "true"
uv run uvicorn app.fast_api_app:app --port 8080
# open http://localhost:8080 and sign in as any demo role
```

If `uv run pytest` still skips with "local Postgres not available", start Postgres again in
Ubuntu (`sudo service postgresql start`). WSL services stop when WSL shuts down.

## 4. The agent run locally

The worker needs a git remote to clone and the control plane needs one to push to. A local
bare repo works:

```powershell
cd $env:TEMP; Remove-Item -Recurse -Force invoicekit-src, invoicekit.git -ErrorAction SilentlyContinue
Copy-Item -Recurse C:\Users\eskha\Downloads\karkhana\karkhana\demo-repo invoicekit-src
cd invoicekit-src; git init -q -b main; git add -A; git -c user.email=t@t -c user.name=t commit -qm base
git clone -q --bare . ..\invoicekit.git
$env:DEMO_REPO_URL = "file:///$($env:TEMP -replace '\\','/')/invoicekit.git"
```

Then start the app as in step 3 (same terminal) and click **Assign to agent**.

## 5. Browser test of the whole flow

With the app running (steps 3–4), in a second terminal:

```powershell
cd C:\Users\eskha\Downloads\karkhana\karkhana\tests\e2e
npm install; npx playwright install chromium; npm test
```

Expected: every step passes except memory reuse (B3), which needs Vertex AI embeddings.
Screenshots land in `tests\e2e\shots`.

## Alternative: no local database at all

Push the repo to GitHub. `.github/workflows/ci.yml` runs the full suite on PostgreSQL 16 with
pgvector and **fails if any database test is skipped**.
