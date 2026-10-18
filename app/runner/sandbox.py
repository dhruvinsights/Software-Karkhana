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

"""Sandbox backend: the coding agent for demo workspaces.

Demo workspaces have no repository, no machine and no model budget, but a
visitor pressing "Build" should still see the whole loop: phases, test suites
going green, an AI review, a pull request on the board and evidence in the
ledger. This backend plays the worker's part with a prepared change for the
story and speaks the worker's exact protocol: the same HMAC-authenticated
``/internal/runs/{id}/progress | tests | complete`` callbacks, delivered
in-process to the API (``bind_app``). Everything after the callback (the
review record, the PR, task moves, stage transitions, the ledger) is the real
control plane.

It is only ever chosen for projects in a sandbox workspace (see
``app.routers.runs.start_run``); clients cannot ask for it.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from typing import Any

import httpx

from app.runner.base import BackendStatus, StartedRun, run_token

logger = logging.getLogger(__name__)

_app: Any = None
_tasks: dict[str, asyncio.Task] = {}


def bind_app(app: Any) -> None:
    """Gives the backend the ASGI app its callbacks go to (called by create_app)."""
    global _app
    _app = app


def step_seconds() -> float:
    """Pause between phases, so people can watch the run (``SANDBOX_RUN_STEP_SECONDS``)."""
    try:
        return max(0.0, float(os.environ.get("SANDBOX_RUN_STEP_SECONDS", "2.5")))
    except ValueError:
        return 2.5


def _module_name(title: str) -> str:
    words = re.findall(r"[a-z0-9]+", title.lower())
    stop = {
        "a",
        "an",
        "the",
        "for",
        "to",
        "of",
        "and",
        "with",
        "from",
        "in",
        "on",
        "at",
        "by",
    }
    picked = [w for w in words if w not in stop][:4] or ["feature"]
    return "_".join(picked)


def _new_file(path: str, content: str) -> str:
    lines = content.rstrip("\n").split("\n")
    return (
        f"diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n"
        f"@@ -0,0 +1,{len(lines)} @@\n" + "".join(f"+{line}\n" for line in lines)
    )


CRD_HOOK = '''"""CDS Hooks order-sign service: tells the provider when prior auth is required (Da Vinci CRD)."""

from fastapi import APIRouter

from pas_gateway.coverage import rules_for

router = APIRouter()

PA_REQUIRED = {"72148", "72149", "72158"}  # MRI lumbar spine


@router.post("/cds-services/order-sign-crd")
async def order_sign(hook: dict) -> dict:
    cards = []
    for order in hook.get("context", {}).get("draftOrders", {}).get("entry", []):
        code = order["resource"]["code"]["coding"][0]["code"]
        if code in PA_REQUIRED:
            rule = rules_for(code)
            cards.append({
                "summary": "Prior authorization required",
                "indicator": "warning",
                "source": {"label": "Arcwell Health CRD"},
                "links": [{"label": "Complete DTR questionnaire", "url": rule.dtr_url, "type": "smart"}],
            })
    return {"cards": cards}
'''

CRD_TEST = """from pas_gateway.routes.crd import PA_REQUIRED, order_sign


async def test_mri_lumbar_needs_prior_auth():
    hook = {"context": {"draftOrders": {"entry": [
        {"resource": {"code": {"coding": [{"code": "72148"}]}}}
    ]}}}
    out = await order_sign(hook)
    assert out["cards"][0]["summary"] == "Prior authorization required"


async def test_other_orders_get_no_card():
    hook = {"context": {"draftOrders": {"entry": [
        {"resource": {"code": {"coding": [{"code": "80053"}]}}}
    ]}}}
    assert (await order_sign(hook))["cards"] == []


def test_codes_are_mri_lumbar():
    assert "72148" in PA_REQUIRED
