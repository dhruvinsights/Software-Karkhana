# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Invite rules: privilege escalation, expiry and email binding."""

import datetime as dt

from app import invite_rules as r

NOW = dt.datetime(2026, 10, 16, tzinfo=dt.UTC)


def test_tokens_are_unique_and_long():
    a, b = r.new_token(), r.new_token()
    assert a != b and a.startswith("inv_") and len(a) >= 36


def test_developer_cannot_mint_an_executive():
    ok, why = r.can_invite_role(inviter_role="developer", inviter_is_owner=False, target_role="executive")
    assert not ok and "developer" in why


def test_developer_can_grow_their_own_team():
    assert r.can_invite_role(inviter_role="developer", inviter_is_owner=False, target_role="developer")[0]


def test_owner_and_managers_can_invite_any_valid_role():
    assert r.can_invite_role(inviter_role="developer", inviter_is_owner=True, target_role="qa")[0]
    assert r.can_invite_role(inviter_role="pm", inviter_is_owner=False, target_role="security")[0]


def test_unknown_role_rejected_even_for_owner():
    assert not r.can_invite_role(inviter_role="pm", inviter_is_owner=True, target_role="god")[0]


def test_email_binding_is_case_insensitive():
    assert r.email_matches(None, "x@y.com")
    assert r.email_matches("X@Y.com", "x@y.COM")
    assert not r.email_matches("a@y.com", "b@y.com")


def test_usability():
    future, past = NOW + dt.timedelta(days=1), NOW - dt.timedelta(seconds=1)
    assert r.is_usable(status="pending", expires_at=future, now=NOW)[0]
    assert "expired" in r.is_usable(status="pending", expires_at=past, now=NOW)[1]
    assert "already" in r.is_usable(status="accepted", expires_at=future, now=NOW)[1]
    assert "cancelled" in r.is_usable(status="revoked", expires_at=future, now=NOW)[1]


def test_single_use_only_for_addressed_invites():
    assert r.is_single_use("a@b.com") and not r.is_single_use(None)
