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

"""An empty repository is started from the product setup."""

import base64
import json
import uuid
from types import SimpleNamespace

import httpx
import pytest

from app.services import greenfield

SETUP = {
    "problemStatement": "Agents forget between sessions.",
    "targetUsers": "Developers embedding agents",
    "techStack": ["C++20", "CMake", "SQLite"],
    "keyFeatures": ["Memory store", "Semantic search"],
    "constraints": ["No Python at runtime"],
    "repositoryUrl": "https://github.com/acme/agent-memory",
}


def _product(**settings):
    return SimpleNamespace(
        id=uuid.uuid4(), name="Agent Memory", description="A C++ memory engine.",
        settings={**SETUP, **settings}, created_by=uuid.uuid4(),
    )


def test_cpp_gets_cmake_and_ctest_suites():
    cfg = greenfield.agent_config_for(SETUP)
    assert set(cfg["tests"]) == {"unit", "integration"}
    assert "ctest" in cfg["tests"]["unit"][-1] and "-L unit" in cfg["tests"]["unit"][-1]
    assert greenfield.agent_config_for({"techStack": ["Go"]}) == {"test": ["go", "test", "./..."]}
    assert greenfield.agent_config_for({"techStack": ["Python", "FastAPI"]}) is None


def test_readme_is_the_product_setup():
    text = greenfield.readme_for(_product())
    for part in ("# Agent Memory", "Agents forget", "C++20", "Semantic search", "No Python at runtime", "no code yet"):
        assert part in text


def test_greenfield_detection_and_prompt_note():
    starter = SimpleNamespace(paths=["README.md", ".karkhana/agent.json"], files={"README.md": "x"})
    grown = SimpleNamespace(paths=["README.md", "src/store.cpp"], files={})
    assert greenfield.is_greenfield(starter) and not greenfield.is_greenfield(grown)
    assert not greenfield.is_greenfield(None)
    assert greenfield.context_for(None, 100) == "REPOSITORY: none connected."


@pytest.mark.parametrize(("commits_status", "started"), [(409, True), (200, False)])
async def test_ensure_started_commits_only_into_an_empty_repo(monkeypatch, commits_status, started):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.method == "GET":
            return httpx.Response(commits_status, json={"message": "Git Repository is empty."})
        body = json.loads(request.content)
        assert base64.b64decode(body["content"])
        return httpx.Response(201, json={})

    monkeypatch.setattr(
        greenfield, "_client", lambda token: httpx.AsyncClient(base_url="https://api.github.com", transport=httpx.MockTransport(handler))
    )

    async def token(*_a):
        return "t"

    monkeypatch.setattr(greenfield, "_token", token)
    assert await greenfield.ensure_started(None, _product(), None) is started
    puts = [p for m, p in calls if m == "PUT"]
    if started:
        assert puts == ["/repos/acme/agent-memory/contents/README.md", "/repos/acme/agent-memory/contents/.karkhana/agent.json"]
    else:
        assert puts == []
