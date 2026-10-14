# Go-live checklist (tonight)

Goal: a public Cloud Run URL where you sign in with Google, submit an idea and
see a live Gemini evaluation. Owner: infra person. About 45 minutes, most of it
waiting for Cloud SQL.

## Two layers: bootstrap once, deploy every time

| | `infra/bootstrap.sh` | `make deploy` / `make deploy-demo` (`cloudbuild.yaml`) |
|---|---|---|
| What | Foundation: project, APIs, service accounts + IAM, Cloud SQL, secrets, buckets, Artifact Registry | The app: image build, DB migration + seed, worker Job, API service |
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

## 2. GCP bootstrap (one command, ~15 min)

```bash
gcloud auth login && gcloud auth application-default login
PROJECT_ID=karkhana-<suffix> BILLING_ACCOUNT=<id> GITHUB_TOKEN=<token> ./infra/bootstrap.sh
```

Already bootstrapped with an older version of the script? Re-run it once: it adds the
`karkhana-build` service account and the `<project>-karkhana-build` source bucket that
`make deploy` now uses, and turns on Cloud SQL deletion protection.

## 3. Firebase Auth (5 min, console)

1. console.firebase.google.com → Add project → choose the same project id.
2. Authentication → Sign-in method → enable **Google** and **Email/Password**.
3. Authentication → Settings → Authorized domains → add `karkhana-<PROJECT_NUMBER>.us-central1.run.app`.
4. Project settings → add a Web app → copy `apiKey`, then:
   `FIREBASE_WEB_API_KEY=<apiKey> PROJECT_ID=<id> ./infra/bootstrap.sh` (re-run is safe).

## 4. Confirm the model (2 min)

```bash
GOOGLE_CLOUD_PROJECT=<id> make check-models
```

Gemini 2.5 retires on 16 Oct 2026, mid-hackathon. Use the first `OK` line as `_GEMINI_MODEL`.

## 5. Deploy (~8 min)

```bash
make deploy-demo PROJECT_ID=<id> GITHUB_REPO=<you>/invoicekit \
  SEED_USERS="alice@gmail.com:pm,bob@gmail.com:director,carol@gmail.com:developer,dave@gmail.com:lead"
```

`deploy-demo` turns on the labelled cached fallbacks as a stage safety net; plain
`make deploy` keeps them off. Always deploy through `make`: it passes the build service
account, the source bucket and the `^|^`-delimited substitutions (`SEED_USERS` contains commas,
which a plain `gcloud builds submit --substitutions=...` would split). This builds the image, runs migrations and seeds users (Cloud Run Job), deploys
the worker (Cloud Run Job) and then the API (Cloud Run). Re-run it for every change. `SEED_USERS` only
adds users or changes roles; leaving it out on later deploys removes nobody.

## 6. Exit test on the public URL

- [ ] Each teammate signs in with Google and lands with the right role.
- [ ] PM submits the "Invoice discount codes" idea from `app/ai/fallbacks/demo_ideas.json`.
- [ ] The evaluation shows the model id, **not** "cached-fallback".
- [ ] A non-director gets 403 from approve: open devtools and
      `fetch('/api/projects/<id>/approve',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{"decision":"approved"}'})`.
- [ ] Ledger at the bottom → **Verify chain** says verified.
- [ ] Director approves; Developer clicks **Assign to agent**; a real PR appears on GitHub with a
      `karkhana/tests` status.

## If something fails

| Symptom | Fix |
|---|---|
| Deploy step `migrate` fails on `CREATE EXTENSION vector` | `karkhana_owner` must be created with `gcloud sql users create` (it gets `cloudsqlsuperuser`). Re-run bootstrap. |
| `gcloud builds submit` fails with `karkhana-build ... does not exist` or a bucket error | Bootstrap predates the build service account. Re-run `infra/bootstrap.sh`. |
| Build fails at `preflight` | `GITHUB_REPO` was empty. Pass `GITHUB_REPO=owner/invoicekit`. |
| Deploy warns `firebase-web-api-key has no value yet` | Step 3.4, then deploy again. |
| `remaining connection slots are reserved` in logs | Too many API instances for `db-g1-small` (~50 connections). Keep `_MAX_INSTANCES` at 3, or bootstrap with `SQL_TIER=db-custom-1-3840`. |
| 403 "no Karkhana role yet" | Email not in `SEED_USERS`. Re-run `make deploy` with it added. |
| Sign-in popup "unauthorized domain" | Step 3.3. |
| Evaluation says cached-fallback | Gemini call failed. Check Cloud Logging for `karkhana` and `make check-models`. |
| Run stuck on "running" | Cloud Logging → Cloud Run Jobs → `karkhana-worker`. After 10 min without a heartbeat the run is marked `timed_out`. Set `RUNNER_BACKEND=local` on the service as the on-stage fallback. |
