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

"""Idea approval rules and who may staff a project."""

from __future__ import annotations

import uuid

import pytest

from app import idea_flow as rules
from app.process import Role


def test_tally_requires_every_reviewer_to_approve():
    assert rules.tally([]) == "draft"
    assert rules.tally(["pending", "pending"]) == "pending_approval"
    assert rules.tally(["approved", "pending"]) == "pending_approval"
    assert rules.tally(["approved", "approved"]) == "approved"


def test_one_rejection_stops_the_idea_even_if_others_approved():
    assert rules.tally(["approved", "rejected", "pending"]) == "rejected"
    assert rules.tally(["rejected"]) == "rejected"


def test_clean_reviewers_dedupes_and_keeps_order():
    me, a, b = (uuid.uuid4() for _ in range(3))
    assert rules.clean_reviewers(me, [a, b, a]) == [a, b]


def test_clean_reviewers_enforces_separation_of_duties_and_limits():
    me, other = uuid.uuid4(), uuid.uuid4()
    with pytest.raises(ValueError, match="own reviewer"):
        rules.clean_reviewers(me, [other, me])
    with pytest.raises(ValueError, match="at least one"):
        rules.clean_reviewers(me, [])
    with pytest.raises(ValueError, match="At most"):
        rules.clean_reviewers(
            me, [uuid.uuid4() for _ in range(rules.MAX_REVIEWERS + 1)]
        )


def test_who_can_request_and_promote():
    assert rules.can_request_approval(role="developer", is_author=True)
    assert rules.can_request_approval(role="product_manager", is_author=False)
    assert not rules.can_request_approval(role="developer", is_author=False)
    assert rules.can_promote("director") and rules.can_promote("pm")
    assert not rules.can_promote("developer") and not rules.can_promote("qa")


def test_every_default_role_is_a_real_role_with_known_stations():
    valid = {r.value for r in Role}
    for role, stations in rules.ROLE_STATIONS.items():
        assert role in valid, role
        assert set(stations) <= set(rules.ALL_STATIONS), role
    assert rules.MANAGER_ROLES <= valid


def test_default_stations_follow_the_role_matrix():
    assert "design" in rules.stations_for("designer")
    assert "devops" not in rules.stations_for("designer")
    assert set(rules.stations_for("pm")) == set(rules.ALL_STATIONS)
    assert rules.stations_for("someone-new") == ["product"]


def _can_add(**kw):
    base = {
        "caller_role": "developer",
        "caller_is_project_lead": False,
        "caller_member_is_lead": False,
        "caller_member_role": None,
        "caller_stations": [],
        "new_role": "developer",
        "new_stations": ["developer"],
    }
    return rules.can_add_member(**{**base, **kw})


def test_project_lead_and_managers_can_enrol_anyone():
    assert _can_add(caller_is_project_lead=True, new_role="qa")[0]
    assert _can_add(
        caller_role="director", new_role="devops", new_stations=["release"]
    )[0]


def test_plain_members_cannot_add_people():
    ok, why = _can_add()
    assert not ok and "project lead" in why
    ok, _ = _can_add(caller_member_role="developer", caller_stations=["developer"])
    assert not ok


def test_station_lead_can_grow_only_their_own_team():
    lead = {
        "caller_member_is_lead": True,
        "caller_member_role": "designer",
        "caller_stations": ["product", "design", "architecture"],
    }
    assert _can_add(**lead, new_role="designer", new_stations=["design"])[0]
    ok, why = _can_add(**lead, new_role="developer", new_stations=["design"])
    assert not ok and "designer" in why
    ok, why = _can_add(**lead, new_role="designer", new_stations=["design", "security"])
    assert not ok and "security" in why
