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

"""Role-scoped navigation and dashboards."""

from __future__ import annotations

from tests.integration.test_golden_path import DEV, DIR, PM, as_, client, fakes  # noqa: F401

LEAD = "lead@karkhana.dev"


async def _paths(client, email):
    r = await client.get("/api/nav", headers=as_(email))
    assert r.status_code == 200, r.text
    return {p["path"] for p in r.json()["pages"]}


async def test_each_role_sees_only_its_pages(client):
    pm, director = await _paths(client, PM), await _paths(client, DIR)
    dev, lead = await _paths(client, DEV), await _paths(client, LEAD)
    assert "/ideas" in pm and "/approvals" not in pm and "/work" not in pm
    assert "/approvals" in director and "/work" not in director
    assert "/work" in dev and "/approvals" not in dev and "/ideas" not in dev
    assert "/system" in lead and "/system" not in dev and "/ledger" not in pm


async def test_dashboard_is_scoped_to_role(client):
    pm = (await client.get("/api/dashboard", headers=as_(PM))).json()
    dev = (await client.get("/api/dashboard", headers=as_(DEV))).json()
    assert pm["role"] == "pm" and {s["label"] for s in pm["stats"]} >= {"My ideas"}
    assert dev["role"] == "developer" and "Ready for the agent" in dev["queues"]
    assert "Learnings to verify" not in {s["label"] for s in dev["stats"]}


async def test_health_endpoints_report_real_state(client):
    h = (await client.get("/api/providers/health", headers=as_(PM))).json()
    assert h["llm_provider"] in {"gemini", "ollama", "bob"}
    assert "configured" in h["gemini"] and "engine" in h["review"]
    r = (await client.get("/api/runner/status", headers=as_(PM))).json()
    assert r["backend"] == "local" and r["ready"] is True


async def test_public_endpoints_need_no_login_and_dev_users_come_from_db(client):
    stats = (await client.get("/api/public/stats")).json()
    assert set(stats) == {"projects", "merged_prs", "agent_runs", "ledger_entries"}
    users = (await client.get("/api/public/dev-users")).json()
    assert {"pm", "director", "developer", "lead"} <= {u["role"] for u in users}


async def test_onboarding_flag_is_stored_server_side(client):
    me = (await client.get("/api/me", headers=as_(PM))).json()
    assert me["onboarded_at"] is None
    assert (await client.post("/api/me/onboarded", headers=as_(PM))).status_code == 200
    me = (await client.get("/api/me", headers=as_(PM))).json()
    assert me["onboarded_at"] is not None


async def test_work_and_prs_lists_return_real_rows(client):
    work = (await client.get("/api/work", headers=as_(DEV))).json()
    assert all(t["status"] in {"ready", "in_progress", "review"} for t in work)
    assert all({"key", "project_name", "criteria"} <= t.keys() for t in work)
    prs = (await client.get("/api/prs", headers=as_(DEV))).json()
    assert all({"number", "open_comments", "project_name"} <= p.keys() for p in prs)
