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

"""The project launch screen's API: team plan, chosen teams, repository checks."""

from __future__ import annotations

from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    PM,
    as_,
    client,
    fakes,
)
from tests.integration.test_idea_approvals import _approved_idea, _uid


async def test_team_plan_names_every_team_once(client):
    idea = await _approved_idea(client, "Team plan")
    r = await client.post(f"/api/ideas/{idea}/team-plan", headers=as_(PM))
    assert r.status_code == 200, r.text
    body = r.json()
    teams = [t["team"] for t in body["teams"]]
    assert sorted(teams) == sorted(
        ["design", "architecture", "developer", "qa", "devops", "security", "release"]
    )
    assert all(t["reason"] for t in body["teams"])


async def test_promote_keeps_only_the_chosen_teams(client):
    idea = await _approved_idea(client, "Backend only")
    developer = await _uid(client, DEV)
    r = await client.post(
        f"/api/ideas/{idea}/promote",
        headers=as_(PM),
        json={
            "name": "Backend only",
            "code": "bko",
            "repository_url": "https://github.com/acme/backend-only",
            "teams": ["product", "developer", "qa"],
            "leads": [
                {
                    "user_id": developer,
                    "role": "developer",
                    "stations": ["developer", "design"],
                    "is_lead": True,
                }
            ],
        },
    )
    assert r.status_code == 201, r.text
    by_role = {m["role"]: m for m in r.json()["members"]}
    assert by_role["pm"]["stations"] == ["product", "developer", "qa"]
    # A station outside the project's teams is dropped.
    assert by_role["developer"]["stations"] == ["developer"]

    pid = r.json()["projectId"]
    project = (await client.get(f"/api/projects/{pid}", headers=as_(PM))).json()
    settings = project.get("settings") or project.get("project", {}).get("settings", {})
    assert settings["teams"] == ["product", "developer", "qa"]
    assert settings["code"] == "BKO"


async def test_promote_rejects_unknown_teams(client):
    idea = await _approved_idea(client, "Bad teams")
    r = await client.post(
        f"/api/ideas/{idea}/promote", headers=as_(PM), json={"teams": ["marketing"]}
    )
    assert r.status_code == 422 and "marketing" in r.text


async def test_repo_check_needs_a_github_url_and_a_token(client):
    r = await client.post(
        "/api/github/repo-check", headers=as_(PM), json={"url": "https://gitlab.com/a/b"}
    )
    assert r.status_code == 422
    r = await client.post(
        "/api/github/repo-check",
        headers=as_(PM),
        json={"url": "https://github.com/acme/repo"},
    )
    assert r.status_code == 412 and "GitHub" in r.text
