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

"""What the AI knows about a product's code: a repomix snapshot per commit.

``take_snapshot`` clones the product repository, packs it with repomix
(``--compress`` keeps imports, signatures and comments, drops function bodies)
and stores the result in ``repo_snapshots``. Every later step reads the latest
snapshot: ``render`` turns it into prompt context within a character budget,
and ``paths`` is the ground truth used to reject file paths a model invents.
"""

from __future__ import annotations

import asyncio
import json
import shlex
import tempfile
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.integrations import github_tokens
from app.integrations.github import git_auth_header
from app.models import Product, RepoSnapshot

# Lockfiles and generated assets carry no design information.
_IGNORE = ",".join(
    (
        "**/*.lock",
        "**/package-lock.json",
        "**/pnpm-lock.yaml",
        "**/*.svg",
        "**/*.min.*",
        "**/*.map",
    )
)
_MANIFESTS = frozenset(
    {
        "package.json",
        "pyproject.toml",
        "requirements.txt",
        "go.mod",
        "Cargo.toml",
        "pom.xml",
        "build.gradle",
        "Dockerfile",
        "docker-compose.yml",
        "compose.yaml",
        "Makefile",
    }
)
_CORE_DIRS = frozenset({"app", "src", "api", "server", "backend", "lib", "core", "pkg", "cmd"})
_TEST_MARKERS = ("test", "tests", "spec", "__tests__")


class RepoContextError(RuntimeError):
    """The repository could not be cloned or packed."""


def repo_url(product: Product) -> str | None:
    """The product's repository URL from its setup, if any."""
    settings = product.settings if isinstance(product.settings, dict) else {}
    url = str(settings.get("repositoryUrl") or "").strip()
    return url or None


async def _run(*argv: str, cwd: Path | None = None, timeout: float = 300) -> str:  # noqa: ASYNC109
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError as exc:
        proc.kill()
        raise RepoContextError(f"{argv[0]} timed out after {timeout:.0f}s") from exc
    if proc.returncode != 0:
        raise RepoContextError(err.decode(errors="replace")[-500:])
    return out.decode(errors="replace")


@asynccontextmanager
async def checkout(url: str, token: str | None) -> AsyncIterator[Path]:
    """A shallow clone in a temporary directory, deleted afterwards.

    The token travels in an HTTP header, never in the URL, so it cannot land
    in ``.git/config`` or in an error message.
    """
    with tempfile.TemporaryDirectory(prefix="karkhana-repo-") as tmp:
        dest = Path(tmp) / "repo"
        argv = ["git"]
        if token and url.startswith("https://github.com/"):
            argv += ["-c", f"http.https://github.com/.extraheader={git_auth_header(token)}"]
        argv += ["clone", "--quiet", "--depth", "1", url, str(dest)]
        try:
            await _run(*argv, timeout=180)
        except RepoContextError as exc:
            raise RepoContextError(f"git clone failed: {exc}") from None
        yield dest


async def pack(repo_dir: Path) -> tuple[str, dict[str, str]]:
    """Runs repomix and returns ``(directory tree, {path: compressed content})``."""
    argv = [
        *shlex.split(get_settings().repomix_cmd),
        str(repo_dir),
        "--style",
        "json",
        "--compress",
        "--remove-empty-lines",
        "--stdout",
        "--quiet",
        "--ignore",
        _IGNORE,
    ]
    raw = await _run(*argv, timeout=600)
    try:
        packed = json.loads(raw)
        return packed["directoryStructure"], dict(packed["files"])
    except (json.JSONDecodeError, KeyError) as exc:
        raise RepoContextError(f"unexpected repomix output: {exc}") from exc


async def take_snapshot(
    session: AsyncSession, product: Product, user_id: uuid.UUID | None
) -> RepoSnapshot:
    """Clones and packs the product repository, then stores the snapshot.

    Uses the requesting user's GitHub token (private repositories), else the
    server token. Raises :class:`RepoContextError` on any failure.
    """
    url = repo_url(product)
    if not url:
        raise RepoContextError("The product has no repository URL. Set it in Product Setup.")
    if product.workspace_id is None:
        raise RepoContextError("The product has no workspace.")
    token = await github_tokens.load_token(session, user_id) if user_id else None
    token = token or get_settings().github_token
    async with checkout(url, token) as repo_dir:
        sha = (await _run("git", "rev-parse", "HEAD", cwd=repo_dir)).strip()
        tree, files = await pack(repo_dir)
    snap = RepoSnapshot(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=product.workspace_id,
        repo_url=url,
        commit_sha=sha,
        tree=tree,
        files=files,
        file_count=len(files),
        chars=sum(map(len, files.values())),
        created_by=user_id,
    )
    session.add(snap)
    await session.flush()
    return snap


async def latest(session: AsyncSession, product_id: uuid.UUID) -> RepoSnapshot | None:
    """The newest snapshot of a product, if one was taken."""
    return await session.scalar(
        select(RepoSnapshot)
        .where(RepoSnapshot.product_id == product_id)
        .order_by(RepoSnapshot.created_at.desc())
        .limit(1)
    )


def _priority(path: str) -> tuple[int, int, int]:
    """Sort key: docs and manifests, then core source, then the rest, then tests.

    Within a group, shallow files come first: they are usually entry points.
    """
    p = PurePosixPath(path)
    name, parts = p.name, [part.lower() for part in p.parts]
    if name.lower().startswith("readme") or name in _MANIFESTS or ".github" in parts:
        group = 0
    elif any(marker in part for part in parts for marker in _TEST_MARKERS):
        group = 3
    elif parts and parts[0] in _CORE_DIRS:
        group = 1
    else:
        group = 2
    return group, len(parts), len(path)


def render(snapshot: RepoSnapshot, budget_chars: int | None = None) -> str:
    """Prompt-ready repository context within ``budget_chars``.

    The full directory tree always goes first, so the model sees every path;
    file contents follow in priority order until the budget runs out, and the
    paths left out are named so the model knows they exist.
    """
    budget = budget_chars or get_settings().repo_context_budget_chars
    parts = [
        f"REPOSITORY {snapshot.repo_url} @ {snapshot.commit_sha[:12]} "
        f"({snapshot.file_count} files; bodies compressed to signatures)",
        "<tree>\n" + snapshot.tree.strip() + "\n</tree>",
    ]
    used = sum(map(len, parts))
    skipped: list[str] = []
    for path in sorted(snapshot.files, key=_priority):
        block = f'<file path="{path}">\n{snapshot.files[path].strip()}\n</file>'
        if used + len(block) > budget:
            skipped.append(path)
            continue
        parts.append(block)
        used += len(block)
    if skipped:
        parts.append(
            f"<omitted reason='context budget'>{len(skipped)} files: "
            + ", ".join(skipped[:200])
            + "</omitted>"
        )
    return "\n\n".join(parts)


def known_path(snapshot: RepoSnapshot, cited: str) -> bool:
    """True when ``cited`` is a file in the snapshot or a directory containing one.

    Models cite paths with leading ``./`` or ``/`` and line suffixes such as
    ``app/main.py:42``; those are normalised before the check.
    """
    path = cited.strip().strip("`").removeprefix("./").lstrip("/")
    path = path.split(":", 1)[0].split("#", 1)[0].rstrip("/")
    if not path:
        return False
    if path in snapshot.files:
        return True
    prefix = path + "/"
    return any(f.startswith(prefix) for f in snapshot.files)
