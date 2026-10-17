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

"""GitHub REST client for pull requests, commit statuses, inline reviews, check-runs and merges.

Only the control plane uses this client (see ``app/publisher.py``); the worker
holds no GitHub credential. Merges happen only after every AI comment has been
triaged. Without GitHub, PR URLs start with ``local://`` so they can never pass
as real PRs.

## Authentication
If no ``GITHUB_TOKEN`` is configured, the OAuth Device Flow is available via
:func:`start_device_flow` / :func:`poll_device_token`. Persisted tokens are
stored encrypted in the ``github_tokens`` table (migrations 009, 013; see
``app/integrations/github_tokens.py``).

## Review strategy
``post_inline_review`` uses the GitHub Pull Request Reviews API
(``/repos/{owner}/{repo}/pulls/{number}/reviews``) to post line-level inline
comments as a *single* COMMENT review with a Karkhana-branded header. This
matches what CodeRabbit / Reviewdog do — one review object, many inline threads.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

AI_LABEL = "AI-generated, unverified"
KARKHANA_BOT_HEADER = (
    "### 🤖 Karkhana AI Review\n"
    "> *Automated static analysis — each finding must be triaged before merge.*\n\n"
)


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class PullRequestRef:
    """Facts about an opened PR."""

    number: int
    url: str
    head_sha: str


@dataclass(frozen=True)
class CheckRunResult:
    """Outcome of a CI check run."""

    run_id: int
    html_url: str
    status: str  # "queued" | "in_progress" | "completed"
    conclusion: str | None  # "success" | "failure" | "neutral" | None


@dataclass
class DeviceFlowStart:
    """GitHub device-flow response (step 1)."""

    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


# ── GitHub client ─────────────────────────────────────────────────────────────

class GitHub:
    """Minimal async GitHub client."""

    def __init__(
        self, token: str, repo: str, api_url: str = "https://api.github.com"
    ) -> None:
        self.repo = repo
        self._http = httpx.AsyncClient(
            base_url=f"{api_url}/repos/{repo}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "software-karkhana",
            },
            timeout=30,
        )

    async def aclose(self) -> None:
        """Closes the HTTP client."""
        await self._http.aclose()

    # ── Pull requests ──────────────────────────────────────────────────────

    async def open_pull_request(
        self,
        *,
        branch: str,
        base: str,
        title: str,
        body: str,
        head_sha: str,
        draft: bool = False,
    ) -> PullRequestRef:
        """Opens a PR from ``branch`` into ``base``."""
        r = await self._http.post(
            "/pulls",
            json={
                "title": title,
                "head": branch,
                "base": base,
                "body": body,
                "draft": draft,
            },
        )
        r.raise_for_status()
        data = r.json()
        return PullRequestRef(
            number=data["number"], url=data["html_url"], head_sha=head_sha
        )

    async def get_pull_request(self, *, number: int) -> dict[str, Any]:
        """Returns the raw GitHub PR object."""
        r = await self._http.get(f"/pulls/{number}")
        r.raise_for_status()
        return r.json()

    async def get_pull_request_diff(self, *, number: int) -> str:
        """Returns the PR's unified diff."""
        r = await self._http.get(
            f"/pulls/{number}", headers={"Accept": "application/vnd.github.diff"}
        )
        r.raise_for_status()
        return r.text

    async def request_reviewers(self, *, number: int, reviewers: list[str]) -> None:
        """Asks GitHub users to review the PR. The PR author is skipped by GitHub."""
        names = [r.strip().lstrip("@") for r in reviewers if r.strip()]
        if not names:
            return
        r = await self._http.post(
            f"/pulls/{number}/requested_reviewers", json={"reviewers": names}
        )
        r.raise_for_status()

    # ── Commit statuses ────────────────────────────────────────────────────

    async def set_status(
        self,
        *,
        sha: str,
        passed: bool,
        description: str,
        target_url: str | None = None,
    ) -> None:
        """Sets the commit status from the real test run."""
        payload: dict[str, Any] = {
            "state": "success" if passed else "failure",
            "context": "karkhana/tests",
            "description": description[:140],
        }
        if target_url:
            payload["target_url"] = target_url
        r = await self._http.post(f"/statuses/{sha}", json=payload)
        r.raise_for_status()

    async def get_combined_status(self, *, sha: str) -> dict[str, Any]:
        """Returns combined commit status (state + statuses list)."""
        r = await self._http.get(f"/commits/{sha}/status")
        r.raise_for_status()
        return r.json()

    # ── Check runs (CI) ────────────────────────────────────────────────────

    async def create_check_run(
        self,
        *,
        name: str,
        head_sha: str,
        status: str = "in_progress",
        output_title: str = "",
        output_summary: str = "",
    ) -> CheckRunResult:
        """Creates a check run for a commit (CI integration point)."""
        r = await self._http.post(
            "/check-runs",
            json={
                "name": name,
                "head_sha": head_sha,
                "status": status,
                "output": {"title": output_title, "summary": output_summary},
            },
        )
        r.raise_for_status()
        data = r.json()
        return CheckRunResult(
            run_id=data["id"],
            html_url=data["html_url"],
            status=data["status"],
            conclusion=data.get("conclusion"),
        )

    async def complete_check_run(
        self,
        *,
        run_id: int,
        conclusion: str,
        output_title: str,
        output_summary: str,
        output_text: str = "",
    ) -> CheckRunResult:
        """Marks a check run completed with a conclusion."""
        r = await self._http.patch(
            f"/check-runs/{run_id}",
            json={
                "status": "completed",
                "conclusion": conclusion,
                "output": {
                    "title": output_title,
                    "summary": output_summary,
                    "text": output_text[:65535],
                },
            },
        )
        r.raise_for_status()
        data = r.json()
        return CheckRunResult(
            run_id=data["id"],
            html_url=data["html_url"],
            status=data["status"],
            conclusion=data.get("conclusion"),
        )

    async def list_check_runs(self, *, sha: str) -> list[dict[str, Any]]:
        """Returns all check runs for a commit SHA."""
        r = await self._http.get(f"/commits/{sha}/check-runs")
        r.raise_for_status()
        return r.json().get("check_runs", [])

    # ── Reviews ────────────────────────────────────────────────────────────

    async def post_review(self, *, number: int, body: str) -> None:
        """Posts the AI review as a single PR issue comment (plain markdown)."""
        r = await self._http.post(f"/issues/{number}/comments", json={"body": body})
        r.raise_for_status()

    async def post_inline_review(
        self,
        *,
        number: int,
        head_sha: str,
        comments: list[dict[str, Any]],
        summary: str = "",
        engine: str = "",
        diff: str | None = None,
    ) -> int:
        """Posts inline review comments as a single GitHub PR Review object.

        Each entry in *comments* must have: ``path``, ``body``, ``severity``.
        Optional: ``line`` (positive int → RIGHT-side diff line).

        When the PR's unified *diff* is given, every comment is first anchored to
        a line that really exists in it. GitHub rejects the whole review (422)
        if even one inline comment points outside the diff, so unanchorable
        comments become file-level findings instead.

        Returns the GitHub review ID. Falls back to a plain issue comment when
        the diff position cannot be determined (e.g. new-file paths).
        """
        body_header = KARKHANA_BOT_HEADER
        if engine:
            body_header += f"**Engine:** `{engine}`\n\n"
        if summary:
            body_header += f"**Summary:** {summary}\n\n"
        body_header += (
            f"Found **{len(comments)}** finding(s). "
            "Each must be triaged in Karkhana before merge.\n\n"
            "---"
        )

        if diff:
            from app.review.diff import anchor_dicts

            comments = anchor_dicts(diff, comments)

        gh_comments = []
        fallback_lines = []
        for c in comments:
            path = str(c.get("path") or "").strip()
            line = c.get("line")
            severity_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(
                str(c.get("severity", "low")), "🟢"
            )
            comment_body = (
                f"{severity_emoji} **{c.get('severity', 'low').upper()}**\n\n"
                f"{c.get('body', '')}"
            )
            if path and line and isinstance(line, int) and line > 0:
                gh_comments.append(
                    {
                        "path": path,
                        "line": line,
                        "side": "RIGHT",
                        "body": comment_body,
                    }
                )
            else:
                # No usable line number — add to the fallback body
                loc = path or "(unknown)"
                fallback_lines.append(f"- `{loc}`: {comment_body}")

        review_body = body_header
        if fallback_lines:
            review_body += "\n\n**File-level findings:**\n" + "\n".join(fallback_lines)

        payload: dict[str, Any] = {
            "commit_id": head_sha,
            "body": review_body,
            "event": "COMMENT",
        }
        if gh_comments:
            payload["comments"] = gh_comments

        r = await self._http.post(f"/pulls/{number}/reviews", json=payload)
        if r.status_code == 422 and gh_comments:
            # Inline comments failed (e.g. diff not found) — retry without them.
            logger.warning("GitHub inline review rejected, retrying as body-only")
            payload.pop("comments")
            payload["body"] += (
                "\n\n**Findings (could not be anchored inline):**\n"
                + "\n".join(
                    f"- `{gc['path']}:{gc['line']}`: {gc['body']}" for gc in gh_comments
                )
            )
            r = await self._http.post(f"/pulls/{number}/reviews", json=payload)
        r.raise_for_status()
        return r.json().get("id", 0)

    # ── Merge ─────────────────────────────────────────────────────────────

    async def merge(self, *, number: int, title: str) -> str:
        """Squash-merges the PR and returns the merge commit sha."""
        r = await self._http.put(
            f"/pulls/{number}/merge",
            json={"merge_method": "squash", "commit_title": title},
        )
        r.raise_for_status()
        return r.json().get("sha", "")

    async def update_branch(self, *, number: int) -> None:
        """Brings the PR branch up to date with its base (so new checks run)."""
        r = await self._http.put(f"/pulls/{number}/update-branch", json={})
        if r.status_code not in (202, 422):  # 422: already up to date
            r.raise_for_status()

    # ── Branches, files, tags and releases ─────────────────────────────────

    async def branch_sha(self, branch: str) -> str:
        """The commit a branch points at."""
        r = await self._http.get(f"/git/ref/heads/{branch}")
        r.raise_for_status()
        return r.json()["object"]["sha"]

    async def create_branch(self, *, name: str, sha: str) -> None:
        """Creates ``name`` at ``sha``; an existing branch is moved there."""
        r = await self._http.post("/git/refs", json={"ref": f"refs/heads/{name}", "sha": sha})
        if r.status_code == 422:
            r = await self._http.patch(f"/git/refs/heads/{name}", json={"sha": sha, "force": True})
        r.raise_for_status()

    async def put_file(self, *, path: str, content: str, branch: str, message: str) -> None:
        """Creates or replaces one file on ``branch`` in a single commit."""
        existing = await self._http.get(f"/contents/{path}", params={"ref": branch})
        body: dict[str, Any] = {
            "message": message,
            "content": base64.b64encode(content.encode()).decode(),
            "branch": branch,
        }
        if existing.status_code == 200:
            body["sha"] = existing.json()["sha"]
        r = await self._http.put(f"/contents/{path}", json=body)
        r.raise_for_status()

    async def list_workflow_runs(self, *, branch: str | None = None, per_page: int = 10) -> list[dict[str, Any]]:
        """Recent GitHub Actions runs, newest first."""
        params: dict[str, Any] = {"per_page": per_page}
        if branch:
            params["branch"] = branch
        r = await self._http.get("/actions/runs", params=params)
        r.raise_for_status()
        return r.json().get("workflow_runs", [])

    async def create_release(self, *, tag: str, target: str, name: str, body: str) -> dict[str, Any]:
        """Tags ``target`` and publishes a GitHub Release with ``body`` as notes."""
        r = await self._http.post(
            "/releases",
            json={"tag_name": tag, "target_commitish": target, "name": name, "body": body},
        )
        r.raise_for_status()
        return r.json()


