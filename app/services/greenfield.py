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

"""Products whose repository is empty: Karkhana starts it from the product setup.

Teams often hand Karkhana a fresh repository so the product can be built, not
an existing codebase. An empty repository has nothing to snapshot and no base
branch for pull requests, so Karkhana makes the first commit itself:

* ``README.md`` written from the product setup (problem, users, stack,
  features, constraints), which every agent reads first;
* ``.karkhana/agent.json`` when the stack needs a test command the developer's
  agent would not guess (C/C++ with CMake, Go, Rust, Java).

Prompts then say plainly that the code does not exist yet, so the AI plans the
first version from the setup instead of looking for code to build on.
"""

from __future__ import annotations

import base64
import json
import logging
import uuid
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.integrations import github_tokens
from app.models import Product, RepoSnapshot
from app.services import repo_context, repos

logger = logging.getLogger(__name__)

# What a repository holds right after Karkhana starts it.
STARTER_FILES = frozenset({"README.md", ".karkhana/agent.json", ".gitignore", "LICENSE"})

NOTE = (
    "GREENFIELD: the repository has no application code yet; it holds only the "
    "starter files below. The PRODUCT setup is the truth about what to build. "
    "Plan and design the first version from it, including the project structure, "
    "build and test setup for the stated tech stack. Do not assume any existing "
    "tables, endpoints or modules."
)


def is_greenfield(snapshot: RepoSnapshot | None) -> bool:
    """True when the snapshot holds nothing beyond the starter files."""
    if snapshot is None:
        return False
    paths = set(snapshot.paths or snapshot.files)
    return not (paths - STARTER_FILES)


def _stack(settings: dict[str, Any]) -> str:
    return " ".join(settings.get("techStack") or []).lower()


def agent_config_for(settings: dict[str, Any]) -> dict[str, Any] | None:
    """The test command for stacks the developer's agent would not guess."""
    stack = _stack(settings)
    words = set(stack.replace(",", " ").replace("/", " ").split())
    if words & {"c++", "c++20", "c++17", "cpp", "c", "cmake"}:
        build = "cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug && cmake --build build -j"
        return {
            "tests": {
                "unit": ["sh", "-c", f"{build} && ctest --test-dir build -L unit --output-on-failure"],
                "integration": ["sh", "-c", f"{build} && ctest --test-dir build -L integration --output-on-failure"],
            }
        }
    if words & {"go", "golang"}:
        return {"test": ["go", "test", "./..."]}
    if words & {"rust", "cargo"}:
        return {"test": ["cargo", "test"]}
    if words & {"java", "maven"}:
        return {"test": ["mvn", "-q", "test"]}
    return None


def readme_for(product: Product) -> str:
    """The starter README: the product setup, written for people and agents."""
    st = product.settings or {}

    def bullets(items: list[str]) -> str:
        return "\n".join(f"- {x}" for x in items) or "- (not given yet)"

    cfg = agent_config_for(st)
    tests = ""
    if cfg:
        tests = (
            "\n## Tests\n\nThe Karkhana agent runs the test command in `.karkhana/agent.json`. "
            "Keep it working as the project grows.\n"
        )
    return (
        f"# {product.name}\n\n{product.description or ''}\n\n"
        f"## Problem\n\n{st.get('problemStatement') or '(not given yet)'}\n\n"
        f"## Who it is for\n\n{st.get('targetUsers') or '(not given yet)'}\n\n"
        f"## Tech stack\n\n{bullets(st.get('techStack') or [])}\n\n"
        f"## What it will do\n\n{bullets(st.get('keyFeatures') or [])}\n\n"
        f"## Constraints\n\n{bullets(st.get('constraints') or [])}\n"
        f"{tests}\n"
        "## Status\n\nThis repository was started by Software Karkhana from the product setup. "
        "There is no code yet: the first stories create the project structure, build and tests "
        "for the stack above.\n"
    )


async def _token(session: AsyncSession, product: Product, user_id: uuid.UUID | None) -> str | None:
    for uid in (product.created_by, user_id):
        if uid and (token := await github_tokens.load_token(session, uid)):
            return token
    return get_settings().github_token


def _client(token: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=f"{get_settings().github_api_url}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "software-karkhana",
        },
        timeout=20,
    )


async def ensure_started(session: AsyncSession, product: Product, user_id: uuid.UUID | None) -> bool:
    """Makes the first commit in the product's repository when it is empty.

    Returns True when Karkhana started the repository now. A repository that has
    any commit is left alone. Failures are logged and leave the caller to report
    the snapshot error as before.
    """
    slug = repos.parse_slug(repo_context.repo_url(product) or "")
    if slug is None:
        return False
    token = await _token(session, product, user_id)
    if not token:
        return False
    async with _client(token) as http:
        try:
            probe = await http.get(f"/repos/{slug}/commits", params={"per_page": 1})
            if probe.status_code != 409:  # GitHub answers 409 "Git Repository is empty"
                return False
            files = {"README.md": readme_for(product)}
            if cfg := agent_config_for(product.settings or {}):
                files[".karkhana/agent.json"] = json.dumps(cfg, indent=2) + "\n"
            for path, text in files.items():
                r = await http.put(
                    f"/repos/{slug}/contents/{path}",
                    json={
                        "message": f"Start {product.name} from its product setup (Software Karkhana)",
                        "content": base64.b64encode(text.encode()).decode(),
                    },
                )
                r.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("Could not start empty repository %s: %s", slug, exc)
            return False
    logger.info("Started empty repository %s for product %s", slug, product.id)
    return True


def context_for(snapshot: RepoSnapshot | None, budget: int) -> str:
    """The repository section of a prompt, with the greenfield note when it applies."""
    if snapshot is None:
        return "REPOSITORY: none connected."
    code = repo_context.render(snapshot, budget)
    return f"{NOTE}\n\n{code}" if is_greenfield(snapshot) else code


async def snapshot_for(session: AsyncSession, product: Product, user_id: uuid.UUID | None) -> RepoSnapshot:
    """The product's code snapshot, starting the repository first when it is empty.

    A snapshot taken before Karkhana started the repository is replaced.
    """
    if await ensure_started(session, product, user_id):
        return await repo_context.take_snapshot(session, product, user_id)
    return await repo_context.latest(session, product.id) or await repo_context.take_snapshot(
        session, product, user_id
    )
