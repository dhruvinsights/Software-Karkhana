# Master TODO: from one idea to a live GCP deploy

**Goal.** One person, seven accounts, takes a product idea to a live GCP deploy. Humans approve at each gate, AI helps at each step, everything is stored in the database and shared live, and access and AI use are governed.

**Legend.** `[x]` done and verified, `[~]` partly done, `[ ]` not started.
**Rule.** A box is ticked only after the check written next to it passes.
**Note.** `[x]` items marked as done were built on branch `wip/idea-lab-access-sync` and land on `main` when that work is merged.

## 0. What exists today (verified in code)

- `[x]` Idea approval, then `POST /api/ideas/{id}/promote` creates the project and enrols leads with stations (`app/routers/idea_approvals.py`).
- `[x]` Evaluation drafts epics and stories (`app/services/evaluation.py`) into the old `epics` and `tasks` tables.
- `[x]` Plan service copies them into the `issues` table with parent links (`app/services/plan.py`, `app/routers/plan.py`).
- `[x]` Issues API: list, create, patch. Types: epic, story, bug, task, chore, security.
- `[x]` Station APIs: ADRs, QA scenarios, security findings (`app/routers/stations.py`).
- `[x]` QA: queue of finished stories, AI-drafted manual scenarios plus a pytest script, pass / fail / blocked.
- `[x]` PR reviewer (`app/review/`, `scripts/review_pr.py`) works on Ollama and comments on exact lines.
- `[x]` mem0 agent memory (`app/agent_memory`, isolated venv) wired to run specs and PR merge.
- `[x]` Runner contract with local, Cloud Run Job and AX backends (`app/runner/`).
- `[~]` Chat retention, attachments and a realtime broker: written, tested, not yet reviewed by the owner.
- `[ ]` Not built: role-based project screens, local agent package, VS Code extension, deploy pipeline to GCP, AI usage limits.

## 1. Role-based project workspaces (highest priority)

**Problem.** The project page is one screen of equal cards. People cannot tell where to invite, who is on the team, or what their own job is.
**Design.** One project, a different home screen per role. Each home shows only that role's work, its team and reviewers, and a visible "Invite" button.

- [ ] 1.1 Role resolver. How: one endpoint `GET /api/projects/{id}/home` returns `projectRole` (lead, product, design, architect, developer, qa, security, devops, release, reviewer) from the member's stations and role. Check: unit test per role.
- [ ] 1.2 Project frame. How: header with name, stage, avatars and Invite; left rail lists only that role's pages. Check: Playwright screenshot per role.
- [ ] 1.3 Product (PM) workspace: idea, PRD, ARD, epics dashboard, plan approval. Check: PM sees epics grouped by status.
- [ ] 1.4 Designer workspace: own dashboard, design brief from approved stories, Google Stitch and Figma handoff links, design agents. Decision needed first: which Stitch/Figma API access exists.
- [ ] 1.5 Developer workspace: my tasks, plan, build, PRs, reviewers, and the Agent Swarm panel. Move "Launch Agent Swarm" off the project overview into this workspace.
- [ ] 1.6 QA workspace: wire the existing QA queue screen into the project frame.
- [ ] 1.7 Security, CI/CD and Release workspaces: findings, pipelines, release checklist and sign-offs.
- [ ] 1.8 Reviewer / guide: read-only overview with approve or comment only.
- [ ] 1.9 Fix header: show the project title once, as plain text (the raw `**Status:**` markdown still leaks into the overview card).
- [ ] 1.10 Remove the old station-card board once every role screen renders. Check: no import of it remains.

## 2. People: invite, see, manage

- [x] 2.1 List real project members with role, lead flag and stations. Refreshes live on `workspace_sync`.
- [x] 2.2 One-click "Invite to <station>" link on every station screen.
- [ ] 2.3 Change stations and remove a member. How: add `PATCH` and `DELETE /api/projects/{id}/members/{user_id}`. Check: integration test plus ledger entry.
- [ ] 2.4 Leads name team leads, who add their own team. How: expose the existing promote rule in the Team page.
- [ ] 2.5 Pending invites list with revoke.
- [ ] 2.6 Browser check with two accounts: one joins, the other's card updates live.

