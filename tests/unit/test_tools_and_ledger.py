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

import datetime as dt
import shutil
from pathlib import Path

import pytest

from app import ledger
from app.agents.tools import Workspace, WorkspaceError, make_tools

DEMO = Path(__file__).resolve().parents[2] / "demo-repo"


@pytest.fixture
def ws(tmp_path):
    shutil.copytree(DEMO, tmp_path / "repo")
    (tmp_path / "repo" / ".git").mkdir()
    return Workspace(tmp_path / "repo")


def test_path_escape_is_refused(ws):
    with pytest.raises(WorkspaceError):
        ws.resolve("../etc/passwd")
    with pytest.raises(WorkspaceError):
        ws.resolve("/etc/passwd")


def test_git_dir_is_off_limits(ws):
    with pytest.raises(WorkspaceError):
        ws.resolve(".git/config")


def test_tools_read_write_and_test(ws):
    list_files, read_file, write_file, _replace_in_file, run_tests = make_tools(ws)
    assert "invoicekit/money.py" in list_files()["files"]
    assert "Decimal" in read_file("invoicekit/money.py")["content"]
    assert "error" in write_file("../outside.py", "x")
    assert run_tests()["passed"] is True
    write_file("tests/test_broken.py", "def test_x():\n    assert False\n")
    result = run_tests()
    assert result["passed"] is False and result["exit_code"] == 1


def test_link_hash_is_deterministic_and_sensitive():
    at = dt.datetime(2026, 10, 15, 9, 0, tzinfo=dt.UTC)
    kw = {
        "project_id": None,
        "actor_label": "a",
        "actor_kind": "human",
        "action": "x",
        "subject_type": "project",
        "subject_id": "1",
        "payload": {"b": 2, "a": 1},
        "created_at": at,
    }
    body = ledger.canonical_body(**kw)
    assert ledger.link_hash(ledger.GENESIS_HASH, body) == ledger.link_hash(
        ledger.GENESIS_HASH, body
    )
    kw["payload"] = {"a": 1, "b": 3}
    assert ledger.link_hash(
        ledger.GENESIS_HASH, ledger.canonical_body(**kw)
    ) != ledger.link_hash(ledger.GENESIS_HASH, body)


def test_replace_in_file_is_exact_and_single(ws):
    _, read_file, _, replace_in_file, _ = make_tools(ws)
    assert "error" in replace_in_file("invoicekit/money.py", "does-not-exist", "x")
    assert "error" in replace_in_file(
        "invoicekit/money.py", "Decimal", "x"
    )  # many matches
    ok = replace_in_file("invoicekit/money.py", '"JPY": 0}', '"JPY": 0, "CHF": 2}')
    assert ok["ok"] and '"CHF": 2' in read_file("invoicekit/money.py")["content"]


def test_untrusted_tests_cannot_see_secrets(ws, monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_secret")
    monkeypatch.setenv("RUN_TOKEN", "run_secret")
    _, _, write_file, _, run_tests = make_tools(ws)
    write_file(
        "tests/test_leak.py",
        "import os\n\ndef test_leak():\n"
        "    assert 'GITHUB_TOKEN' not in os.environ and 'RUN_TOKEN' not in os.environ\n",
    )
    assert run_tests()["passed"] is True


def test_safe_env_keeps_windows_essentials_and_drops_secrets(monkeypatch):
    from app.agents.tools import safe_test_env

    monkeypatch.setenv("SYSTEMROOT", r"C:\Windows")
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_secret")
    monkeypatch.setenv("RUN_HMAC_SECRET", "s")
    env = safe_test_env()
    assert env["SYSTEMROOT"] == r"C:\Windows"  # Needed for asyncio/winsock on Windows.
    assert "GITHUB_TOKEN" not in env and "RUN_HMAC_SECRET" not in env


def test_list_files_returns_posix_paths(ws):
    list_files = make_tools(ws)[0]
    assert all("\\" not in f for f in list_files()["files"])
