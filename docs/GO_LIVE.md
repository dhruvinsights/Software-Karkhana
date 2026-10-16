# Go-live checklist

> **v2 update:** `DEMO_FALLBACK` has been removed. All model calls are real. Use `LLM_PROVIDER=ollama` for local development and `LLM_PROVIDER=gemini` for production. The `make deploy-demo` target is gone; use `make deploy` only.

Goal: a public Cloud Run URL where you sign in with Google, create an org, invite a teammate and see a live Gemini evaluation backed by real data.

## Two layers: bootstrap once, deploy every time

| | `infra/bootstrap.sh` | `make deploy` (`cloudbuild.yaml`) |
|---|---|---|
| What | Foundation: project, APIs, service accounts + IAM, Cloud SQL, secrets, buckets, Artifact Registry | The app: image build, DB migrations 001–004, worker Job, API service |
| When | Once per project, and again only when the foundation changes (new secret value, role, API) | After bootstrap, and on every code change |
| Safe to re-run | Yes, every step checks before it creates | Yes, every deploy is create-or-update |

Bootstrap never deploys the app, so a project that has only been bootstrapped serves nothing.
CI (`.github/workflows/ci.yml`) tests and builds but does not deploy.

## 1. Demo repo on GitHub (5 min, anyone)

```bash
cd demo-repo && git init -b main && git add -A && git commit -m "invoicekit"
gh repo create <you>/invoicekit --public --source . --push
```

The repo is **public on purpose**: the worker clones it without credentials, because
it runs untrusted test code and holds no GitHub token. Only the control plane gets the token.

Create a **fine-grained token** scoped to that one repo with *Contents: read and write*,
*Pull requests: read and write* and *Commit statuses: read and write*.

## 2. Ollama (local dev only)

For local development you need Ollama running:

```bash
ollama pull qwen2.5-coder:14b    # Coder and Reviewer
ollama pull nomic-embed-text      # embeddings (768-d)
```

Set `LLM_PROVIDER=ollama EMBED_PROVIDER=ollama OLLAMA_BASE_URL=http://localhost:11434`.

In production, Gemini is used exclusively. Ollama is never exposed to the public internet.

## 3. GCP bootstrap (one command, ~15 min)

```bash
gcloud auth login && gcloud auth application-default login
PROJECT_ID=karkhana-<suffix> BILLING_ACCOUNT=<id> GITHUB_TOKEN=<token> ./infra/bootstrap.sh
```

Already bootstrapped with an older version of the script? Re-run it once: it adds the
`karkhana-build` service account and the source bucket that `make deploy` uses, turns on
Cloud SQL deletion protection, and adds the new Secret Manager entries for v2 (`LLM_PROVIDER`,
`EMBED_PROVIDER`, `REVIEW_ENGINE`).

## 4. Firebase Auth (5 min, console)

1. console.firebase.google.com → Add project → choose the same project id.
2. Authentication → Sign-in method → enable **Google** and **Email/Password**.
3. Authentication → Settings → Authorized domains → add `karkhana-<PROJECT_NUMBER>.us-central1.run.app`.
4. Project settings → add a Web app → copy `apiKey`, then:
   `FIREBASE_WEB_API_KEY=<apiKey> PROJECT_ID=<id> ./infra/bootstrap.sh` (re-run is safe).

## 5. Confirm the model (2 min)

```bash
GOOGLE_CLOUD_PROJECT=<id> make check-models
```

Use the first `OK` line as `_GEMINI_MODEL`.

## 6. Deploy (~8 min)

```bash
make deploy PROJECT_ID=<id> GITHUB_REPO=<you>/invoicekit \
  LLM_PROVIDER=gemini EMBED_PROVIDER=gemini REVIEW_ENGINE=pr-agent \
  SEED_USERS="alice@gmail.com:pm,bob@gmail.com:director,carol@gmail.com:developer,dave@gmail.com:lead"
```

`make deploy` runs migrations 001–004 (including the new `organizations`, `memberships`,
`invitations`, `context_entries`, `model_usage`, `audit_events` tables) before the API is
promoted to traffic. Smoke tests `/healthz` and `/api/config`; automatic rollback on failure.

`SEED_USERS` only adds users or changes roles; leaving it out on later deploys removes nobody.
Seeded users are placed in a default org so they can sign in immediately.

## 7. Exit test on the public URL

- [ ] Each teammate signs in with Google and lands with the right role.
- [ ] First sign-in routes to onboarding; user creates an org or joins via invitation.
- [ ] PM submits a task and the evaluation runs through Gemini (not a cached fallback — the response shows `model: gemini-...`).
- [ ] A non-director gets 403 from approve: open devtools and
      `fetch('/api/projects/<id>/approve',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{"decision":"approved"}'})`.
- [ ] Ledger at the bottom → **Verify chain** says verified.
- [ ] `python -m app.scripts.anchor_ledger` writes one object per chain to `gs://<project>-karkhana-ledger-anchors`, and `--verify` passes (see `docs/LEDGER.md`).
- [ ] Director approves; Developer clicks **Assign to agent**; a real PR appears on GitHub with a `karkhana/tests` status.
- [ ] `GET /api/providers/health` returns Gemini `configured=true`, `runner_status` is honest (shows `ax_available: false` if no cluster).
- [ ] `GET /api/nav` returns only the pages for the signed-in role.

## If something fails

| Symptom | Fix |
|---|---|
| Deploy step `migrate` fails on `CREATE EXTENSION vector` | `karkhana_owner` must be created with `gcloud sql users create` (it gets `cloudsqlsuperuser`). Re-run bootstrap. |
| `gcloud builds submit` fails with `karkhana-build ... does not exist` or a bucket error | Bootstrap predates the build service account. Re-run `infra/bootstrap.sh`. |
| API fails to start: `TOKEN_ENCRYPTION_KEYS must come from Secret Manager` | Bootstrap predates token encryption. Re-run `infra/bootstrap.sh` (creates `token-encryption-keys`), then deploy. Then run `python -m app.scripts.reencrypt_tokens` once as `karkhana_owner` to encrypt any older plaintext rows. |
| Build fails at `preflight` | `GITHUB_REPO` was empty. Pass `GITHUB_REPO=owner/invoicekit`. |
| Deploy warns `firebase-web-api-key has no value yet` | Step 4, then deploy again. |
| `remaining connection slots are reserved` in logs | Too many API instances for `db-g1-small`. Keep `_MAX_INSTANCES` at 3, or bootstrap with `SQL_TIER=db-custom-1-3840`. |
| 403 "no Karkhana role yet" | User has no org membership. Ask them to sign in and go through onboarding, or add them to `SEED_USERS` and re-deploy. |
| Sign-in popup "unauthorized domain" | Step 4.3. |
| Evaluation shows "model unavailable" | Gemini call failed. Check Cloud Logging and `make check-models`. |
| Run stuck on "running" | Cloud Logging → Cloud Run Jobs → `karkhana-worker`. After 10 min without a heartbeat the run is marked `timed_out`. Set `RUNNER_BACKEND=local` on the service as the on-stage fallback. |
| `GET /api/runner/status` shows `ax_available: false` | Expected if no AX cluster is configured. The UI shows "AX not connected" — this is honest, not an error. |
| Onboarding page loops after org creation | Check that migration 004 was applied: `SELECT COUNT(*) FROM organizations;` should be `1`. |
