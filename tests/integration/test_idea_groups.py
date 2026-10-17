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

"""Features vs projects: a lone feature never becomes a project; groups do."""

from __future__ import annotations

import uuid

from app.ai import llm
from app.services import idea_scope
from tests.integration.test_golden_path import (  # noqa: F401
    DIR,
    PM,
    as_,
    client,
    fakes,
)
from tests.integration.test_idea_approvals import _uid

PROFILE = {"summary": "A billing service.", "areas": ["billing"], "reason": "Test."}


async def _product(client, size="medium"):
    r = await client.post(
        "/api/products",
        headers=as_(PM),
        json={"name": f"Billing {uuid.uuid4().hex[:6]}", "profile": {**PROFILE, "size": size}},
    )
    assert r.status_code == 201, r.text
    assert r.json()["profile"]["size"] == size
    return r.json()["id"]


async def _feature(client, product, title, approve=True):
    r = await client.post(
        "/api/ideas",
        headers=as_(PM),
        json={
            "title": title,
            "problem_statement": f"{title}: invoices need it.",
            "product_id": product,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["scope"] == "feature"
    idea = r.json()["id"]
    if approve:
        director = await _uid(client, DIR)
        await client.post(
            f"/api/ideas/{idea}/request-approval",
            headers=as_(PM),
            json={"reviewer_ids": [director]},
        )
        r = await client.post(
            f"/api/ideas/{idea}/decision", headers=as_(DIR), json={"decision": "approve"}
        )
        assert r.json()["status"] == "approved", r.text
    return idea


async def _ideas(client):
    return {i["id"]: i for i in (await client.get("/api/ideas", headers=as_(PM))).json()}


def _with(fake, answers):
    """Answers the grouping/feature schemas; everything else goes to the stock fake."""

    async def generate(*, prompt, schema, system, model=None, temperature=0.3, timeout_s=90.0):
        if schema in answers:
            return schema.model_validate(answers[schema])
        return await fake.generate(prompt=prompt, schema=schema, system=system)

    return generate


async def test_a_lone_feature_is_never_promoted(client, fakes):
    product = await _product(client)
    idea = await _feature(client, product, "Invoice discounts")
    r = await client.post(f"/api/ideas/{idea}/promote", headers=as_(PM))
    assert r.status_code == 409 and "single feature" in r.text


async def test_small_products_take_features_only(client, fakes):
    product = await _product(client, "small")
    r = await client.post(
        "/api/ideas",
        headers=as_(PM),
        json={"title": "Big", "problem_statement": "x", "product_id": product, "scope": "project"},
    )
    assert r.status_code == 422 and "small product" in r.text


async def test_grouped_features_become_one_project(client, fakes):
    product = await _product(client)
    a = await _feature(client, product, "Invoice discounts")
    b = await _feature(client, product, "Discount reports")
    r = await client.post(
        f"/api/products/{product}/idea-groups",
        headers=as_(PM),
        json={"idea_ids": [a], "title": "Discounts", "problem_statement": "One feature"},
    )
    assert r.status_code == 422
    r = await client.post(
        f"/api/products/{product}/idea-groups",
        headers=as_(PM),
        json={"idea_ids": [a, b], "title": "Discounts", "problem_statement": "Discounts end to end"},
    )
    assert r.status_code == 201, r.text
    group = r.json()
    # Every feature was approved, so the group is too.
    assert group["scope"] == "project" and group["status"] == "approved"
    ideas = await _ideas(client)
    assert ideas[a]["parentId"] == ideas[b]["parentId"] == group["id"]

    # A grouped feature cannot be grouped again.
    c = await _feature(client, product, "Coupons", approve=False)
    again = await client.post(
        f"/api/products/{product}/idea-groups",
        headers=as_(PM),
        json={"idea_ids": [a, c], "title": "Again", "problem_statement": "x"},
    )
    assert again.status_code == 422

    r = await client.post(f"/api/ideas/{group['id']}/promote", headers=as_(PM))
    assert r.status_code == 201, r.text
    pid = r.json()["projectId"]
    ideas = await _ideas(client)
    for i in (a, b):
        assert ideas[i]["status"] == "promoted" and ideas[i]["promotedProjectId"] == pid
    # A group that is a project stays one.
    assert (await client.delete(f"/api/idea-groups/{group['id']}", headers=as_(PM))).status_code == 409


async def test_ungroup_returns_the_features(client, fakes):
    product = await _product(client)
    a = await _feature(client, product, "Tax lines", approve=False)
    b = await _feature(client, product, "Tax report", approve=False)
    group = (
        await client.post(
            f"/api/products/{product}/idea-groups",
            headers=as_(PM),
            json={"idea_ids": [a, b], "title": "Tax", "problem_statement": "Tax"},
        )
    ).json()
    assert group["status"] == "draft"
    assert (await client.delete(f"/api/idea-groups/{group['id']}", headers=as_(PM))).status_code == 204
    ideas = await _ideas(client)
    assert group["id"] not in ideas
    assert ideas[a]["parentId"] is None and ideas[b]["parentId"] is None


async def test_ai_grouping_is_checked(client, fakes, monkeypatch):
    fake, _ = fakes
    product = await _product(client)
    a = await _feature(client, product, "Refunds", approve=False)
    b = await _feature(client, product, "Refund emails", approve=False)
    lone = await _feature(client, product, "Dark mode", approve=False)
    plan = {
        "groups": [
            {
                "title": "Refunds",
                "problem_statement": "Customers cannot get refunds.",
                "expected_value": "Fewer support tickets.",
                "feature_numbers": [1, 2],
                "rationale": "Same journey.",
            }
        ]
    }
    monkeypatch.setattr(llm, "generate_structured", _with(fake, {idea_scope.GroupPlan: plan}))
    r = await client.post(f"/api/products/{product}/idea-groups/auto", headers=as_(PM))
    assert r.status_code == 200, r.text
    [group] = r.json()["groups"]
    ideas = await _ideas(client)
    assert ideas[a]["parentId"] == ideas[b]["parentId"] == group["id"]
    assert ideas[lone]["parentId"] is None

    # Nothing left to group: one feature is not enough.
    r = await client.post(f"/api/products/{product}/idea-groups/auto", headers=as_(PM))
    assert r.status_code == 409


async def test_an_approved_feature_joins_an_existing_project(client, fakes, monkeypatch):
    fake, _ = fakes
    product = await _product(client)
    a = await _feature(client, product, "Discounts")
    b = await _feature(client, product, "Discount report")
    group = (
        await client.post(
            f"/api/products/{product}/idea-groups",
            headers=as_(PM),
            json={"idea_ids": [a, b], "title": "Discounts", "problem_statement": "Discounts"},
        )
    ).json()
    pid = (await client.post(f"/api/ideas/{group['id']}/promote", headers=as_(PM))).json()["projectId"]

    late = await _feature(client, product, "Discount codes")
    epic = {
        "title": "Discount codes",
        "description": "Codes customers type at checkout.",
        "stories": [
            {
                "title": "As a customer, I want to enter a code so that I pay less.",
                "acceptance_criteria": ["Given a valid code, then the total drops", "Given an expired code, then an error"],
                "estimate": 3,
                "layer": "backend",
            }
        ],
    }
    monkeypatch.setattr(llm, "generate_structured", _with(fake, {idea_scope.FeatureEpic: epic}))
    r = await client.post(f"/api/ideas/{late}/add-to-project", headers=as_(PM), json={"project_id": pid})
    assert r.status_code == 202, r.text
    ideas = await _ideas(client)
    assert ideas[late]["delivery"]["state"] == "ready", ideas[late]["delivery"]
    assert ideas[late]["status"] == "promoted" and ideas[late]["promotedProjectId"] == pid
    plan = (await client.get(f"/api/projects/{pid}/plan", headers=as_(PM))).json()
    assert any(e["title"] == "Discount codes" for e in plan["epics"])

    # A project idea is launched, never added.
    r = await client.post(f"/api/ideas/{group['id']}/add-to-project", headers=as_(PM), json={"project_id": pid})
    assert r.status_code == 409