## 3. Idea to plan in one click

- [x] 3.1 Migration 025 (epic type, parent, acceptance criteria, source quote, estimate, wider statuses).
- [x] 3.2 `POST /api/projects/{id}/plan` (lead only, idempotent) and `GET` returns the epic tree.
- [x] 3.3 `POST /api/projects/{id}/plan/approve` moves drafts to backlog.
- [~] 3.4 Plan tab in the UI. Builds and compiles; not yet checked in a browser.
- [ ] 3.5 One button on the promote screen: "Create project and plan". How: call promote, then plan build, then show the Plan page.
- [ ] 3.6 Planner reads the connected GitHub repo map so epics fit real code. How: reuse `run_codebase_scan`.
- [ ] 3.7 Bridge `issues` to runnable `tasks` so a plan story can be built by an agent. How: when a story reaches `ready`, create or link a `tasks` row and an epic row; `POST /api/issues/{id}/build` starts the run.

## 4. GitHub-style work tracking (miniature)

Reference: GitHub Projects table grouped by status, assignee sidebar, "Create new issue" template list.

- [ ] 4.1 Table view grouped by status with counts, assignee sidebar and filter box. How: new `IssueTable.tsx` using `/api/projects/{id}/issues`.
- [ ] 4.2 Board view over the same data.
- [ ] 4.3 "Create new issue" dialog with templates: Epic, Story, Task, Bug, Test defect, Security finding, Chore.
- [ ] 4.4 Issue page: description, acceptance criteria, assignee, labels, linked PR, activity.
- [ ] 4.5 Many assignees. How: migration `issue_assignees`.
- [ ] 4.6 Sprints and saved views (Backlog, My items, In review).
- [ ] 4.7 Optional two-way sync with real GitHub issues of the connected repo.

## 5. Local agent package (code on the developer's machine)

**Decision.** One TypeScript core, shipped as the npm CLI `@software-karkhana/agent`, run with `npx` and nothing to install. The same core powers the VS Code extension. A Python package is not needed.

- [ ] 5.1 Tables `agent_devices` and `agent_jobs` (migration 026 has `agent_jobs`; add devices).
- [ ] 5.2 Backend: device pairing with a one-time code, a WebSocket the agent dials out to, typed job dispatch. Never raw shell.
- [ ] 5.3 CLI: `karkhana login`, `karkhana link <folder>`, `karkhana work`.
- [ ] 5.4 Job types `plan`, `build`, `test`, `open_pr`, each in a git worktree.
- [ ] 5.5 Harness adapters: Bob, Claude Code, Gemini CLI, Ollama. Model keys stay on the machine.
- [ ] 5.6 Local approval for risky steps: push, dependency install, writes to protected paths.
- [ ] 5.7 Live stream of plan, logs, diff and test result to the dashboard.
- [ ] 5.8 Check: press Build on a task, a branch and PR appear on GitHub.

## 6. Developer flow

Plan, select task, build, assign reviewer, review, merge.

- [ ] 6.1 Developer picks a task; the agent's plan is shown and can be edited and approved.
- [ ] 6.2 Build dispatches the job; live log in the browser. Replace the fake `setTimeout` "Dispatch Agent" in `DeveloperWorkspaceView.tsx`.
- [ ] 6.3 PR opens linked to the issue, human reviewers requested, AI review runs.
- [ ] 6.4 Reviewer approves or requests changes; the issue status moves by itself.
- [ ] 6.5 Dependency manifest per PR (new packages, versions, licences) for the release team.

## 7. VS Code extension (calm, no gimmicks)

- [ ] 7.1 Scaffold the extension on the Phase 5 core.
- [ ] 7.2 Sidebar tree: my tasks, status, Plan, Build, Open PR.
- [ ] 7.3 Plan and diff webview with Approve and Reject.
- [ ] 7.4 Package a `.vsix` and install locally. Marketplace publish later.

