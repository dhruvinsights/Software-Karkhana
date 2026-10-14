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

"""GitHub REST client for pull requests, commit statuses, reviews and merges.

Only the control plane uses this client (see ``app/publisher.py``); the worker
holds no GitHub credential. Merges happen only after every AI comment has been
triaged. Without GitHub, PR URLs start with ``local://`` so they can never pass
as real PRs.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass

import httpx

from app.config import get_settings

AI_LABEL = "AI-generated, unverified"


@dataclass(frozen=True)
class PullRequestRef:
    """Facts about an opened PR."""

    number: int
    url: str
    head_sha: str


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

    async def set_status(
        self, *, sha: str, passed: bool, description: str, target_url: str | None = None
    ) -> None:
        """Sets the commit status from the real test run."""
        payload = {
            "state": "success" if passed else "failure",
            "context": "karkhana/tests",
            "description": description[:140],
        }
        if target_url:
            payload["target_url"] = target_url
        r = await self._http.post(f"/statuses/{sha}", json=payload)
        r.raise_for_status()

    async def post_review(self, *, number: int, body: str) -> None:
        """Posts the AI review as a single PR comment, clearly labelled."""
        r = await self._http.post(f"/issues/{number}/comments", json={"body": body})
        r.raise_for_status()

    async def merge(self, *, number: int, title: str) -> str:
        """Squash-merges the PR and returns the merge commit sha."""
        r = await self._http.put(
            f"/pulls/{number}/merge",
            json={"merge_method": "squash", "commit_title": title},
        )
        r.raise_for_status()
        return r.json().get("sha", "")


def git_auth_header(token: str) -> str:
    """Builds a git ``http.extraheader`` value; keeps the token out of URLs and logs."""
    basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return f"AUTHORIZATION: basic {basic}"


def client() -> GitHub | None:
    """Returns a GitHub client if a repo and token are configured."""
    s = get_settings()
    if s.github_token and s.github_repo:
        return GitHub(s.github_token, s.github_repo, s.github_api_url)
    return None


def review_markdown(comments: list[dict]) -> str:
    """Formats AI comments for the PR, with the mandatory label."""
    lines = [
        f"### Karkhana AI review ({AI_LABEL})",
        "",
        "Each comment must be triaged in Karkhana before merge.",
        "",
    ]
    for i, c in enumerate(comments, start=1):
        loc = c["path"] + (f":{c['line']}" if c.get("line") else "")
        lines.append(f"{i}. **{c['severity']}** `{loc}`: {c['body']}")
    return "\n".join(lines)
