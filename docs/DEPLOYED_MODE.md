# Karkhana as a deployed service

Karkhana is meant to run as one web service (Cloud Run, `make deploy`) that
everyone opens in the browser. Developers' machines connect to it outward; nothing
calls into them. This page lists what that means for each moving part, and what
must be configured so nothing silently falls back to `localhost`.

## Who runs what

| Piece | Where it runs | How it reaches the rest |
|---|---|---|
| Web UI | Served by the API service (`STATIC_DIR`) | Same origin; API under `/api`, websocket at `wss://<host>/api/chat/ws` |
| API, background jobs (idea scan, PRD drafting, team plan, QA agent) | API service, as FastAPI background tasks | Needs CPU after the response: deploy uses `--no-cpu-throttling` and `--min-instances=1` |
| Coding agent | The developer's machine (`karkhana-agent work`) | Long-polls `PUBLIC_BASE_URL/api/agent/jobs/claim`; reports through run callbacks |
| Cloud coding worker (optional) | Cloud Run Job `karkhana-worker` | Calls back to `PUBLIC_BASE_URL` with a per-run HMAC token |
| QA automation scripts | The QA engineer's machine | Results recorded through the API |

## Settings that must be set in production

| Setting | Why | Without it |
|---|---|---|
| `PUBLIC_BASE_URL` | Agent pairing command, run callbacks, email links | Defaults to `http://localhost:8080`; agents and links point at nothing. `make deploy` sets it to the service URL. |
| `APP_URL` | Links in emails and invites when the UI is on another domain | Falls back to `PUBLIC_BASE_URL` |
| `LLM_PROVIDER=gemini` (+ `GEMINI_MODEL`) | Model calls | The `bob` provider needs the Bob CLI on the server, which the image does not have; `ollama` must never be exposed publicly |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | "Sign in with GitHub" (device flow) on the launch screen | Only personal access tokens work |
| `RESEND_API_KEY`, `EMAIL_FROM` | Approval, review-request and handoff emails | Emails are skipped; in-app notices still arrive |
| `REALTIME_BROKER_URL` (Redis or Kafka) | Live updates when more than one instance runs | Each instance only reaches its own websockets; set `--max-instances=1` instead |
| `TOKEN_ENCRYPTION_KEYS` | Stored GitHub tokens survive restarts | Tokens become unreadable after a key change |

`cloudbuild.yaml` passes `RUN_HMAC_SECRET`, `SESSION_JWT_SECRET`, `GITHUB_TOKEN` and
`TOKEN_ENCRYPTION_KEYS` from Secret Manager. Add the GitHub OAuth, Resend and broker
values as secrets the same way before inviting a team.

## What the image must contain

- `git`: clones for snapshots and publishing PRs.
- Node + `repomix` (pinned, installed at build time; `REPOMIX_CMD=/usr/local/bin/repomix`):
  every AI step that reads code (scan, PRD, team plan, Idea Lab chat, QA agent) packs
  the repository with it. Before this was added, the deployed image had no Node, so all
  of those failed with "repomix not found" even though they worked locally.
- Headless Chromium (Playwright, `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`): PDF reports.

## Developer machines against a deployed Karkhana

1. Developer → *Connect a machine* shows `karkhana-agent login --server https://<service> --code …`.
   The server address comes from `PUBLIC_BASE_URL`.
2. `karkhana-agent work` claims jobs over HTTPS. No ports are opened on the laptop.
3. The agent clones with the developer's own git credentials, codes with their harness
   (Bob or Claude Code), runs the unit and integration suites (in Docker when available)
   and reports each suite's progress back. The control plane reviews the diff and opens
   the PR with the product owner's GitHub token.

## Checked

- `grep -rnE "localhost|127.0.0.1|5173|:8080" app web/src packages/karkhana-agent/src`:
  only config defaults (`app/config.py`) and the Vite dev proxy (`web/vite.config.ts`),
  both overridden in production.
- The websocket URL is built from `window.location`, so it follows the deployed host
  and uses `wss` on HTTPS.
