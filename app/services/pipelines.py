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

"""DevOps station: CI/CD for the product repository, on GitHub Actions.

Karkhana does not run pipelines; GitHub does. This module proposes the
workflow files for the repository's stack as a pull request (a person merges
it, after its own checks pass), and reads the runs back for the dashboard.
Templates live in ``pipeline_templates/`` and are plain YAML.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.integrations import github
from app.models import RepoSnapshot

_TEMPLATES = Path(__file__).parent / "pipeline_templates"
SETUP_BRANCH = "karkhana/ci-cd"


class UnsupportedStack(ValueError):
    """No pipeline template fits the repository yet."""


@dataclass(frozen=True)
class Stack:
    """What the pipeline needs to know about the repository."""

    kind: str  # "python-uv"
    ruff: bool
    docker: bool


def detect(snapshot: RepoSnapshot) -> Stack:
    """Reads the stack from the repository snapshot."""
    pyproject = snapshot.files.get("pyproject.toml", "")
    if "uv.lock" in snapshot.paths and pyproject:
        return Stack("python-uv", ruff=bool(re.search(r"\bruff\b", pyproject)), docker="Dockerfile" in snapshot.paths)
    raise UnsupportedStack(
        "Karkhana has a pipeline template for Python projects managed with uv (pyproject.toml and uv.lock). "
        "Add the workflow by hand for this repository."
    )


def workflows(stack: Stack) -> dict[str, str]:
    """The workflow files for ``stack``, by repository path."""
    lint = (
        "      - run: uv run ruff check .\n      - run: uv run ruff format --check .\n" if stack.ruff else ""
    )
    image = (_TEMPLATES / "image-job.yml").read_text() if stack.docker else ""
    ci = (_TEMPLATES / "python-uv-ci.yml").read_text().replace("{lint_steps}", lint).replace("{image_job}", image)
    files = {".github/workflows/ci.yml": ci.rstrip() + "\n"}
    if stack.docker:
        files[".github/workflows/release.yml"] = (_TEMPLATES / "release.yml").read_text()
    return files


async def propose(gh: github.GitHub, stack: Stack, base: str) -> github.PullRequestRef:
    """Commits the workflows to a setup branch and opens a PR into ``base``."""
    await gh.create_branch(name=SETUP_BRANCH, sha=await gh.branch_sha(base))
    files = workflows(stack)
    for path, content in files.items():
        await gh.put_file(path=path, content=content, branch=SETUP_BRANCH, message=f"ci: add {path}")
    body = (
        "Adds GitHub Actions for this repository, proposed by the Software Karkhana DevOps station.\n\n"
        + "\n".join(f"- `{path}`" for path in files)
        + "\n\nCI runs lint, tests"
        + (" and a container build" if stack.docker else "")
        + " on every pull request and on main."
        + ("\nRelease publishes the image to GHCR when Karkhana tags a release." if stack.docker else "")
    )
    return await gh.open_pull_request(
        branch=SETUP_BRANCH,
        base=base,
        title="CI/CD: GitHub Actions pipeline",
        body=body,
        head_sha=await gh.branch_sha(SETUP_BRANCH),
    )


async def ci_blockers(gh: github.GitHub, sha: str) -> list[str]:
    """GitHub statuses and check runs on ``sha`` that are not green."""
    combined = await gh.get_combined_status(sha=sha)
    blockers = [
        f"{st['context']} is {st['state']}" for st in combined.get("statuses", []) if st.get("state") != "success"
    ]
    for run in await gh.list_check_runs(sha=sha):
        if run.get("status") != "completed":
            blockers.append(f"{run.get('name')} is still running")
        elif run.get("conclusion") not in ("success", "neutral", "skipped"):
            blockers.append(f"{run.get('name')} {run.get('conclusion')}")
    return blockers
