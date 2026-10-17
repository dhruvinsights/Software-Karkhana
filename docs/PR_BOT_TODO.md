# Karkhana PR reviewer bot (CodeRabbit-style)

Statuses: `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`.

| # | Task | Status | Note |
|---|------|--------|------|
| 1 | Review script: PR diff -> Karkhana engine -> summary comment (logo, walkthrough, findings) + inline review + check run | DONE | `app/scripts/pr_review_bot.py`; summary updates in place (marker), dedupes PR-Agent's security recap, inline only on lines in the diff, >300 files skipped. |
| 2 | GitHub Action on pull_request, posting as the Karkhana GitHub App (logo + Bot badge, shows under Reviewers) | DONE | `.github/workflows/karkhana-review.yml`; App token when KARKHANA_APP_ID is set, else github-actions[bot]; `@karkhana review` re-run for members; skips with a notice if GEMINI_API_KEY is missing. |
| 3 | Test on PR #4 locally (Ollama) and post | DONE | Posted summary + review with 2 inline comments on PR #4 (as the user's account, since a local run has no App). |
| 4 | User steps: create the GitHub App with the logo, install, add secrets | BLOCKED | Needs the user in the GitHub UI: see docs/PR_BOT.md. |
