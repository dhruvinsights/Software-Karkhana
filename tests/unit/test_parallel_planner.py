"""Tests for the independence analysis in parallel_planner."""
import pytest
from app.services.parallel_planner import StoryMeta, analyse, HARD_BLOCK


def test_no_overlap_ok():
    plan = analyse([
        StoryMeta(id="A", focus_paths=["web/auth"]),
        StoryMeta(id="B", focus_paths=["api/billing"]),
    ])
    assert plan.ok_to_parallelize
    assert len(plan.conflicts) == 0
    assert len(plan.groups) == 1  # both in one group


def test_exact_overlap_blocks():
    plan = analyse([
        StoryMeta(id="A", focus_paths=["web/auth/login.ts"]),
        StoryMeta(id="B", focus_paths=["web/auth/login.ts"]),
    ])
    assert not plan.ok_to_parallelize
    assert plan.max_risk >= HARD_BLOCK
    assert len(plan.groups) == 2  # must serialize


def test_dependency_blocks():
    plan = analyse([
        StoryMeta(id="A", blocks=["B"]),
        StoryMeta(id="B"),
    ])
    assert not plan.ok_to_parallelize


def test_top_dir_overlap_is_low_risk():
    plan = analyse([
        StoryMeta(id="A", focus_paths=["web/src/auth"]),
        StoryMeta(id="B", focus_paths=["web/src/billing"]),
    ])
    # same top-level dir 'web' → risk 0.3, below HARD_BLOCK
    assert plan.ok_to_parallelize


def test_three_stories_two_groups():
    plan = analyse([
        StoryMeta(id="A", focus_paths=["web/auth/login.ts"]),
        StoryMeta(id="B", focus_paths=["web/billing"]),
        StoryMeta(id="C", focus_paths=["web/auth/login.ts"]),
    ])
    # A and C conflict; B is safe with both
    assert not any({"A", "C"} <= set(g) for g in plan.groups)
    assert len(plan.groups) >= 2
