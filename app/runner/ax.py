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

"""google/ax backend: each run is an AX Task on Kubernetes + Agent Substrate.

The control plane renders ``Task`` (and, when a repository is configured,
``Workspace``) manifests, checks them with ``tools/axcheck`` (which uses AX's
own validators) and submits them with the ``ax`` CLI. Nothing is simulated:
when ``ax``, ``kubectl`` or the cluster is missing the run fails with the
CLI's own message so the UI can show the real reason.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import uuid

import yaml

from app.config import get_settings
from app.runner.base import BackendStatus, StartedRun, worker_env

logger = logging.getLogger(__name__)

API_VERSION = "ax.io/v1alpha1"
RESOURCES = {
    "small": ("500m", "1Gi", "1", "2Gi"),
    "standard": ("1", "2Gi", "2", "4Gi"),
    "large": ("2", "4Gi", "4", "8Gi"),
}


class AxError(RuntimeError):
    """The AX CLI or cluster refused or could not run a command."""


def task_name(run_id: uuid.UUID | str) -> str:
    """RFC 1123 label: AX requires lowercase alphanumerics and dashes, 63 max."""
    return f"run-{run_id}"[:63].rstrip("-")


def build_manifests(run_id: uuid.UUID, env_class: str) -> list[dict]:
    """Renders the AX documents for one run."""
    s = get_settings()
    if not s.ax_task_image:
        raise AxError("AX_TASK_IMAGE is not set: no image contains the worker")
    cpu_req, mem_req, cpu_lim, mem_lim = RESOURCES.get(env_class, RESOURCES["standard"])
    name = task_name(run_id)
    spec: dict = {
        "image": s.ax_task_image,
        "command": ["python", "-m", "app.worker.main"],
        "env": [{"name": k, "value": v} for k, v in worker_env(run_id).items()],
        "resources": {
            "requests": {"cpu": cpu_req, "memory": mem_req},
            "limits": {"cpu": cpu_lim, "memory": mem_lim},
        },
    }
    docs: list[dict] = []
    if s.github_repo:
        spec["workspaces"] = [{"name": name, "path": "/workspace"}]
        docs.append(
            {
                "apiVersion": API_VERSION,
                "kind": "Workspace",
                "metadata": {"name": name, "atespace": s.ax_atespace},
                "spec": {
                    "git": [
                        {
                            "name": "origin",
                            "repo": f"https://github.com/{s.github_repo}.git",
                            "branch": "main",
                        }
                    ]
                },
            }
        )
    docs.append(
        {
            "apiVersion": API_VERSION,
            "kind": "Task",
            "metadata": {"name": name, "atespace": s.ax_atespace},
            "spec": spec,
        }
    )
    return docs


def render(docs: list[dict]) -> str:
    """Multi-document YAML."""
    return yaml.safe_dump_all(docs, sort_keys=False)


async def _exec(*args: str, stdin: str | None = None, limit_s: float = 60) -> str:
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE if stdin is not None else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise AxError(f"{args[0]} is not installed or not on PATH") from exc
    try:
        async with asyncio.timeout(limit_s):
            out, err = await proc.communicate(
                stdin.encode() if stdin is not None else None
            )
    except TimeoutError as exc:
        proc.kill()
        raise AxError(f"{args[0]} timed out after {limit_s:.0f}s") from exc
    if proc.returncode != 0:
        detail = (err or out).decode(errors="replace").strip()
        raise AxError(f"{args[0]} exited {proc.returncode}: {detail[-500:]}")
    return out.decode(errors="replace")


def _ax(*args: str) -> list[str]:
    s = get_settings()
    cmd = [s.ax_bin, *args]
    if s.ax_server:
        cmd += ["--server", s.ax_server]
    return cmd


async def validate(manifest: str) -> None:
    """Runs the manifest through AX's own validators when ``axcheck`` is built."""
    path = get_settings().axcheck_bin
    if not path or not await asyncio.to_thread(shutil.which, path):
        return
    try:
        await _exec(path, stdin=manifest, limit_s=20)
    except AxError as exc:
        raise AxError(f"AX rejected the manifest: {exc}") from exc


def parse_phase(table: str, name: str) -> str | None:
    """Reads PHASE for ``name`` from ``ax get tasks`` (NAME ATESPACE PHASE ...)."""
    for line in table.splitlines()[1:]:
        cols = line.split()
        if len(cols) >= 3 and cols[0] == name:
            return cols[2]
    return None


class AxBackend:
    """Submits runs to a google/ax cluster."""

    name = "ax"

    async def start(self, run_id: uuid.UUID, env_class: str) -> StartedRun:
        """Validates and applies the run's Task, returning ``atespace/name``."""
        s = get_settings()
        manifest = render(build_manifests(run_id, env_class))
        await validate(manifest)
        await _exec(*_ax("apply", "-f", "-"), stdin=manifest)
        external_id = f"{s.ax_atespace}/{task_name(run_id)}"
        logger.info("Applied AX task %s for run %s", external_id, run_id)
        return StartedRun(external_id=external_id)

    async def status(self, external_id: str) -> BackendStatus:
        """Maps the AX phase to a coarse state."""
        atespace, _, name = external_id.partition("/")
        try:
            table = await _exec(*_ax("get", "tasks", "-a", atespace), limit_s=30)
        except AxError as exc:
            return BackendStatus("unknown", str(exc))
        phase = parse_phase(table, name)
        if phase is None:
            return BackendStatus("unknown", "task not found in AX")
        if phase == "Failed":
            return BackendStatus("failed", phase)
        if phase in {"Running", "Suspended", "Pending"}:
            return BackendStatus("running", phase)
        return BackendStatus("unknown", phase)

    async def cancel(self, external_id: str) -> None:
        """Deletes the Task, which stops its actor."""
        atespace, _, name = external_id.partition("/")
        await _exec(*_ax("delete", "task", name, "-a", atespace), limit_s=30)

    def describe(self) -> dict[str, str]:
        """Facts for the UI."""
        s = get_settings()
        return {
            "backend": "ax",
            "atespace": s.ax_atespace,
            "isolation": "AX Task actor on Agent Substrate",
            "server": s.ax_server or "kube context",
        }


def manifest_summary(docs: list[dict]) -> str:
    """Compact JSON used in the ledger so the exact submission is auditable."""
    return json.dumps([(d["kind"], d["metadata"]["name"]) for d in docs])
