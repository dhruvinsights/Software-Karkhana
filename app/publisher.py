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
"""Publishes a worker's patch: branch, commit, push, PR, status, review.

This runs in the control plane, never in the worker. The worker executes
untrusted repository code (pytest runs tests the agent wrote), so it holds no
GitHub credential at all. It returns a patch; this module applies it to a
fresh clone and performs every GitHub write with the token that only the
control plane can read from Secret Manager.

Without GitHub configured, the patch is pushed to ``DEMO_REPO_URL`` (a local
or test remote) and the PR is recorded with a ``local://`` URL.
"""

from __future__ import annotations

import asyncio
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings
from app.integrations import github

MAX_PATCH_BYTES = 1_000_000


class PublishError(Exception):
    """The patch could not be published."""


@dataclass(frozen=True)
class Published:
    """Where the change landed."""

    branch: str
    pr_number: int
    pr_url: str
    head_sha: str
    draft: bool


def _git(repo: Path, *args: str, auth: str | None = None) -> str:
    argv = ["git", *(["-c", f"http.extraheader={auth}"] if auth else []), *args]
    proc = subprocess.run(
        argv, cwd=repo, capture_output=True, text=True, timeout=180, check=False
    )
    if proc.returncode != 0:
        raise PublishError(f"git {args[0]} failed: {proc.stderr.strip()[-400:]}")
    return proc.stdout


def _apply_and_push(
    *, source: str, base: str, branch: str, patch: str, message: str, auth: str | None
) -> str:
    """Clones, applies the patch, commits and pushes. Returns the commit sha."""
    with tempfile.TemporaryDirectory(prefix="karkhana-publish-") as tmp:
        repo = Path(tmp) / "repo"
        repo.mkdir()
        _git(repo, "init", "-q")
        _git(repo, "remote", "add", "origin", source)
        _git(repo, "fetch", "--depth", "50", "origin", base, auth=auth)
        _git(repo, "checkout", "-q", "-b", branch, "FETCH_HEAD")
        _git(repo, "config", "user.name", "Karkhana Coder")
        _git(repo, "config", "user.email", "coder@karkhana.dev")
        patch_file = Path(tmp) / "change.diff"
        patch_file.write_text(patch, encoding="utf-8")
        _git(repo, "apply", "--index", "--whitespace=nowarn", str(patch_file))
        _git(repo, "commit", "-q", "-m", message)
        sha = _git(repo, "rev-parse", "HEAD").strip()
        _git(repo, "push", "-q", "origin", f"HEAD:refs/heads/{branch}", auth=auth)
        return sha


async def publish(
    *,
    run_id: uuid.UUID,
    task_key: str,
    task_title: str,
    patch: str,
    pr_body: str,
    tests_passed: bool,
    test_summary: str,
    review_markdown: str | None,
) -> Published:
    """Pushes the patch and opens the PR. Raises :class:`PublishError`."""
    if not patch.strip():
        raise PublishError("empty patch")
    if len(patch.encode()) > MAX_PATCH_BYTES:
        raise PublishError("patch is larger than 1 MB")
    s = get_settings()
    gh = github.client()
    source = s.demo_repo_url or (
        f"https://github.com/{s.github_repo}.git" if s.github_repo else None
    )
    branch = f"karkhana/{task_key.lower()}-{run_id.hex[:8]}"
    title = f"{task_key}: {task_title}"
    if source is None:
        # Nothing to push to (unit/integration tests): record the facts only.
        return Published(
            branch,
            int(run_id.int % 900_000) + 100_000,
            f"local://{branch}",
            "",
            not tests_passed,
        )

    auth = github.git_auth_header(s.github_token) if gh and s.github_token else None
    sha = await asyncio.to_thread(
        _apply_and_push,
        source=source,
        base=s.github_base_branch,
        branch=branch,
        patch=patch,
        message=f"{title}\n\nKarkhana run {run_id}",
        auth=auth,
    )
    if gh is None:
        return Published(
            branch,
            int(run_id.int % 900_000) + 100_000,
            f"local://{branch}",
            sha,
            not tests_passed,
        )
    try:
        pr = await gh.open_pull_request(
            branch=branch,
            base=s.github_base_branch,
            title=title,
            body=pr_body,
            head_sha=sha,
            draft=not tests_passed,
        )
        await gh.set_status(
            sha=sha, passed=tests_passed, description=test_summary, target_url=pr.url
        )
        if review_markdown:
            await gh.post_review(number=pr.number, body=review_markdown)
    finally:
        await gh.aclose()
    return Published(branch, pr.number, pr.url, sha, not tests_passed)


def pr_body(
    *,
    task_key: str,
    task_title: str,
    project_name: str,
    run_id: uuid.UUID,
    criteria: list[str],
    test_command: str,
    exit_code: int,
    output: str,
    used_fallback: bool,
) -> str:
    """Markdown body for the PR, including the worker's real validation result."""
    status = "PASSED" if exit_code == 0 else "FAILED (opened as draft)"
    note = (
        "\n> Patch source: cached demo fallback (DEMO_FALLBACK=true); tests ran live.\n"
        if used_fallback
        else ""
    )
    ac = "\n".join(f"- [ ] {c}" for c in criteria)
    return (
        f"Implements **{task_key}: {task_title}** for project *{project_name}*.\n\n"
        f"Code by the Software Karkhana Coder agent (Google ADK + Gemini), run `{run_id}`.\n"
        f"Published by the control plane; the agent's worker holds no GitHub credentials.\n"
        f"{note}\n### Acceptance criteria\n{ac}\n\n"
        f"### Validation (run by the worker, not claimed by the agent)\n"
        f"`{test_command}` exit code **{exit_code}**: {status}\n\n"
        f"```\n{output[-2500:]}\n```\n"
    )
