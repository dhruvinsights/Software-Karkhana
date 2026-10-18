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

"""A green build waits for the developer, who decides when and where it becomes a pull request."""

from __future__ import annotations

from app.runner.base import run_token
from tests.integration.test_dev_qa import _story
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    PM,
    as_,
    client,
    fakes,
)

PATCH = (
    "diff --git a/app/thing.py b/app/thing.py\nnew file mode 100644\n--- /dev/null\n+++ b/app/thing.py\n"
    "@@ -0,0 +1,2 @@\n+def thing():\n+    return 1\n"
)


async def _ready_story(client):
    """A story the developer took ("Take it" makes it Ready), as the Developer station does."""
    pid, story = await _story(client)
    r = await client.patch(f"/api/issues/{story['id']}", headers=as_(DEV), json={"status": "ready"})
    assert r.status_code == 200, r.text
    return pid, story


async def _start(client, tid):
    r = await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))
    assert r.status_code == 202, r.text
    run_id = r.json()["id"]
    return run_id, {"Authorization": f"Run {run_token(run_id)}"}


def _built(exit_code=0, **extra):
    return {
        "ok": True,
        "publish": False,
        "patch": PATCH,
        "test_command": "pytest",
        "test_exit_code": exit_code,
        "test_output": "3 passed",
        "test_suites": [{"suite": "unit", "status": "passed" if exit_code == 0 else "failed", "passed": 3, "total": 3}],
        "summary": "Added thing().",
        **extra,
    }


async def test_a_built_change_waits_until_the_developer_raises_it(client, fakes):
    pid, story = await _ready_story(client)
    tid = story["taskId"]
    run_id, auth = await _start(client, tid)

    r = await client.post(f"/internal/runs/{run_id}/complete", json=_built(), headers=auth)
    assert r.status_code == 200 and r.json()["status"] == "succeeded", r.text
    run = (await client.get(f"/api/runs/{run_id}", headers=as_(DEV))).json()
    assert run["status"] == "succeeded" and run["phase"] == "built" and run["validation_status"] == "passed"
    # No pull request exists, and the story is still being worked on.
    assert (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json() is None
    board = (await client.get(f"/api/projects/{pid}/dev-board", headers=as_(DEV))).json()
    assert board["stories"][0]["status"] == "in_progress" and board["stories"][0]["pr"] is None

    # The change can be reviewed before anything is pushed.
    diff = (await client.get(f"/api/runs/{run_id}/diff", headers=as_(DEV))).json()
    assert diff["files"][0]["path"] == "app/thing.py" and diff["additions"] == 2

    bad = await client.post(f"/api/runs/{run_id}/publish", headers=as_(DEV), json={"branch": "bad branch!"})
    assert bad.status_code == 422
    r = await client.post(
        f"/api/runs/{run_id}/publish",
        headers=as_(DEV),
        json={"base_branch": "develop", "branch": "feature/entries", "title": "Entries endpoint"},
    )
    assert r.status_code == 201, r.text
    pr = (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json()
    assert pr["branch"] == "feature/entries" and pr["tests_passed"]
    assert (await client.get(f"/api/runs/{run_id}", headers=as_(DEV))).json()["phase"] == "done"
    board = (await client.get(f"/api/projects/{pid}/dev-board", headers=as_(DEV))).json()
    assert board["stories"][0]["status"] == "in_review"

    again = await client.post(f"/api/runs/{run_id}/publish", headers=as_(DEV), json={})
    assert again.status_code == 409 and "already raised" in again.text


async def test_a_red_build_cannot_be_raised(client, fakes):
    _pid, story = await _ready_story(client)
    run_id, auth = await _start(client, story["taskId"])
    await client.post(f"/internal/runs/{run_id}/complete", json=_built(exit_code=1), headers=auth)
    r = await client.post(f"/api/runs/{run_id}/publish", headers=as_(DEV), json={})
    assert r.status_code == 409 and "did not pass" in r.text


async def test_a_built_story_can_be_built_again_until_a_pr_is_open(client, fakes):
    _pid, story = await _ready_story(client)
    tid = story["taskId"]
    run_id, auth = await _start(client, tid)
    # Still running: no second build.
    assert (await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))).status_code == 409
    await client.post(f"/internal/runs/{run_id}/complete", json=_built(), headers=auth)
    # Built, not raised: the next build continues it.
    second, _auth2 = await _start(client, tid)
    assert second != run_id
    await client.post(f"/api/runs/{second}/cancel", headers=as_(DEV))
    # With a pull request open it is the review's turn, not another build.
    third, auth3 = await _start(client, tid)
    await client.post(f"/internal/runs/{third}/complete", json=_built(), headers=auth3)
    assert (await client.post(f"/api/runs/{third}/publish", headers=as_(DEV), json={})).status_code == 201
    assert (await client.post(f"/api/tasks/{tid}/runs", headers=as_(DEV))).status_code == 409