## 8. QA and review

- [x] 8.1 AI drafts manual scenarios plus a pytest script for each finished story. Check: `tests/integration/test_stations.py`.
- [ ] 8.2 A failed scenario files a bug issue linked to the story.
- [ ] 8.3 QA gate: a story cannot reach Done without a passed run.
- [ ] 8.4 Run the generated script against the running app and store the result.
- [ ] 8.5 Click-through browser check of the new QA screen.

## 9. Per-role agents

- [ ] 9.1 `agent_jobs` model, router and executor with its own sandbox directory and log stream (table exists, nothing uses it).
- [ ] 9.2 Agents: designer, architect, developer, QA, security, release. Port the v1 phase pipeline from `Software-karkhana-v1`.
- [ ] 9.3 AX backend: install the `ax` CLI, set `AX_TASK_IMAGE`, run one task with `RUNNER=ax`.
- [ ] 9.4 Bob CLI as a backend next to Ollama.
- [ ] 9.5 mem0 on pgvector (`MEM0_STORE=pgvector`).
- [ ] 9.6 Run `scripts/review_pr.py --post` on a real PR with the team as reviewers.

## 10. CI/CD to GCP and release

- [ ] 10.1 Verify `.github/workflows/ci.yml` runs green on a PR.
- [ ] 10.2 Deploy workflow: build image, push, deploy to Cloud Run with Workload Identity (no JSON keys).
- [ ] 10.3 Staging, then production behind a human approval.
- [ ] 10.4 Release record collects merged PRs, dependency manifest, test and scan results, sign-offs.
- [ ] 10.5 Send that package to the release team by email and show it in the Release screen.
- [ ] 10.6 Check: a merged change reaches the live URL; rollback works.

## 11. Realtime sync and governance

- [~] 11.1 Event bus (`services/realtime.py`). Issues, PRs, runs and approvals must also broadcast `workspace_sync`.
- [ ] 11.2 AI usage ledger: every model call records user, project, tokens, cost, purpose.
- [ ] 11.3 Budgets per user, project and workspace; admin can switch AI off for a role.
- [ ] 11.4 Access audit page with a hash-chain verify button.
- [ ] 11.5 Row-level security tests for every new table.

## 12. Rehearsal with seven accounts

- [ ] 12.1 Seed script: owner, PM, designer, architect, developer, QA, release.
- [ ] 12.2 Scripted run: idea, approval, project and plan, invite, design, build, PR, review, QA, CI, deploy, release package.
- [ ] 12.3 Record it and fix every point where a person had to leave the product.

## Order of work

1. Section 1 (role workspaces) with 3.7 (bridge) and 4.1 / 4.3 (issue table and templates).
2. Sections 2 and 6.
3. Sections 5 and 7.
4. Sections 8 to 12.

## How to check

- Backend: `RESEND_API_KEY= uv run --group dev pytest -q` and `uv run ruff check app tests scripts`.
- Frontend: `cd web && npx tsc -b && npx vite build`.
- UI: log in with a seeded account and take screenshots with headless Chromium before ticking a UI box.

## Progress log

| Date | Item | Result |
|---|---|---|
| 2026-10-17 | Plan from idea (migration 025, service, endpoints) | tests pass |
| 2026-10-17 | PR reviewer on Ollama, line numbers, `review_pr.py` | checked on PR #1 (dry run) |
| 2026-10-17 | mem0 wired to runs and merge | tests pass, Ollama check ok |
| 2026-10-17 | Station cards, per-station invite, live member lists | tsc and build ok |
| 2026-10-17 | QA: finished-story queue, AI scenarios and script, new QA screen | 239 tests pass, ruff, tsc, build ok |
| 2026-10-17 | Browser check of project page found markdown title leak and loose Agent Swarm button | logged as 1.5 and 1.9 |
