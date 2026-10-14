# Team plan, Wed 21:30 to Fri 12:00 freeze

Every Tier A and Tier B feature already has code and tests. The work from here is
**making it real on GCP, making the agent reliable on the demo repo, and polishing
the story**, not writing new features.

| Track | Owner | Tonight | Thursday | Friday AM |
|---|---|---|---|---|
| 1. Infra and deploy | Person 1 | `docs/GO_LIVE.md` end to end. Public URL with Google sign-in. | Deploy on every merge. Watch Cloud Logging. Fresh-project dry run. | Freeze config. Second fresh deploy from scratch. |
| 2. Evaluator quality (A3, B3) | Person 2 | Run both demo ideas against live Gemini; fix prompts until source quotes pass first time. | `make check-models`; 5-idea eval script (C3) in `tests/eval`. Tune memory threshold `MIN_SIMILARITY` in `app/memory.py`. | Lock prompts. |
| 3. Coder and Reviewer agents (A8-A10) | Person 3 | `make playground`: run the Coder on story KAR-1 against `demo-repo`. | Riskiest block. Run 10 times on Cloud Run Jobs; record pass rate. Tune `CODER_INSTRUCTION`. Keep `DEMO_FALLBACK=true`. | Pre-warm: one successful run recorded as backup video. |
| 4. Frontend and UX | Person 4 | Click through every role in `make dev` + `make web`; file bugs. | Polish the PM, Director and Developer screens; empty and error states; phone width. | Screen-capture the golden path twice. |
| 5. Story, deck, video | Person 5 | Read `docs/DEMO_SCRIPT.md`; draft the problem slide from the blueprint. | Deck: problem, live flow, Google stack map, roadmap (planned stages). | 3-minute video; rehearse twice. |

## Rules

- `main` must always deploy. Small PRs, `make test` green before merge.
- Do not add Tier C items until the golden path works on the public URL.
- Any change to a gate, role check or the ledger needs a test in `tests/integration`.
