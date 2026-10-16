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

## Rules (enforced by `make arch` and CI)

1. Routers never import each other. Shared logic lives in `app.services`.
2. Nothing below the API layer imports `app.routers`.
3. The kernel never imports a feature or a service.

Adding a rule: edit `[tool.importlinter]` in `pyproject.toml`.

## Known limits (be honest in the demo)

- Sign-in codes are held in process memory: run **one** instance, or move
  `app.otp.OtpStore` to Postgres/Redis before scaling out.
- Realtime updates are polling-based; Pub/Sub + SSE is the planned path.
