# Software Karkhana: running the whole PDLC

This runbook takes one idea from a code scan all the way to a GitHub Release. People stay in the loop at every gate, and AI does the drafting and coding in between. It was run end to end on the test product **Hisaab** (`dhruvinsights/hisaab`).

## One-time setup

Add these to `.env` (they are git-ignored):

```bash
BOB_API_KEY=...                  # IBM Bob; every AI step goes through `bob run`
LLM_PROVIDER=bob
EMBED_PROVIDER=ollama            # nomic-embed-text in local Ollama
CHAT_DEFAULT_PROVIDER=bob
TOKEN_ENCRYPTION_KEYS=<Fernet key>   # stable key; otherwise stored GitHub tokens are lost on restart
RESEND_API_KEY=...               # gate emails
```

Then bring everything up:

```bash
uv sync && (cd web && npm ci)
DATABASE_URL=postgresql+asyncpg://<owner>@localhost:5432/karkhana uv run python -m app.scripts.migrate --app-role karkhana_app
make dev   # API on :8080
make web   # UI on :5173
```

You also need `npx`, because repomix runs through it, and Docker if you want sandboxed test runs. For the Docker image, also install Node and Chromium (Playwright) for PDFs.

Connect GitHub for the product owner from the UI (Connect GitHub). The token needs the **`repo` and `workflow`** scopes. The `workflow` scope is what lets the DevOps station add GitHub Actions.

## The flow

The four parts of the flow are listed below; each has its own table.

### Ideas and approval

| # | Who | Where | What happens | Gate |
|---|---|---|---|---|
| 1 | PM | Products → Create | Creates the product with its repository URL | |
| 2 | PM | Product → Open IdeaQ → Run Agent Scan | Clones the repo, packs it with repomix into a `repo_snapshots` row, then runs 4 specialist passes. Ideas are kept only if they cite real files. | |
| 3 | PM | Idea card → **Evaluate** | Writes a typed report: verdict, 5 scores (code computes the overall), affected paths checked against the repo, risks, phases. Opens as HTML or downloads as a **PDF** (headless Chromium). | |
| 4 | PM | Idea → Send for review | Picks reviewers. They get an email and an in-app notice. | |
| 5 | Reviewer | Reviews | Reads the report and approves, or rejects with a reason. | **Gate 1** |

### Project, plan and design

| # | Who | Where | What happens | Gate |
|---|---|---|---|---|
| 6 | PM | Idea → Create project | Names a lead for each station. AI then drafts the PRD, the ERD (Mermaid) and the epics and stories. Stories must cite FR ids, and every Must requirement needs a story. | |
| 7 | PM | Project → Plan → Approve plan | Approves the PRD and ERD, moves issues and tasks to the backlog, and moves the project to `plan/ready`. | **Gate 2** |
| 8 | Designer | Project → Design → Draft design → Approve and hand off | Drafts API contracts and screen prototypes tied to story keys, then hands them off to developers through shared context and email. | **Gate 3** |

### Build, review and merge

| # | Who | Where | What happens | Gate |
|---|---|---|---|---|
| 9 | Developer | Project → Developer → Connect a machine | Shows a one-time code. On the laptop run `karkhana-agent login …`, then `karkhana-agent work`. | |
| 10 | Developer | Story → Take it → **Build on my machine** | The agent claims the job and creates a git worktree under `~/karkhana-work/<repo>.worktrees/<story>`. Bob or Claude Code codes the story. Tests run (in Docker when available) and the change is committed locally. The control plane reviews it and opens the PR. | |
| 11 | Architect / reviewer | Developer → PR → Approve | A human review by someone other than the author. It is posted on the GitHub PR as well. | **Gate 4** |
| 12 | Developer | PR → Merge | Merge is blocked until the AI comments are triaged, a human has approved, the tests passed and GitHub CI is green. | |

### QA, CI/CD and release

| # | Who | Where | What happens | Gate |
|---|---|---|---|---|
| 13 | QA | Project → QA → Generate tests → record results → **Sign off** | Generates scenarios plus pytest scripts that may only call real endpoints. A failed scenario files a bug automatically. Sign-off requires every scenario passed and no open bugs. | **Gate 5** |
| 14 | DevOps | Project → CI/CD → Set up CI/CD → Merge pipeline | Opens a PR with GitHub Actions (lint, tests, Docker build; a release workflow pushes to GHCR on tags). It merges only once its own checks are green. | |
| 15 | Release manager | Project → Release → Prepare → **Approve and publish** | Builds a manifest of merged PRs, stories with QA results, security findings and CI. Any blocker stops the release. Approval tags the release, creates the GitHub Release and emails the team. | **Gate 6** |

Workspace-wide screens, all backed by the real API:
- **Knowledge Base:** lessons captured at merge, which a lead verifies.
- **Governance:** the hash-chained ledger, with a verify button.
- **Incidents:** QA and security bugs.

## Architecture in one paragraph

- **Model calls:** every model call goes through `app/ai/llm.py`. The providers are Bob (CLI, prompt on stdin), Gemini and Ollama, and Headroom compresses every prompt.
- **Grounding:** code knowledge comes from `app/services/repo_context.py`, which takes repomix snapshots and keeps the `git ls-files` list for path checks.
- **Structured output:** every structured output is validated by code, gets one repair pass, and then fails loudly. There are no template fallbacks.
- **Local machines:** the `device` runner backend queues `agent_jobs`. Machines claim them by long-poll with `FOR UPDATE SKIP LOCKED`, so the system scales across API instances, and they dial out, so no inbound ports are needed. The machine reports through the same HMAC run callbacks as the cloud worker.
- **GitHub:** writes use the product owner's connected token, resolved by `app/services/repos.py`.
- **Live updates:** `workspace_sync` frames (`ideas`, `projects`, `runs`, `delivery`) and `run_log` lines fan out through `broadcaster`, over Redis or Kafka when configured.

## Known limits (next iteration)

- **CI/CD:** the GitHub token connected for Hisaab lacks the `workflow` scope, so the pipeline PR could not be created yet. Run `gh auth refresh -s workflow`, or reconnect GitHub in the app, and re-save the token.
- **Pipeline templates:** only Python + uv. Other stacks get a clear error.
- **Harnesses:** only Bob and Claude Code adapters, the two that were tested. The Gemini CLI was not installed.
- **QA scripts:** they run on the QA engineer's machine; Karkhana records the results. Two of the generated scripts in the last run still asserted wrong response shapes and need a QA review.
- **Agent memory:** mem0 (`app/agent_memory`) is wired but not configured locally. MemGPT/Letta replacement is planned, not built.
