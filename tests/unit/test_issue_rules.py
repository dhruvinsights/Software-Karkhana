# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Issue rules: assignment and edit permissions."""

import uuid

from app import issue_rules as r

A, B, C = (uuid.uuid4() for _ in range(3))


def test_key_format():
    assert r.key(7) == "ISS-7"


def test_leads_assign_anyone():
    assert r.can_assign(actor_id=A, assignee_id=B, actor_is_lead=True)[0]


def test_members_may_only_take_work_for_themselves():
    assert r.can_assign(actor_id=A, assignee_id=A, actor_is_lead=False)[0]
    assert r.can_assign(actor_id=A, assignee_id=None, actor_is_lead=False)[0]
    ok, why = r.can_assign(actor_id=A, assignee_id=B, actor_is_lead=False)
    assert not ok and "lead" in why


def test_who_can_modify():
    assert r.can_modify(actor_id=A, reporter_id=A, assignee_id=None, actor_is_lead=False)
    assert r.can_modify(actor_id=B, reporter_id=A, assignee_id=B, actor_is_lead=False)
    assert not r.can_modify(actor_id=C, reporter_id=A, assignee_id=B, actor_is_lead=False)
    assert r.can_modify(actor_id=C, reporter_id=A, assignee_id=B, actor_is_lead=True)


def test_validation_messages():
    assert r.validate(type_="bug", priority="P1", status="done") is None
    assert "type" in r.validate(type_="epic")
    assert "priority" in r.validate(priority="urgent")
    assert "status" in r.validate(status="blocked")