"""


def prepared_change(task_key: str, title: str) -> tuple[str, list[dict[str, Any]], str]:
    """The patch, AI review comments and handoff summary for a story."""
    if "crd" in title.lower() or "order-sign" in title.lower():
        patch = _new_file("pas_gateway/routes/crd.py", CRD_HOOK) + _new_file(
            "tests/test_crd.py", CRD_TEST
        )
        review = [
            {
                "path": "pas_gateway/routes/crd.py",
                "line": 16,
                "severity": "medium",
                "body": "Only the first coding is read. Orders can carry several codings (CPT and SNOMED); check all of them.",
            },
            {
                "path": "pas_gateway/routes/crd.py",
                "line": 10,
                "severity": "low",
                "body": "Load PA-required codes from the coverage rules table instead of a constant, so policy changes need no deploy.",
            },
        ]
        summary = "Added the CRD order-sign hook for MRI lumbar spine codes with a DTR link, plus three tests."
        return patch, review, summary
    name = _module_name(title)
    code = (
        f'"""{title}."""\n\n\n'
        f"def run(request: dict) -> dict:\n"
        f'    """Entry point for {task_key}."""\n'
        f"    if not request:\n"
        f'        raise ValueError("empty request")\n'
        f'    return {{"status": "ok", "story": "{task_key}"}}\n'
    )
    test = (
        f"import pytest\n\nfrom pas_gateway.{name} import run\n\n\n"
        f"def test_happy_path():\n"
        f'    assert run({{"id": 1}})["status"] == "ok"\n\n\n'
        f"def test_empty_request_is_rejected():\n"
        f"    with pytest.raises(ValueError):\n"
        f"        run({{}})\n"
    )
    patch = _new_file(f"pas_gateway/{name}.py", code) + _new_file(
        f"tests/test_{name}.py", test
    )
    review = [
        {
            "path": f"pas_gateway/{name}.py",
            "line": 7,
            "severity": "low",
            "body": "Return a FHIR OperationOutcome for errors so callers get a consistent shape.",
        }
    ]
    return patch, review, f"Implemented {task_key} with a module and two tests."


class SandboxBackend:
    """Runs a prepared change through the real control plane, in-process."""

    name = "sandbox"

    async def start(self, run_id: uuid.UUID, env_class: str) -> StartedRun:
        """Starts the scripted run in the background."""
        if _app is None:
            raise RuntimeError("sandbox runner is not bound to the API")
        task = asyncio.create_task(_drive(run_id))
        _tasks[str(run_id)] = task
        task.add_done_callback(lambda _t: _tasks.pop(str(run_id), None))
        return StartedRun(external_id=f"sandbox-{run_id}")

    async def status(self, external_id: str) -> BackendStatus:
        """Whether the scripted run is still going."""
        run_id = external_id.removeprefix("sandbox-")
        task = _tasks.get(run_id)
        return BackendStatus("running" if task and not task.done() else "unknown")

    async def cancel(self, external_id: str) -> None:
        """Stops the scripted run."""
        task = _tasks.get(external_id.removeprefix("sandbox-"))
        if task:
            task.cancel()

    def describe(self) -> dict[str, str]:
        """Facts shown in the ledger and the UI."""
        return {
            "backend": "sandbox",
            "note": "demo workspace: prepared change, real control plane",
        }


async def wait_all() -> None:
    """Waits for every sandbox run in flight (tests)."""
    while _tasks:
        await asyncio.gather(*list(_tasks.values()), return_exceptions=True)


async def _drive(run_id: uuid.UUID) -> None:
    pause = step_seconds()
    headers = {"Authorization": f"Run {run_token(run_id)}"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=_app), base_url="http://sandbox", timeout=60
    ) as c:
        try:
            spec = (
                await c.get(f"/internal/runs/{run_id}/spec", headers=headers)
            ).json()
            title, key = spec.get("task_title", "Story"), spec.get("task_key", "ISS")

            async def phase(name: str) -> None:
                await asyncio.sleep(pause)
                await c.post(
                    f"/internal/runs/{run_id}/progress",
                    headers=headers,
                    json={"phase": name},
                )

            async def suite(name: str, status: str, passed: int | None = None) -> None:
                body: dict[str, Any] = {
                    "suite": name,
                    "status": status,
                    "command": f"pytest tests/{name} -q",
                }
                if passed is not None:
                    body.update(
                        passed=passed,
                        failed=0,
                        total=passed,
                        duration_ms=int(passed * 140),
                    )
                await c.post(
                    f"/internal/runs/{run_id}/tests", headers=headers, json=body
                )

            for name in ("cloning", "reading context", "planning", "coding"):
                await phase(name)
            await phase("testing")
            await suite("unit", "running")
            await asyncio.sleep(pause)
            await suite("unit", "passed", 64)
            await suite("integration", "running")
            await asyncio.sleep(pause)
            await suite("integration", "passed", 19)
            await phase("reviewing")
            patch, review, summary = prepared_change(key, title)
            await asyncio.sleep(pause)
            r = await c.post(
                f"/internal/runs/{run_id}/complete",
                headers=headers,
                json={
                    "ok": True,
                    "patch": patch,
                    "test_command": "pytest -q",
                    "test_exit_code": 0,
                    "test_output": "83 passed in 11.62s",
                    "review": review,
                    "reviewed": True,
                    "review_engine": "adk",
                    "review_model": "sandbox-reviewer",
                    "review_summary": f"{len(review)} suggestion(s); no blocking issues. Tests cover the acceptance criteria.",
                    "summary": summary,
                },
            )
            if r.status_code >= 400:
                logger.warning(
                    "Sandbox run %s: complete returned %s %s",
                    run_id,
                    r.status_code,
                    r.text[:300],
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Sandbox run %s failed", run_id)
            await c.post(
                f"/internal/runs/{run_id}/complete",
                headers=headers,
                json={
                    "ok": False,
                    "error": "The sandbox runner stopped unexpectedly. Press Build to try again.",
                },
            )
