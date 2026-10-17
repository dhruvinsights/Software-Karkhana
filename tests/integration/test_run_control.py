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

"""The developer steers a build: what the agent is given, and every decision on the way."""

from __future__ import annotations

from app.runner.base import run_token
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    PM,
    as_,
    client,
    fakes,
)
from tests.integration.test_run_publish import _ready_story


def _auth(run_id):
    return {"Authorization": f"Run {run_token(run_id)}"}


async def test_the_developer_picks_what_the_agent_is_given(client, fakes):
    pid, story = await _ready_story(client)
    tid = story["taskId"]
    # A note on the project that the developer may or may not pass on.
    r = await client.post(
        f"/api/projects/{pid}/context", headers=as_(PM), json={"kind": "decision", "title": "Use Decimal", "body": "Money is Decimal."}
    )
    assert r.status_code in (200, 201), r.text

    preview = (await client.get(f"/api/tasks/{tid}/brief-preview", headers=as_(DEV))).json()
    assert preview["story"]["key"] == story["key"]
    assert len(preview["criteria"]) >= 2 and preview["criteria"][0]["index"] == 0
    note = next(n for n in preview["notes"] if n["title"] == "Use Decimal")
    assert {p["id"] for p in preview["pauses"]} == {"after_code", "before_tests", "fix"}
    assert preview["estimateTokens"] > 0

    # Only the first criterion, and no shared notes at all, plus a focus and an instruction.
    body = {
        "backend": "device",
        "control": {"mode": "step"},
        "brief": {"criteria": [0], "notes": [], "focus": ["app/", "./tests/test_x.py"], "instruction": "Keep it in one file."},
    }
    bad = await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV), json={**body, "brief": {"focus": ["../secret"]}})
    assert bad.status_code == 422
    bad = await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV), json={**body, "brief": {"focus": ["/etc/passwd"]}})
    assert bad.status_code == 422
    # No machine in tests: use the default backend, which records the same brief.
    body["backend"] = None
    r = await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV), json=body)
    assert r.status_code == 202, r.text
    run_id = r.json()["id"]
    assert r.json()["control"]["pauses"] == ["after_code", "before_tests", "fix"]

    spec = (await client.get(f"/internal/runs/{run_id}/spec", headers=_auth(run_id))).json()
    assert spec["acceptance_criteria"] == [story["acceptanceCriteria"][0]]
    assert all(n["id"] != note["id"] for n in spec["context"])
    assert spec["brief"]["focus"] == ["app/", "tests/test_x.py"] and spec["brief"]["instruction"] == "Keep it in one file."
    assert spec["control"]["mode"] == "step"


async def test_a_build_without_a_brief_gets_everything(client, fakes):
    _pid, story = await _ready_story(client)
    r = await client.post(f"/api/tasks/{story['taskId']}/runs", headers=as_(DEV))
    run_id = r.json()["id"]
    spec = (await client.get(f"/internal/runs/{run_id}/spec", headers=_auth(run_id))).json()
    assert spec["acceptance_criteria"] == story["acceptanceCriteria"]
    assert spec["control"] is None and spec["brief"] is None


async def test_a_pause_waits_for_the_developer_and_only_the_right_answer_goes_through(client, fakes):
    pid, story = await _ready_story(client)
    r = await client.post(
        f"/api/tasks/{story['taskId']}/runs", headers=as_(DEV), json={"control": {"mode": "custom", "pauses": ["after_code"]}}
    )
    run_id = r.json()["id"]
    assert r.json()["control"]["pauses"] == ["after_code"]
    auth = _auth(run_id)

    # Nothing to answer yet.
    assert (await client.post(f"/api/runs/{run_id}/gate", headers=as_(DEV), json={"gate_id": "x", "action": "go"})).status_code == 409

    opened = await client.post(
        f"/internal/runs/{run_id}/gate",
        headers=auth,
        json={
            "name": "after_code",
            "summary": "The agent changed 4 files ($0.42).",
            "options": [
                {"id": "go", "label": "Run the tests"},
                {"id": "change", "label": "Ask for a change", "needs_note": True},
            ],
        },
    )
    assert opened.status_code == 200
    board = (await client.get(f"/api/projects/{pid}/dev-board", headers=as_(DEV))).json()
    gate = board["stories"][0]["run"]["gate"]
    assert gate["name"] == "after_code" and gate["decision"] is None and "4 files" in gate["summary"]
    # The machine keeps asking; there is no answer yet.
    assert (await client.get(f"/internal/runs/{run_id}/gate", headers=auth)).json()["gate"]["decision"] is None

    def answer(**kw):
        return client.post(f"/api/runs/{run_id}/gate", headers=as_(DEV), json={"gate_id": gate["id"], **kw})

    assert (await answer(action="deploy")).status_code == 422
    assert (await answer(action="change")).status_code == 422  # needs a note
    assert (await client.post(f"/api/runs/{run_id}/gate", headers=as_(DEV), json={"gate_id": "stale", "action": "go"})).status_code == 409
    r = await answer(action="change", note="Return 404, not 500.")
    assert r.status_code == 200 and r.json()["decision"]["note"] == "Return 404, not 500."
    assert (await answer(action="go")).status_code == 409  # already answered

    polled = (await client.get(f"/internal/runs/{run_id}/gate", headers=auth)).json()
    assert polled["gate"]["decision"]["action"] == "change" and polled["status"] == "running"
    # The machine clears the question and asks the next one.
    await client.post(f"/internal/runs/{run_id}/gate", headers=auth, json={"clear": True})
    assert (await client.get(f"/internal/runs/{run_id}/gate", headers=auth)).json()["gate"] is None


async def test_stop_at_a_pause_ends_the_run(client, fakes):
    _pid, story = await _ready_story(client)
    run_id = (await client.post(f"/api/tasks/{story['taskId']}/runs", headers=as_(DEV))).json()["id"]
    auth = _auth(run_id)
    await client.post(f"/internal/runs/{run_id}/gate", headers=auth, json={"name": "fix", "summary": "unit failing"})
    gate = (await client.get(f"/internal/runs/{run_id}/gate", headers=auth)).json()["gate"]
    r = await client.post(f"/api/runs/{run_id}/gate", headers=as_(DEV), json={"gate_id": gate["id"], "action": "stop"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert (await client.get(f"/internal/runs/{run_id}/gate", headers=auth)).json()["status"] == "cancelled"
