"""agent_memory never raises and never runs without a configured interpreter."""

import json
import sys

import pytest

from app import agent_memory
from app.config import get_settings


async def test_disabled_without_interpreter(monkeypatch):
    monkeypatch.setattr(get_settings(), "mem0_python", None)
    assert not agent_memory.enabled()
    assert await agent_memory.remember("p", "developer", "use parameterized SQL") == []
    assert await agent_memory.recall("p", "database queries") == []


async def test_failures_are_swallowed(monkeypatch):
    monkeypatch.setattr(get_settings(), "mem0_python", sys.executable)

    async def boom(payload, timeout):  # noqa: ASYNC109
        raise RuntimeError("ollama is down")

    monkeypatch.setattr(agent_memory, "_call", boom)
    assert await agent_memory.remember("p", "developer", "x") == []
    assert await agent_memory.recall("p", "x") == []


async def test_results_are_flattened_and_scoped(monkeypatch):
    monkeypatch.setattr(get_settings(), "mem0_python", sys.executable)
    seen = []

    async def fake(payload, timeout):  # noqa: ASYNC109
        seen.append(payload)
        return {"results": [{"memory": "a"}, {"memory": ""}, {"memory": "b"}]}

    monkeypatch.setattr(agent_memory, "_call", fake)
    assert await agent_memory.recall("p1", "q", role="qa") == ["a", "b"]
    assert seen[0]["user_id"] == "p1" and seen[0]["agent_id"] == "qa"
    assert json.dumps(seen[0])


@pytest.mark.parametrize("role", ["developer", "reviewer"])
def test_scope_is_project_and_role(role):
    assert agent_memory.scope("p", role) == {"user_id": "p", "agent_id": role}
