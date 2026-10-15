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

"""Shared project context: people add it, the agent reads it, runs leave handoffs."""

from __future__ import annotations

from tests.integration.test_golden_path import DEV, DIR, PM, as_, client, fakes  # noqa: F401


async def _project(client) -> str:
    r = await client.post(
        "/api/projects",
        headers=as_(PM),
        json={
            "name": "Context demo",
            "idea_text": "Customers want to apply a discount code at checkout and see the new total.",
        },
    )
    assert r.status_code == 202, r.text
    return r.json()["id"]


async def test_people_add_context_and_everyone_reads_it(client):
    pid = await _project(client)
    r = await client.post(
        f"/api/projects/{pid}/context",
        headers=as_(DIR),
        json={
            "kind": "decision",
            "title": "Codes are case-insensitive",
            "body": "Normalise to upper case.",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["author_kind"] == "human" and r.json()["author_label"] == DIR

    rows = (await client.get(f"/api/projects/{pid}/context", headers=as_(DEV))).json()
    assert [e["title"] for e in rows] == ["Codes are case-insensitive"]

    md = (
        await client.get(f"/api/projects/{pid}/context/export.md", headers=as_(DEV))
    ).text
    assert "## Decision: Codes are case-insensitive" in md

    ledger = (await client.get("/api/ledger", headers=as_(DIR))).json()
    assert any(e["action"] == "context.decision" for e in ledger)


async def test_short_or_unknown_input_is_rejected(client):
    pid = await _project(client)
    bad = await client.post(
        f"/api/projects/{pid}/context",
        headers=as_(PM),
        json={"kind": "rumour", "title": "ab", "body": "x"},
    )
    assert bad.status_code == 422
