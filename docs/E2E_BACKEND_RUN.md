# End-to-end run: a backend-only project through the Dev and QA stations

Date: 2026-10-18. Branch: `feat/dev-qa-stations`.

Karkhana was run as a control plane on its own database (`karkhana_e2e`, API on
`:8090`, web on `:5190`), with the developer's machine connected through
`karkhana-agent` exactly as it would connect to a deployed service. Every AI
step was a real model call (Bob for the control plane, Claude Code as the
developer's coding harness). People were the seeded demo accounts:
Priya (PM), the director, Aman (Developer) and Vikram (Lead, also on QA).

The product: **Udhaar**, a credit ledger ("khata") API for small shops,
FastAPI + SQLAlchemy, private repository
[`dhruvinsights/udhaar-api`](https://github.com/dhruvinsights/udhaar-api).
The repository started with only a customers API, money and phone helpers, and
two suites declared in `.karkhana/agent.json` (`tests/unit`, `tests/integration`).

## What happened

| # | Who | Step | Result |
|---|---|---|---|
| 1 | PM | AI sizing on the setup screen | **small**: "one API service ... new ideas added as features" |
| 2 | PM | Five feature ideas (entries, balances, statement, reminders, `/health` version) | all stored as features |
| 3 | PM | Group related features (AI) | one project idea, "Udhaar credit ledger core", from the four ledger features; the `/health` tweak stayed a feature |
| 4 | Director | Approve the project idea | approved |
| 5 | PM | Team plan (AI) | design **not needed** (API only), release **not needed**; architecture, developer, QA, DevOps, security needed |
| 6 | PM | Launch with the repository and teams | project created; members get only stations inside the chosen teams |
| 7 | AI | PRD, ERD, backlog | 5 Must requirements, 4 epics, 9 stories, each citing FR ids |
| 8 | PM | Approve the plan | 13 issues to the backlog |
| 9 | Developer | Take ISS-5 (record an entry), build on my machine | Claude Code wrote the endpoint and tests; PR #1 opened, **both suites failed** |
| 10 | — | Investigation | not the code: the agent's Docker sandbox could not see the work folder (it was under `/private/tmp`, not shared with Docker Desktop), so `pytest` was "not found". Fixed in the agent (clear error), see below |
| 11 | Developer | Send PR #1 back for rework (new feature), build again | PR #1 closed on GitHub with the reason; run 2: **unit 15/15, integration 18/18**, shown live per suite; PR #2, AI review clean |
| 12 | Developer → Lead | Ask Lead to review; Lead reads the diff and approves | approved; merge allowed |
| 13 | Developer | Merge | PR #2 merged on GitHub; a learning captured |
| 14 | Developer | Manual check by hand | ran merged `main`, exercised every criterion with curl; recorded the check, noting that 99999999999 paise and a 2099 date were accepted |
| 15 | Lead (QA) | Ask the QA agent | 2 suggestions, both citing real files: huge `amount_paise` → 500; huge customer id → 500 |
| 16 | Lead (QA) | Reproduce, then accept | both reproduced (500, `OverflowError`); filed as ISS-14 (P1) and ISS-15 (P3), assigned to the developer |
| 17 | Developer | Start fix on ISS-14, build the fix with the agent (new feature) | see below |

## Bugs in Karkhana this run found and fixed

1. **Heartbeat moved runs backwards.** The agent's heartbeat always sent
   `coding`, so a run in `validating` flipped back on the Developer station.
   It now repeats the current phase.
2. **Docker sandbox with an unshared folder reported "tests failed".** The
   agent now checks that Docker can see the worktree and stops with the fix
   (move `--dir` under the home folder, share the folder, or `--sandbox none`).
3. **A PR with failing tests was a dead end.** The story sat in review and
   could not be built again. New: *Send back for rework* closes the PR (on
   GitHub too, with the reason) and makes the story Ready.
4. **QA bugs could only be fixed by hand.** Starting a fix now creates a
   buildable task in the story's epic, so the developer's agent can fix it;
   the developer still confirms the fix by hand and QA verifies it.
5. Test isolation: `test_issues` assumed nobody else had work assigned to the
   developer; it now looks at its own project only.
