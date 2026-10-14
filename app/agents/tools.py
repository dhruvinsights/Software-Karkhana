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

"""Workspace tools for the ADK Coder agent.

The agent gets exactly five tools, all confined to one checked-out repository.
This is path confinement, not an OS sandbox: ``run_tests`` executes repository
code. The isolation boundary is the worker itself, which holds no GitHub token
or secrets (see ``app/worker/main.py``).
It cannot run arbitrary shell commands, reach the network, or touch git:
cloning, committing and pushing happen in worker code, outside the agent.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

MAX_READ_BYTES = 60_000
MAX_WRITE_BYTES = 120_000
TEST_TIMEOUT_S = 180
TEST_ARGV = (sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider")
# pytest executes repository code (tests, conftest.py) that the agent may have
# written, so it is untrusted. It runs with a minimal environment: no
# GITHUB_TOKEN, RUN_TOKEN or cloud settings are visible to it.
# Only these variables reach the test process. Everything else, including
# GITHUB_TOKEN, RUN_TOKEN and cloud settings, is dropped. Windows needs
# SYSTEMROOT and friends for sockets and asyncio to initialise (WinError 10106).
_PASSTHROUGH_ENV = (
    "PATH",
    "LANG",
    "LC_ALL",
    "TZ",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
)


def safe_test_env() -> dict[str, str]:
    """Builds the minimal, secret-free environment for untrusted test code."""
    env = {k: v for k, v in os.environ.items() if k in _PASSTHROUGH_ENV}
    env.setdefault("PATH", os.defpath)
    env["HOME"] = tempfile.gettempdir()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


class WorkspaceError(ValueError):
    """Raised for paths outside the workspace or disallowed files."""


class Workspace:
    """A path-confined view of one repository checkout (not an OS sandbox)."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def resolve(self, rel_path: str) -> Path:
        """Resolves a repo-relative path, refusing escapes and git internals."""
        candidate = (self.root / rel_path).resolve()
        if candidate != self.root and self.root not in candidate.parents:
            raise WorkspaceError(f"path escapes the workspace: {rel_path}")
        if ".git" in candidate.relative_to(self.root).parts:
            raise WorkspaceError("the .git directory is off limits")
        return candidate

    def run_tests(self) -> tuple[int, str]:
        """Runs the test suite and returns (exit code, output tail)."""
        try:
            proc = subprocess.run(
                TEST_ARGV,
                cwd=self.root,
                env=safe_test_env(),
                capture_output=True,
                text=True,
                timeout=TEST_TIMEOUT_S,
                check=False,
            )
            out = (proc.stdout + proc.stderr)[-6000:]
            return proc.returncode, out
        except subprocess.TimeoutExpired:
            return 124, f"tests timed out after {TEST_TIMEOUT_S}s"


def make_tools(ws: Workspace) -> list:
    """Builds ADK function tools bound to one workspace."""

    def list_files(directory: str = ".") -> dict:
        """Lists files under a directory of the repository.

        Args:
            directory: Repo-relative directory, default the repo root.

        Returns:
            A dict with a sorted list of repo-relative file paths.
        """
        try:
            base = ws.resolve(directory)
        except WorkspaceError as exc:
            return {"error": str(exc)}
        files = sorted(
            p.relative_to(ws.root).as_posix()
            for p in base.rglob("*")
            if p.is_file() and ".git" not in p.parts and "__pycache__" not in p.parts
        )
        return {"files": files[:400]}

    def read_file(path: str) -> dict:
        """Reads a text file from the repository.

        Args:
            path: Repo-relative file path.

        Returns:
            A dict with the file content, or an error.
        """
        try:
            p = ws.resolve(path)
            if not p.is_file():
                return {"error": f"not a file: {path}"}
            data = p.read_bytes()[:MAX_READ_BYTES]
            return {"path": path, "content": data.decode("utf-8", errors="replace")}
        except WorkspaceError as exc:
            return {"error": str(exc)}

    def write_file(path: str, content: str) -> dict:
        """Creates or replaces a text file in the repository.

        Args:
            path: Repo-relative file path.
            content: The complete new file content.

        Returns:
            A dict confirming the write, or an error.
        """
        try:
            p = ws.resolve(path)
            if len(content.encode()) > MAX_WRITE_BYTES:
                return {"error": "file too large"}
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding="utf-8")
            return {"ok": True, "path": path, "bytes": len(content.encode())}
        except WorkspaceError as exc:
            return {"error": str(exc)}

    def replace_in_file(path: str, old: str, new: str) -> dict:
        """Replaces one exact snippet in a file. Prefer this over write_file for edits.

        Args:
            path: Repo-relative file path.
            old: Exact text to find. It must occur exactly once in the file.
            new: Replacement text.

        Returns:
            A dict confirming the edit, or an error explaining why it was refused.
        """
        try:
            p = ws.resolve(path)
            if not p.is_file():
                return {"error": f"not a file: {path}"}
            text = p.read_text(encoding="utf-8")
            count = text.count(old) if old else 0
            if count != 1:
                return {"error": f"'old' must occur exactly once; found {count} times"}
            updated = text.replace(old, new, 1)
            if len(updated.encode()) > MAX_WRITE_BYTES:
                return {"error": "file too large"}
            p.write_text(updated, encoding="utf-8")
            return {"ok": True, "path": path}
        except WorkspaceError as exc:
            return {"error": str(exc)}

    def run_tests() -> dict:
        """Runs the repository's pytest suite.

        Returns:
            A dict with the exit code (0 means all tests passed) and output.
        """
        code, out = ws.run_tests()
        return {"exit_code": code, "passed": code == 0, "output": out}

    return [list_files, read_file, write_file, replace_in_file, run_tests]
