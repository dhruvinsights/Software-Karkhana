#!/bin/bash
# Boots a throwaway database + the real server, runs the e2e journey, always cleans up.
set -u
PY=$HOME/venv-karkhana/bin/python
PG=$HOME/pgvenv/lib/python3.12/site-packages/pgserver/pginstall/bin
export AUTH_MODE=dev RUNNER_BACKEND=local RUN_HMAC_SECRET=e2e-secret STATIC_DIR=/nonexistent
export GOOGLE_CLOUD_PROJECT=e2e DEV_OTP_CODE=424242 MAX_ACTIVE_RUNS_PER_PROJECT=3
unset K_SERVICE GITHUB_REPO GITHUB_TOKEN RESEND_API_KEY
cd "$HOME/mnt/Software-Karkhana_dhruv"
$PG/psql -h localhost -U postgres -d postgres -qc "DROP DATABASE IF EXISTS karkhana_e2e WITH (FORCE)" -c "CREATE DATABASE karkhana_e2e" 2>&1 | tail -1
$PG/psql -h localhost -U postgres -d karkhana_e2e -qc "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;" 2>&1 | tail -1
DATABASE_URL="postgresql+asyncpg://karkhana_owner:karkhana_owner@localhost:5432/karkhana_e2e" $PY -m app.scripts.migrate --app-role karkhana_app 2>&1 | tail -3
export DATABASE_URL="postgresql+asyncpg://karkhana_app:karkhana_app@localhost:5432/karkhana_e2e"
$PY -m uvicorn app.fast_api_app:app --port 8099 --log-level warning > $HOME/e2e-server.log 2>&1 &
SERVER=$!
for i in $(seq 1 40); do curl -sf localhost:8099/healthz >/dev/null && break; sleep 1; done
echo "healthz: $(curl -s localhost:8099/healthz)"
$PY $HOME/tools/e2e.py
RC=$?
kill $SERVER 2>/dev/null
exit $RC
