# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Station access rules: who sees what on a project."""

from app.access import decide


def test_open_projects_are_visible_to_everyone():
    assert decide(restricted=False, privileged=False, member_stations=None, wanted=["qa"])[0]


def test_restricted_blocks_outsiders():
    ok, why = decide(restricted=True, privileged=False, member_stations=None)
    assert not ok and "restricted" in why


def test_privileged_always_passes():
    assert decide(restricted=True, privileged=True, member_stations=None, wanted=["qa"])[0]


def test_member_needs_the_station():
    mine = ["design", "product"]
    assert decide(restricted=True, privileged=False, member_stations=mine, wanted=["design"])[0]
    ok, why = decide(restricted=True, privileged=False, member_stations=mine, wanted=["developer"])
    assert not ok and "developer" in why


def test_any_one_of_several_stations_is_enough():
    assert decide(restricted=True, privileged=False, member_stations=["qa"], wanted=["developer", "qa"])[0]


def test_no_wanted_station_means_team_membership_only():
    assert decide(restricted=True, privileged=False, member_stations=[])[0]
