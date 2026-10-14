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

"""Coding worker: one execution builds one task (features A8, A9, A10).

Runs as a Cloud Run Job execution (or a local subprocess) with three env vars:
``RUN_ID``, ``RUN_TOKEN`` and ``CALLBACK_URL``.

Flow:
    spec -> clone (read-only) -> ADK Coder -> real test run -> diff
    -> ADK Reviewer -> report the patch and results to the control plane.

Trust boundary: pytest executes repository code the agent wrote, so this
process is treated as running untrusted code. It therefore holds no GitHub
token and no user credentials; the control plane publishes the patch
(``app/publisher.py``). What untrusted code here could still reach: this run's
own callback token (it can only report on this run, which is no more power
than writing a trivially passing test, and the PR still needs human triage),
the worker service account (Vertex AI user and artifact upload only, no
database or secrets), and outbound network. VPC egress controls are roadmap.

The agent edits files; this module owns the test run and the reported number.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx

from app.agents.tools import TEST_ARGV, Workspace
from app.config import get_settings
from app.schemas import ReviewCommentDraft, RunResult, RunSpec

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s worker %(levelname)s %(message)s"
)
logger = logging.getLogger("karkhana.worker")
# Human-readable form of the exact argv the worker runs.
TEST_COMMAND = " ".join(["python", *TEST_ARGV[1:]])


class ControlPlane:
    """HMAC-authenticated callbacks to the Karkhana API."""

    def __init__(self, base_url: str, run_id: str, token: str) -> None:
        self.run_id = run_id
        self._http = httpx.AsyncClient(
            base_url=f"{base_url}/internal/runs/{run_id}",
            headers={"Authorization": f"Run {token}"},
            timeout=180,  # The control plane publishes inside /complete.
        )

    async def spec(self) -> RunSpec:
        """Fetches what to build."""
        r = await self._http.get("/spec")
        r.raise_for_status()
        return RunSpec.model_validate(r.json())

    async def progress(self, phase: str) -> None:
        """Sends a heartbeat with the current phase."""
        try:
            await self._http.post("/progress", json={"phase": phase})
        except httpx.HTTPError as exc:
            logger.warning("heartbeat failed: %s", exc)

    async def complete(self, result: RunResult) -> None:
        """Reports the final result, retrying transient failures."""
        for attempt in range(5):
            try:
                r = await self._http.post(
                    "/complete", json=result.model_dump(mode="json")
                )
                r.raise_for_status()
                return
            except httpx.HTTPError as exc:
                logger.warning(
                    "complete callback failed (attempt %d): %s", attempt + 1, exc
                )
                await asyncio.sleep(2**attempt)
        raise RuntimeError("could not report result to the control plane")


def git(repo: Path, *args: str, auth: str | None = None) -> str:
    """Runs git with fixed argv; the auth header is passed via -c, never logged."""
    argv = ["git"]
    if auth:
        argv += ["-c", f"http.extraheader={auth}"]
    argv += list(args)
    proc = subprocess.run(
        argv, cwd=repo, capture_output=True, text=True, timeout=120, check=False
    )
    if proc.returncode != 0:
        safe = " ".join(a for a in args)
        raise RuntimeError(f"git {safe} failed: {proc.stderr.strip()[-500:]}")
    return proc.stdout


async def build(spec: RunSpec, cp: ControlPlane) -> RunResult:
    """Does the untrusted part of one run and returns a patch to publish.

    The worker holds no GitHub credential: it clones a readable repository,
    lets the Coder edit files, runs the tests, and returns the diff. The
    control plane applies that diff and does every GitHub write.
    """
    from app.agents.coder import run_coder, run_reviewer

    settings = get_settings()
    with tempfile.TemporaryDirectory(prefix="karkhana-run-") as tmp:
        repo = Path(tmp) / "repo"
        await cp.progress("cloning")
        source = spec.repo_url or (
            f"https://github.com/{spec.repo}.git" if spec.repo else None
        )
        if not source:
            return RunResult(
                ok=False,
                error="No repository configured (GITHUB_REPO or DEMO_REPO_URL).",
            )
        await asyncio.to_thread(
            subprocess.run,
            [
                "git",
                "clone",
                "--depth",
                "50",
                "--branch",
                spec.base_branch,
                source,
                str(repo),
            ],
            capture_output=True,
            text=True,
            timeout=180,
            check=True,
        )
        ws = Workspace(repo)

        await cp.progress("coding")
        used_fallback = False
        try:
            summary = await run_coder(
                ws,
                title=spec.task_title,
                description=spec.task_description,
                criteria=spec.acceptance_criteria,
            )
            logger.info("Coder summary: %s", summary[:500])
        except Exception as exc:
            if not settings.demo_fallback:
                raise
            from app.ai import fallbacks

            logger.warning("Coder failed (%s); applying cached demo patch", exc)
            patch_file = Path(tmp) / "fallback.diff"
            patch_file.write_text(fallbacks.demo_patch())
            git(repo, "apply", str(patch_file))
            used_fallback = True

        await cp.progress("validating")
        exit_code, output = ws.run_tests()  # The number we report comes from here.
        git(repo, "add", "-A")
        diff = git(repo, "diff", "--cached", "--binary")
        if not diff.strip():
            return RunResult(
                ok=False,
                error="The agent made no changes.",
                test_exit_code=exit_code,
                test_output=output,
                test_command=TEST_COMMAND,
            )

        await cp.progress("reviewing")
        try:
            try:
                review = (await run_reviewer(diff, title=spec.task_title)).comments
            except Exception as first:
                logger.warning("Reviewer failed once (%s); retrying", first)
                review = (await run_reviewer(diff, title=spec.task_title)).comments
        except Exception as exc:
            if not settings.demo_fallback:
                logger.warning("Reviewer failed: %s", exc)
                review = []
            else:
                from app.ai import fallbacks

                logger.warning("Reviewer failed (%s); using cached review", exc)
                review = fallbacks.review().comments

        artifacts_uri = await upload_artifacts(spec, diff, output)
        return RunResult(
            ok=True,
            patch=diff,
            used_fallback=used_fallback,
            test_command=TEST_COMMAND,
            test_exit_code=exit_code,
            test_output=output,
            review=[ReviewCommentDraft.model_validate(c.model_dump()) for c in review],
            artifacts_uri=artifacts_uri,
        )


async def upload_artifacts(spec: RunSpec, diff: str, output: str) -> str | None:
    """Stores the patch and test log in Cloud Storage, if a bucket is set."""
    bucket_name = get_settings().artifacts_bucket
    if not bucket_name:
        return None
    from google.cloud import storage

    def _upload() -> str:
        bucket = storage.Client().bucket(bucket_name)
        prefix = f"runs/{spec.run_id}"
        bucket.blob(f"{prefix}/patch.diff").upload_from_string(
            diff, content_type="text/x-diff"
        )
        bucket.blob(f"{prefix}/tests.log").upload_from_string(
            output, content_type="text/plain"
        )
        return f"gs://{bucket_name}/{prefix}/"

    try:
        return await asyncio.to_thread(_upload)
    except Exception as exc:
        logger.warning("artifact upload failed: %s", exc)
        return None


async def main() -> int:
    """Entry point for one run."""
    run_id, token, base = (
        os.environ["RUN_ID"],
        os.environ["RUN_TOKEN"],
        os.environ["CALLBACK_URL"],
    )
    cp = ControlPlane(base, run_id, token)
    try:
        spec = await cp.spec()
        result = await build(spec, cp)
    except Exception as exc:
        logger.exception("run failed")
        result = RunResult(ok=False, error=f"{type(exc).__name__}: {str(exc)[:1500]}")
    await cp.complete(result)
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
