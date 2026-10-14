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

"""A5: the app role cannot UPDATE/DELETE the ledger. A8: the worker runs real tests."""

from __future__ import annotations

import shutil
import subprocess
import uuid
from pathlib import Path

import asyncpg
import pytest

from app.ai import fallbacks
from app.schemas import ReviewOutput, RunSpec
from app.worker import main as worker

APP_DSN = "postgresql://karkhana_app:karkhana_app@localhost:5432/karkhana_test"
DEMO = Path(__file__).resolve().parents[2] / "demo-repo"


async def test_app_role_cannot_rewrite_ledger(database):
    conn = await asyncpg.connect(APP_DSN)
    try:
        await conn.execute(
            "INSERT INTO ledger (actor_label, actor_kind, action, subject_type, subject_id, created_at, prev_hash, hash) "
            "VALUES ('t','system','test','x','1',now(),'p',$1)",
            uuid.uuid4().hex,
        )
        for sql in (
            "UPDATE ledger SET action='forged'",
            "DELETE FROM ledger",
            "TRUNCATE ledger",
        ):
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await conn.execute(sql)
    finally:
        await conn.close()


async def test_owner_is_blocked_by_trigger(database):
    conn = await asyncpg.connect(database.replace("+asyncpg", ""))
    try:
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="append-only"):
            await conn.execute("UPDATE ledger SET action='forged'")
    finally:
        await conn.close()


class FakeCP:
    def __init__(self):
        self.phases = []

    async def progress(self, phase):
        self.phases.append(phase)


@pytest.fixture
def bare_repo(tmp_path):
    src = tmp_path / "src"
    shutil.copytree(DEMO, src)
    run = lambda *a, cwd=src: subprocess.run(
        a, cwd=cwd, check=True, capture_output=True
    )  # noqa: E731
    run("git", "init", "-q", "-b", "main")
    run("git", "add", "-A")
    run("git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base")
    bare = tmp_path / "remote.git"
    run("git", "clone", "-q", "--bare", str(src), str(bare), cwd=tmp_path)
    return bare


def spec(bare) -> RunSpec:
    return RunSpec(
        run_id=uuid.uuid4(),
        task_key="KAR-1",
        task_title="Apply a percentage discount code",
        task_description="",
        acceptance_criteria=["Discount before tax"],
        project_name="Demo",
        repo=None,
        repo_url=f"file://{bare}",
        base_branch="main",
    )


@pytest.mark.parametrize("break_tests", [False, True])
async def test_worker_reports_real_exit_code(bare_repo, monkeypatch, break_tests):
    async def fake_coder(ws, **kw):
        patch = ws.root / "p.diff"
        patch.write_text(fallbacks.demo_patch())
        subprocess.run(["git", "apply", str(patch)], cwd=ws.root, check=True)
        patch.unlink()
        if break_tests:  # The agent claims success but leaves a failing test.
            (ws.root / "tests" / "test_bad.py").write_text(
                "def test_bad():\n    assert 1 == 2\n"
            )
        return "All tests pass!"

    async def fake_reviewer(diff, **kw):
        return ReviewOutput.model_validate(fallbacks.review().model_dump())

    import app.agents.coder as coder

    monkeypatch.setattr(coder, "run_coder", fake_coder)
    monkeypatch.setattr(coder, "run_reviewer", fake_reviewer)
    cp = FakeCP()
    s = spec(bare_repo)
    result = await worker.build(s, cp)

    assert result.ok
    assert result.test_exit_code == (1 if break_tests else 0)
    assert "invoicekit/discounts.py" in result.patch
    assert len(result.review) == 4
    assert cp.phases == ["cloning", "coding", "validating", "reviewing"]
    # The worker published nothing: the remote still has only main.
    branches = subprocess.run(
        ["git", "branch"], cwd=bare_repo, capture_output=True, text=True
    ).stdout
    assert branches.strip() == "* main"


def test_worker_module_has_no_github_access():
    import inspect

    src = inspect.getsource(worker)
    assert "app.integrations" not in src  # No GitHub client.
    assert "github_token" not in src.lower()  # Never reads the token.
    assert "push" not in src  # Never pushes.


@pytest.mark.parametrize("tests_passed", [True, False])
async def test_control_plane_publishes_patch(bare_repo, monkeypatch, tests_passed):
    from app import publisher
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "demo_repo_url", f"file://{bare_repo}")
    run_id = uuid.uuid4()
    out = await publisher.publish(
        run_id=run_id,
        task_key="KAR-1",
        task_title="Discounts",
        patch=fallbacks.demo_patch(),
        pr_body="body",
        tests_passed=tests_passed,
        test_summary="pytest exit 0",
        review_markdown=None,
    )
    assert out.pr_url.startswith("local://") and len(out.head_sha) == 40
    assert out.draft is (not tests_passed)  # Failing tests -> draft PR.
    files = subprocess.run(
        ["git", "show", "--name-only", "--format=", out.branch],
        cwd=bare_repo,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert "invoicekit/discounts.py" in files


async def test_publisher_rejects_bad_patches():
    from app import publisher

    for bad in ("", "x" * (publisher.MAX_PATCH_BYTES + 1)):
        with pytest.raises(publisher.PublishError):
            await publisher.publish(
                run_id=uuid.uuid4(),
                task_key="K",
                task_title="t",
                patch=bad,
                pr_body="",
                tests_passed=True,
                test_summary="",
                review_markdown=None,
            )
