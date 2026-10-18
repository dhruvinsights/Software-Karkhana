# Dev and QA stations: TODO

Goal: the Developer and QA spaces of a project are complete, and one real
backend-only project goes through them end to end, as on a deployed Karkhana.

Tick an item only after its check passes. Commit code and this file together.

## 0. Setup
- [x] Branch `feat/dev-qa-stations` (stacked on `feat/project-launch-idea-scope`, PR #7)
- [x] Deployed-mode audit: list every place that assumes `localhost`
      (agent server URL, pairing command, email links, CORS, websocket URL) and fix
      or document it in `docs/DEPLOYED_MODE.md`.
      Check: grep for localhost in app/ and web/src, each hit justified.

## 1. Test progress in runs (unit and integration separately)
- [x] `runs.test_suites` (migration 033) + `POST /internal/runs/{id}/tests` callback
      for one suite's start and result. Check: integration test.
- [x] karkhana-agent runs suites separately (`.karkhana/agent.json` `tests: {unit, integration}`,
      else `tests/unit` and `tests/integration` when present) and reports each one,
      parsing pytest counts. Check: `node --test` in packages/karkhana-agent.

## 2. Developer accountability
- [x] Manual check by the developer (`issues.dev_check`): acceptance criteria ticked,
      notes; required before QA can sign a story off and before a bug can be marked fixed.
      Check: integration test.
- [x] Bug lifecycle for QA bugs: New, Fixing, Fixed (dev confirmed), Verified, Reopened.
      Dev: start / mark fixed. QA: verify / reopen. Check: integration test.
- [x] Request reviewers on a PR (people in the project; email + in-app + GitHub when
      their login is known). Check: integration test.
- [x] `GET /api/projects/{id}/dev-board`: stories with run, suites, PR, reviewers,
      manual check and their bugs; plus the project's bug list. Check: integration test.

## 3. QA agents suggest, people decide
- [x] `qa_suggestions` table; the QA agent reads the story, its diff and the code and
      suggests bugs. Suggestions never become bugs on their own: QA accepts (files the
      bug to the developer) or dismisses with a reason. Check: integration test.
- [x] QA queue shows "waiting for the developer's manual check" separately.

## 4. Channels inside a station
- [x] `chat_channels.station`; create a channel for my station in this project with an
      audience (my team, the project, or linked to the whole workspace); link later.
      Check: integration test.

## 5. Frontend & design inside Dev
- [x] Stories carry their layer (`layer:frontend` label from the plan).
- [x] Dev → Frontend workspace (API; UI in step 6): frontend stories, the design handoff for each story
      (screens and API contracts from the Design station), and its agent runs.
      Frontend stories and their agent jobs land there automatically.

## 6. UI
- [x] Dev workspace screen: My stories pipeline (code → unit → integration → AI review
      and PR → reviewers → manual check → ready for QA), Bugs from QA, Frontend & design,
      Channels, Machines.
- [x] QA workspace screen: queue by stage, scenarios, QA agent suggestions to triage,
      bugs to verify, sign-off, Channels.
- [x] `tsc -b` and `vite build` pass.

## 7. End to end on a new backend-only project
- [ ] Backend-only repository on GitHub, product + idea group + launch in Karkhana.
- [ ] Developer builds stories with the agent, PR raised, reviewer requested.
- [ ] QA agent suggestions, QA accepts bugs, developer fixes and confirms, QA verifies
      and signs off.
- [ ] Write up what happened and what broke in `docs/E2E_BACKEND_RUN.md`.

## Progress log
| Date | What |
|---|---|
| 2026-10-17 | TODO written; branch created |
| 2026-10-17 | Runs report unit and integration suites separately, live |
| 2026-10-18 | Dev accountability: manual checks, bug lifecycle, reviewer requests, dev board |
| 2026-10-18 | QA agent suggests bugs grounded in code; QA accepts or dismisses; QA board by stage |
| 2026-10-18 | Station channels: team / project / linked to workspace |
| 2026-10-18 | Frontend workspace API; coding runs get their story's design slice |
| 2026-10-18 | Dev and QA workspace screens with channels; mounted in project and standalone screens |
| 2026-10-18 | Deployed mode: image now carries Node + repomix and Chromium (verified in a local build); settings documented |

## 8. Calmer, cheaper agent runs (user feedback after the first real use)
- [ ] The developer chooses the folder: a per-machine, per-project path set in
      Developer → Machines; the agent clones there (or reuses an existing clone).
- [ ] Failing tests are fixed before anything is published: the agent feeds the
      failures back for up to two small rounds; if they still fail it stops and
      keeps the work. No PR for a red build.
- [ ] The agent does not open the PR. A finished build waits for the developer,
      who reviews the change and picks the base branch (and head branch name,
      title) when raising it.
- [ ] Build again continues: it reuses the worktree, runs the tests first and
      skips the coding agent when they already pass; otherwise the prompt says
      what exists and what failed. Rework reasons reach the next build.
- [ ] Credits: hard cost and turn caps per run and per fix round; one summary of
      what was spent; no coding agent call when nothing needs fixing.
- [ ] Claude / Bob situations handled with a plain message: out of credits, not
      signed in, rate limited (one retry), turn or cost cap hit, timeout, stopped
      by the developer (Stop button), partial work kept.
- [ ] Never touch the developer's system: pip/venv rules in the prompt and
      PIP_REQUIRE_VIRTUALENV; `.chroma/` and agent scratch stay out of the diff.
- [ ] The diff viewer scales: file list with search and filters, files with
      comments opened first, everything else collapsed and rendered on demand,
      generated and lock files folded away.

## 9 — Multi-agent / Parallel runs (independence-first)

**Claim (to make true, not just talk about)**
> Parallel agents do not automatically mean faster delivery. They can increase cost, create
> conflicting changes and introduce more review work. The best gains come from automating
> repeatable workflows and running genuinely independent tasks in parallel.

**What the system does today (honest)**
- One karkhana-agent per story, one worktree per task.
- No cross-story conflict detection before launch.
- No cost budget shown before parallel launch.
- No parallelism scheduler — the developer manually triggers each build.

**What we are building**

### 9.1  Independence analysis (server, `app/services/parallel_planner.py`)
Before any parallel launch, the server computes a `ParallelPlan`:
- File-path overlap from each story's recent diff (or focus paths from the brief).
- Story dependency edges from the board (blocks / is-blocked-by).
- Conflict risk score: 0 (safe to run in parallel) → 1 (must serialize).
- Recommended groupings: groups of stories safe to run together.

### 9.2  Parallel-launch modal (UI)
The developer selects multiple stories → "Run in parallel".
Modal shows:
- The recommended groupings with conflict risk badges.
- Per-run cost estimate × N agents.
- A parallelism budget (max concurrent agents, default 2).
- Override: "Run anyway" when risk is medium.
- Block: Cannot override HIGH conflict risk — must serialize.

### 9.3  Per-agent worktrees (already done in git.js)
Each agent gets its own git worktree. ✅

### 9.4  Conflict detection before PR
Before `run_publish.py` publishes, it runs a merge-dry-run against the target branch.
If conflicts exist → gate opened, developer must resolve before publish.

### 9.5  Aggregate cost cap
`POST /api/tasks/batch-run` accepts a `max_total_cost_usd`.
The scheduler refuses to start the next agent if the running total would exceed it.

### 9.6  Repeatable workflow reuse (already partially done)
The code→test→fix loop is the automated unit.
Each agent runs the same loop independently.
"Parallel" means independent loops, not shared state. ✅ conceptually

**Status:** 9.1 skeleton added (app/services/parallel_planner.py). 9.2–9.5 not yet built.
