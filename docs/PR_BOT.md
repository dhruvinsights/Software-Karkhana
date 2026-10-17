# Karkhana Review: the PR reviewer bot

Every pull request gets a review from Karkhana's own review engine:

- **Summary comment** with the Karkhana logo: verdict, a summary, a walkthrough
  of changed files, findings by severity, and run details. It updates in place
  on every push.
- **Review with inline comments** on the exact lines. The bot shows under
  *Reviewers*.
- **"Karkhana Review" check** next to CI: red when there is a high-severity
  finding.
- Comment `@karkhana review` on a PR to run it again (owners, members and
  collaborators only). Draft PRs are skipped until they are marked ready.
  PRs with more than 300 files get a "skipped" note.

Code: `app/scripts/pr_review_bot.py`. Workflow: `.github/workflows/karkhana-review.yml`.

## One-time setup (about 5 minutes)

The logo and the **Bot** badge come from a GitHub App. Without one, the bot posts
as `github-actions[bot]`.

1. **Create the app:** GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.
   - Name: `Karkhana Review`. The name must be unique on GitHub; add a suffix if it is taken.
   - Homepage URL: the repo URL.
   - Webhook: untick **Active**.
   - Repository permissions:
     - Pull requests: Read and write
     - Issues: Read and write
     - Checks: Read and write
     - Contents: Read-only
     - Metadata: Read-only
   - Where can this app be installed: **Only on this account**.
2. **Logo:** on the app page, under *Display information*, upload
   `docs/assets/karkhana-logo-512.png` and set the background colour to `#0A0A0F`.
3. **Private key:** under *Private keys*, click **Generate a private key**. A
   `.pem` file downloads. Note the **App ID** at the top of the page.
4. **Install:** open *Install App* and choose **Only select repositories** →
   `Software-Karkhana`.
5. **Secrets:** run these from the repo folder.

   ```bash
   gh secret set KARKHANA_APP_ID --body "<App ID>"
   gh secret set KARKHANA_APP_PRIVATE_KEY < ~/Downloads/<app-name>.<date>.private-key.pem
   gh secret set GEMINI_API_KEY --body "<Google AI Studio key>"
   ```

The next push to any PR is reviewed by **karkhana-review[bot]** with the logo.

## Run it locally (no GitHub App needed)

```bash
GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=dhruvinsights/Software-Karkhana PR_NUMBER=4 \
LLM_PROVIDER=ollama REVIEW_ENGINE=pr_agent PR_AGENT_PYTHON=$PWD/.venv-pr-agent/bin/python \
uv run python -m app.scripts.pr_review_bot      # add DRY_RUN=1 to print instead of posting
```

A local run posts as you. GitHub lets only App tokens create check runs, so
the check is skipped on a local run.
