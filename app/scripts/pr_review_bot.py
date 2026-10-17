# Copyright 2026 Software Karkhana authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

r"""Karkhana PR reviewer bot: reviews a GitHub pull request and posts the result.

Run by .github/workflows/karkhana-review.yml (or by hand):

    GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo PR_NUMBER=4 \\
        uv run python -m app.scripts.pr_review_bot

What it posts, as whichever identity owns GITHUB_TOKEN (the Karkhana GitHub
App in CI, so the bot shows with the Karkhana logo):

- a summary comment, updated in place on every push: walkthrough of changed
  files, findings by severity, and the reviewed commit;
- a PR review with inline comments on the lines the findings point at, so the
  bot appears under Reviewers;
- a "Karkhana Review" check run: failure when there is a high-severity finding.

The diff is reviewed by Karkhana's own engine (app.review.engine), with the
model from LLM_PROVIDER (Gemini in CI, Ollama locally).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from typing import Any

import httpx

from app.ai import chat
from app.config import get_settings
from app.review import engine

LOGO = "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/logo-iPRZvqKRlb13DWnnPrieJh1ogqAfm9.png"
MARKER = "<!-- karkhana-review -->"
MAX_FILES = 300
MAX_DIFF_CHARS = 180_000
SEVERITY_ICON = {"high": "🔴", "medium": "🟠", "low": "🟡"}
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


class GitHub:
    """The few REST calls the bot needs."""

    def __init__(self, token: str, repo: str, api: str) -> None:
        self.repo = repo
        self.http = httpx.AsyncClient(
            base_url=api.rstrip("/"),
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=60,
        )

    async def call(self, method: str, path: str, **kw: Any) -> Any:
        """One REST call under /repos/{repo}; JSON in, JSON (or text) out."""
        r = await self.http.request(method, f"/repos/{self.repo}{path}", **kw)
        if r.status_code >= 400:
            raise RuntimeError(f"GitHub {method} {path}: {r.status_code} {r.text[:300]}")
        return r.json() if r.content and "json" in r.headers.get("content-type", "") else r.text

    async def diff(self, number: int) -> str:
        """The PR as a unified diff."""
        r = await self.http.get(
            f"/repos/{self.repo}/pulls/{number}", headers={"Accept": "application/vnd.github.v3.diff"}
        )
        r.raise_for_status()
        return r.text

    async def files(self, number: int) -> list[dict[str, Any]]:
        """Changed files with per-file additions and deletions."""
        out: list[dict[str, Any]] = []
        for page in range(1, 11):
            batch = await self.call("GET", f"/pulls/{number}/files", params={"per_page": 100, "page": page})
            out += batch
            if len(batch) < 100:
                break
        return out


def commentable_lines(diff: str) -> dict[str, set[int]]:
    """New-file line numbers GitHub accepts inline comments on, per path."""
    lines: dict[str, set[int]] = {}
    path, new_line = None, 0
    for raw in diff.splitlines():
        if raw.startswith("+++ "):
            path = raw[6:] if raw.startswith("+++ b/") else None
            if path is not None:
                lines.setdefault(path, set())
        elif raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            new_line = int(m.group(1)) if m else 0
        elif path is not None and not raw.startswith("---"):
            if raw.startswith("+") or raw.startswith(" "):
                lines[path].add(new_line)
                new_line += 1
    return lines


def dedupe(findings: list[Any]) -> list[Any]:
    """Drops general notes that repeat a file-level finding (PR-Agent's security recap)."""
    specific = [f for f in findings if f.path and not f.path.startswith("(")]
    keys = [re.sub(r"\W+", " ", f.body.lower())[:60] for f in specific]
    general = [
        f for f in findings
        if (not f.path or f.path.startswith("("))
        and not any(k and k[:40] in re.sub(r"\W+", " ", f.body.lower()) for k in keys)
    ]
    return specific + general


async def walkthrough(diff: str, title: str, files: list[dict[str, Any]]) -> dict[str, Any]:
    """One-paragraph summary plus a one-line change note per file."""
    paths = [f["filename"] for f in files][:60]
    prompt = (
        f"Pull request: {title}\nFiles: {', '.join(paths)}\n\nDiff:\n{diff[:60_000]}\n\n"
        'Reply with JSON only: {"summary": "<2-3 sentences: what changes and why>", '
        '"files": [{"path": "<path>", "change": "<one short line>"}]}'
    )
    try:
        text = await chat.complete(
            get_settings().llm_provider,
            [{"role": "user", "content": prompt}],
            system="You summarise code changes for reviewers. Plain, specific, no hype.",
        )
        data = json.loads(re.search(r"\{.*\}", text, re.S).group(0))  # type: ignore[union-attr]
        return {"summary": str(data.get("summary", "")), "files": {f["path"]: f["change"] for f in data.get("files", []) if "path" in f}}
    except Exception:
        return {"summary": "", "files": {}}


def summary_body(pr: dict[str, Any], files: list[dict[str, Any]], walk: dict[str, Any],
                 findings: list[Any], inline_ids: set[int], model: str, ci_url: str) -> str:
    counts = {s: sum(1 for f in findings if f.severity == s) for s in SEVERITY_ORDER}
    verdict = (
        "Changes requested: fix the high-severity findings before merging." if counts["high"]
        else "No blocking issues found." if findings else "Looks good. No findings."
    )
    rows = "\n".join(
        f"| `{f['filename']}` | {walk['files'].get(f['filename'], f['status'])} | +{f['additions']} / -{f['deletions']} |"
        for f in files[:80]
    )
    more = f"\n\n…and {len(files) - 80} more files." if len(files) > 80 else ""
    found = "\n".join(
        f"| {SEVERITY_ICON[f.severity]} {f.severity} | {('`' + f.path + (f':{f.line}' if f.line else '') + '`') if f.path and not f.path.startswith('(') else 'general'}"
        f" | {f.body.splitlines()[0][:220]}{' (inline)' if i in inline_ids else ''} |"
        for i, f in sorted(enumerate(findings), key=lambda x: SEVERITY_ORDER[x[1].severity])
    ) or "| ✅ | | Nothing to flag. |"
    sha = pr["head"]["sha"]
    return f"""{MARKER}
<table><tr><td><img src="{LOGO}" width="58" height="58" alt="Software Karkhana logo" style="display:block;border-radius:14px;"></td>
<td><h3>Karkhana Review</h3>{verdict}</td></tr></table>

**{counts['high']} high · {counts['medium']} medium · {counts['low']} low** on `{sha[:7]}` · {pr['changed_files']} files · +{pr['additions']} / -{pr['deletions']}

## Summary
{walk['summary'] or pr['title']}

## Walkthrough
<details open><summary>Changes by file</summary>

| File | Change | Lines |
|---|---|---|
{rows}{more}
</details>

## Findings
| Severity | Where | Finding |
|---|---|---|
{found}

<details><summary>⚙️ Run details</summary>

- Engine: Karkhana review engine · model `{model}`
- Reviewed commit: `{sha}`
- CI: [checks for this commit]({ci_url})
</details>

<sub>Updates on every push. Comment <code>@karkhana review</code> to run it again.</sub>
"""


async def run() -> int:
    token, repo = os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"]
    number = int(os.environ["PR_NUMBER"])
    gh = GitHub(token, repo, os.environ.get("GITHUB_API_URL", "https://api.github.com"))
    dry = os.environ.get("DRY_RUN") == "1"

    pr = await gh.call("GET", f"/pulls/{number}")
    sha = pr["head"]["sha"]
    ci_url = f"https://github.com/{repo}/pull/{number}/checks"
    existing = next(
        (c for c in await gh.call("GET", f"/issues/{number}/comments", params={"per_page": 100}) if MARKER in (c.get("body") or "")),
        None,
    )

    async def upsert(body: str) -> None:
        if dry:
            print(body)
        elif existing:
            await gh.call("PATCH", f"/issues/comments/{existing['id']}", json={"body": body})
        else:
            await gh.call("POST", f"/issues/{number}/comments", json={"body": body})

    if pr["changed_files"] > MAX_FILES:
        await upsert(f"{MARKER}\n<img src=\"{LOGO}\" width=\"40\" height=\"40\" alt=\"Software Karkhana logo\">\n\n"
                     f"### Karkhana Review skipped\n\nThis PR changes {pr['changed_files']} files; the limit is {MAX_FILES}. "
                     "Split it into smaller PRs to get a review.")
        return 0

    check = None
    if not dry:
        try:  # Only App tokens (CI) may create check runs; a personal token skips it.
            check = await gh.call("POST", "/check-runs", json={
                "name": "Karkhana Review", "head_sha": sha, "status": "in_progress",
                "output": {"title": "Reviewing…", "summary": "Karkhana is reviewing this pull request."},
            })
        except RuntimeError:
            check = None
    try:
        diff, files = await gh.diff(number), await gh.files(number)
        result, walk = await asyncio.gather(
            engine.review_diff(diff[:MAX_DIFF_CHARS], title=pr["title"]),
            walkthrough(diff, pr["title"], files),
        )
        findings = dedupe(result.comments)
        ok_lines = commentable_lines(diff)
        inline = [
            (i, f) for i, f in enumerate(findings)
            if f.path in ok_lines and f.line and f.line in ok_lines[f.path]
        ]
        await upsert(summary_body(pr, files, walk, findings, {i for i, _ in inline}, result.model, ci_url))

        if inline and not dry:
            await gh.call("POST", f"/pulls/{number}/reviews", json={
                "commit_id": sha,
                "event": "COMMENT",
                "body": f"Karkhana found {len(findings)} issue(s); {len(inline)} are marked inline below.",
                "comments": [
                    {"path": f.path, "line": f.line, "side": "RIGHT",
                     "body": f"{SEVERITY_ICON[f.severity]} **{f.severity.title()}** · Karkhana\n\n{f.body}"}
                    for _, f in inline
                ],
            })
        elif not dry:
            await gh.call("POST", f"/pulls/{number}/reviews", json={
                "commit_id": sha, "event": "COMMENT",
                "body": "Karkhana reviewed this PR. Details are in the summary comment.",
            })

        high = sum(1 for f in findings if f.severity == "high")
        if check:
            await gh.call("PATCH", f"/check-runs/{check['id']}", json={
                "status": "completed", "conclusion": "failure" if high else "success",
                "output": {"title": f"{len(findings)} finding(s), {high} high", "summary": walk["summary"] or pr["title"]},
            })
        return 0
    except Exception as exc:
        if check:
            await gh.call("PATCH", f"/check-runs/{check['id']}", json={
                "status": "completed", "conclusion": "neutral",
                "output": {"title": "Review could not run", "summary": str(exc)[:500]},
            })
        raise


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
