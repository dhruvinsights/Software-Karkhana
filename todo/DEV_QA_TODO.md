# Dev and QA stations: TODO

Goal: the Developer and QA spaces of a project are complete, and one real
backend-only project goes through them end to end, as on a deployed Karkhana.

Tick an item only after its check passes. Commit code and this file together.

## 0. Setup
- [x] Branch `feat/dev-qa-stations` (stacked on `feat/project-launch-idea-scope`, PR #7)
- [ ] Deployed-mode audit: list every place that assumes `localhost`
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
