# Architecture

Software Karkhana is a **modular monolith**: one deployable, with strict,
machine-enforced boundaries between modules so any of them can be cut out into
its own service later without a rewrite.

## Layers (dependencies point down only)

| Layer | Modules | May import |
|---|---|---|
| API | `app.routers.*`, `app.fast_api_app` | everything below |
| Services | `app.services.*`, `app.publisher`, `app.worker` | features, kernel |
| Features | `app.ai`, `app.review`, `app.agents`, `app.integrations`, `app.runner`, `app.memory` | kernel |
| Kernel | `app.models`, `app.schemas`, `app.ledger`, `app.process`, `app.idea_flow`, `app.otp`, `app.invite_rules`, `app.issue_rules`, `app.access`, `app.auth`, `app.db`, `app.config` | kernel only |

## Domains (routers)

| Domain | Router(s) | Owns |
|---|---|---|
| Identity | `auth` | one-time codes, Google/GitHub/password sign-in |
| Invitations | `invites` | workspace and project invite links, email delivery, acceptance |
| Tenancy | `workspaces`, `workspace` | workspaces, invites, members, model providers |
| Product & ideas | `products`, `idea_approvals` | products, ideas, reviewer approvals, promotion |
| Delivery | `projects`, `platform`, `runs`, `operations`, `issues` | projects, stages, agent runs, releases, issues and bugs |
| Code review | `reviews`, `github_oauth` | PRs, AI review comments, GitHub |
| Knowledge | `rag`, `context`, `chat`, `gemini` | memory, project context, chat |

## Access model

A project is `open` (its whole workspace) or `restricted` (its team only). Projects
created from an approved idea start restricted. Each teammate has *stations*
(product, design, architecture, developer, qa, devops, security, release); the
server checks them in `app.access`, and the UI hides what the server would refuse.
Nobody outside a project's workspace can see it.

**Roles are per workspace.** Authority is the caller's `WorkspaceMember.role` in
the workspace of the resource being acted on (`access.effective_role`,
`access.require_project_role`); a workspace owner counts at least as `pm`.
`User.role` is an account label for the UI only and grants nothing, and a
resource with no workspace grants no role to anyone. There is no global
`require_role`. New projects and ideas always go into a workspace the caller
belongs to (`access.resolve_workspace`). Sign-up never picks a manager role,
and creating a workspace never changes the account label.

**Sign-in.** `X-Dev-User` is honoured only when `AUTH_MODE=dev`. Session JWTs
are signed with `SESSION_JWT_SECRET` and carry `typ: session`; worker callback
tokens are HMACs under `RUN_HMAC_SECRET`. The two keys must differ, so neither
token is accepted as the other. Outside dev mode the built-in session default
is refused (fail closed). The local runner gives the worker an allowlisted
environment (`app.runner.local.build_worker_env`) and tells it not to read
`.env`, so no platform secret reaches untrusted code.

## Secrets at rest

GitHub OAuth tokens (device flow, `repo` scope) are stored only in
`github_tokens.token`, encrypted with Fernet as `fernet:v1:<ciphertext>`
(`app/crypto.py`). Only `app/integrations/github_tokens.py` reads or writes the
table. The token is never returned by an API (`/api/github/auth/poll` answers
`granted`; `/api/github/auth/status` reports `connected`), never logged, and
never put in a worker's environment: the worker holds only its `RUN_TOKEN`.
A `CHECK (token LIKE 'fernet:v1:%')` constraint (migration 013) refuses
plaintext writes at the database.

Keys come from `TOKEN_ENCRYPTION_KEYS` (Secret Manager `token-encryption-keys`
on Cloud Run): comma-separated Fernet keys, first encrypts, all decrypt. The
API refuses to start on Cloud Run without it; `AUTH_MODE=dev` falls back to an
ephemeral key with a warning. Rotation: add a secret version `NEW,OLD`, deploy,
run `python -m app.scripts.reencrypt_tokens` as the schema owner (also encrypts
any legacy plaintext rows and validates the constraint), then add a version
`NEW`. Planned: Cloud KMS envelope encryption behind `app.crypto.load_keys`.

## Rules (enforced by `make arch` and CI)

1. Routers never import each other. Shared logic lives in `app.services`.
2. Nothing below the API layer imports `app.routers`.
3. The kernel never imports a feature or a service.

Adding a rule: edit `[tool.importlinter]` in `pyproject.toml`.

## Known limits (be honest in the demo)

- Sign-in codes are held in process memory: run **one** instance, or move
  `app.otp.OtpStore` to Postgres/Redis before scaling out.
- Realtime updates are polling-based; Pub/Sub + SSE is the planned path.