# ── OAuth Device Flow ─────────────────────────────────────────────────────────

class GitHubOAuth:
    """GitHub OAuth 2.0 Device Flow (RFC 8628).

    Use this when no ``GITHUB_TOKEN`` is present. The user visits
    ``verification_uri`` and enters ``user_code``; the control plane polls
    ``/login/oauth/access_token`` until granted or expired.
    """

    BASE = "https://github.com"
    # workflow: the DevOps station commits GitHub Actions files.
    SCOPES = "repo,workflow,read:org"

    def __init__(self, client_id: str) -> None:
        self._client_id = client_id
        self._http = httpx.AsyncClient(
            base_url=self.BASE,
            headers={"Accept": "application/json", "User-Agent": "software-karkhana"},
            timeout=15,
        )

    async def aclose(self) -> None:
        """Close the underlying HTTP client."""
        await self._http.aclose()

    async def start(self) -> DeviceFlowStart:
        """Step 1 — get device_code + user_code."""
        r = await self._http.post(
            "/login/device/code",
            data={"client_id": self._client_id, "scope": self.SCOPES},
        )
        r.raise_for_status()
        data = r.json()
        return DeviceFlowStart(
            device_code=data["device_code"],
            user_code=data["user_code"],
            verification_uri=data["verification_uri"],
            expires_in=data.get("expires_in", 900),
            interval=data.get("interval", 5),
        )

    async def poll(self, device_code: str) -> str | None:
        """Step 2 — returns access token once authorized, or None if still pending."""
        r = await self._http.post(
            "/login/oauth/access_token",
            data={
                "client_id": self._client_id,
                "device_code": device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            },
        )
        r.raise_for_status()
        data = r.json()
        if "access_token" in data:
            return data["access_token"]
        err = data.get("error", "")
        if err in ("authorization_pending", "slow_down"):
            return None
        raise ValueError(f"OAuth device flow error: {err} — {data.get('error_description', '')}")


