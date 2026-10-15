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

"""AX manifest generation, validated by AX's own Go validators."""

from __future__ import annotations

import os
import shutil
import uuid

import pytest

from app.config import get_settings
from app.runner import ax


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    monkeypatch.setenv("AX_TASK_IMAGE", "registry.example/karkhana-worker:1")
    monkeypatch.setenv("AX_ATESPACE", "karkhana")
    monkeypatch.setenv("GITHUB_REPO", "acme/shop")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_task_name_is_a_valid_rfc1123_label():
    name = ax.task_name(uuid.uuid4())
    assert name.startswith("run-") and len(name) <= 63
    assert name == name.lower() and not name.endswith("-")


def test_manifests_carry_worker_env_and_a_workspace():
    rid = uuid.uuid4()
    docs = ax.build_manifests(rid, "standard")
    assert [d["kind"] for d in docs] == ["Workspace", "Task"]
    task = docs[1]["spec"]
    env = {e["name"]: e["value"] for e in task["env"]}
    assert env["RUN_ID"] == str(rid) and env["RUN_TOKEN"]
    assert task["command"] == ["python", "-m", "app.worker.main"]
    assert docs[0]["spec"]["git"][0]["repo"] == "https://github.com/acme/shop.git"


def test_no_image_is_an_honest_error(monkeypatch):
    monkeypatch.delenv("AX_TASK_IMAGE")
    get_settings.cache_clear()
    with pytest.raises(ax.AxError, match="AX_TASK_IMAGE"):
        ax.build_manifests(uuid.uuid4(), "small")


def test_parse_phase_reads_the_ax_table():
    table = (
        "NAME ATESPACE PHASE ACTOR WORKER-IP AGE\n"
        "run-a karkhana Running actor-1 10.0.0.4 3s\n"
    )
    assert ax.parse_phase(table, "run-a") == "Running"
    assert ax.parse_phase(table, "run-b") is None


async def test_missing_cli_is_reported_not_faked(monkeypatch):
    monkeypatch.setenv("AX_BIN", "/nonexistent/ax")
    get_settings.cache_clear()
    with pytest.raises(ax.AxError, match="not installed"):
        await ax.AxBackend().start(uuid.uuid4(), "standard")


@pytest.mark.skipif(
    not (os.environ.get("AXCHECK_BIN") and shutil.which(os.environ["AXCHECK_BIN"])),
    reason="build tools/axcheck and set AXCHECK_BIN to run AX's own validators",
)
async def test_generated_manifests_pass_ax_validators(monkeypatch):
    monkeypatch.setenv("AXCHECK_BIN", os.environ["AXCHECK_BIN"])
    get_settings.cache_clear()
    manifest = ax.render(ax.build_manifests(uuid.uuid4(), "large"))
    await ax.validate(manifest)  # raises AxError if AX rejects it