async def test_stop_ends_a_running_build_and_the_story_is_ready_again(client, fakes):
    pid, story = await _ready_story(client)
    run_id, auth = await _start(client, story["taskId"])
    r = await client.post(f"/api/runs/{run_id}/cancel", headers=as_(DEV))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    # The agent's next heartbeat learns the run is over.
    hb = await client.post(f"/internal/runs/{run_id}/progress", json={"phase": "coding"}, headers=auth)
    assert hb.json()["status"] == "cancelled"
    assert (await client.post(f"/api/runs/{run_id}/cancel", headers=as_(DEV))).status_code == 409
    board = (await client.get(f"/api/projects/{pid}/dev-board", headers=as_(DEV))).json()
    assert board["stories"][0]["status"] == "ready"


async def test_what_the_reviewer_asked_for_reaches_the_next_build(client, fakes):
    _pid, story = await _ready_story(client)
    tid = story["taskId"]
    first, auth = await _start(client, tid)
    spec = (await client.get(f"/internal/runs/{first}/spec", headers=auth)).json()
    assert spec["rework"] is None
    await client.post(f"/internal/runs/{first}/complete", json=_built(), headers=auth)
    await client.post(f"/api/runs/{first}/publish", headers=as_(DEV), json={})
    pr = (await client.get(f"/api/tasks/{tid}/pr", headers=as_(DEV))).json()
    reason = "Return 404, not 500, for an unknown customer."
    assert (await client.post(f"/api/prs/{pr['id']}/rework", json={"reason": reason}, headers=as_(DEV))).status_code == 200
    second, auth2 = await _start(client, tid)
    spec = (await client.get(f"/internal/runs/{second}/spec", headers=auth2)).json()
    assert spec["rework"] == reason


async def test_the_developer_chooses_the_folder_per_project(client, fakes):
    pid, _story_row = await _story(client)
    code = (await client.post("/api/devices/pairing", headers=as_(DEV))).json()["code"]
    paired = (await client.post("/api/agent/pair", json={"code": code, "name": "laptop", "platform": "darwin", "harness": "bob"})).json()
    did, token = paired["deviceId"], paired["token"]

    path = "~/code/udhaar"
    for bad in ("relative/dir", "/a/../b"):
        r = await client.put(f"/api/devices/{did}/paths", headers=as_(DEV), json={"project_id": pid, "path": bad})
        assert r.status_code == 422
    r = await client.put(f"/api/devices/{did}/paths", headers=as_(DEV), json={"project_id": pid, "path": path})
    assert r.status_code == 200 and r.json()["workPaths"] == {pid: path}
    listed = (await client.get("/api/devices", headers=as_(DEV))).json()
    assert listed[0]["workPaths"] == {pid: path}
    # Somebody else's machine is not editable.
    assert (await client.put(f"/api/devices/{did}/paths", headers=as_(PM), json={"project_id": pid, "path": path})).status_code == 404
    # Clearing it falls back to the agent's default folder.
    r = await client.put(f"/api/devices/{did}/paths", headers=as_(DEV), json={"project_id": pid, "path": ""})
    assert r.json()["workPaths"] == {}
    # Leave no online machine behind: other tests check what happens without one.
    assert (await client.delete(f"/api/devices/{did}", headers=as_(DEV))).status_code == 204
    _ = token