# ── Helpers ───────────────────────────────────────────────────────────────────

def git_auth_header(token: str) -> str:
    """Builds a git ``http.extraheader`` value; keeps the token out of URLs and logs."""
    basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return f"AUTHORIZATION: basic {basic}"


def client(token: str | None = None) -> GitHub | None:
    """A client for the server-wide ``GITHUB_REPO``, if a repo and token are configured.

    ``token`` (a user's decrypted OAuth token, see ``github_tokens``) takes
    precedence over the server's ``GITHUB_TOKEN``. Project work goes through
    ``app.services.repos.client_for``, which uses the product's repository.
    """
    s = get_settings()
    token = token or s.github_token
    if token and s.github_repo:
        return GitHub(token, s.github_repo, s.github_api_url)
    return None


def oauth_client() -> GitHubOAuth | None:
    """Returns an OAuth client if a GitHub App client_id is configured."""
    s = get_settings()
    if s.github_client_id:
        return GitHubOAuth(s.github_client_id)
    return None


def review_markdown(
    comments: list[dict], *, engine: str = "", summary: str = ""
) -> str:
    """Formats AI comments for a PR body comment, with the mandatory label."""
    by = f" by {engine}" if engine else ""
    lines = [KARKHANA_BOT_HEADER + f"### AI review{by} ({AI_LABEL})", ""]
    if summary:
        lines += [summary, ""]
    if comments:
        lines += ["Each comment must be triaged in Karkhana before merge.", ""]
    for i, c in enumerate(comments, start=1):
        loc = c["path"] + (f":{c['line']}" if c.get("line") else "")
        lines.append(f"{i}. **{c['severity']}** `{loc}`: {c['body']}")
    return "\n".join(lines)
