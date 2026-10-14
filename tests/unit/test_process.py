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

import uuid

import pytest

from app import process
from app.models import Project, Task
from app.process import Event, Role


def project(stage="evaluate", status="evaluated") -> Project:
    return Project(
        id=uuid.uuid4(), name="p", idea_text="i", stage=stage, stage_status=status
    )


def test_fifteen_stages():
    assert len(process.STAGES) == 15
    assert [s.id for s in process.STAGES if s.wired] == [
        "evaluate",
        "plan",
        "implement",
        "validate",
        "pr",
        "review",
        "feedback",
    ]


def test_director_can_approve():
    assert process.check(project(), Event.APPROVE, Role.DIRECTOR) == ("plan", "ready")


@pytest.mark.parametrize("role", [Role.PM, Role.DEVELOPER, Role.LEAD])
def test_only_director_approves(role):
    with pytest.raises(process.ForbiddenTransition):
        process.check(project(), Event.APPROVE, role)


def test_cannot_approve_before_evaluation():
    with pytest.raises(process.TransitionError):
        process.check(project(status="submitted"), Event.APPROVE, Role.DIRECTOR)


def test_users_cannot_fire_system_events():
    with pytest.raises(process.ForbiddenTransition):
        process.check(project(status="submitted"), Event.EVALUATED, Role.DIRECTOR)


def test_run_cannot_start_before_approval():
    with pytest.raises(process.TransitionError):
        process.check(project(), Event.RUN_STARTED, Role.DEVELOPER)


def test_build_loop():
    p = project("plan", "ready")
    for event, role, expected in [
        (Event.RUN_STARTED, Role.DEVELOPER, ("implement", "running")),
        (Event.PR_OPENED, None, ("pr", "open")),
        (Event.REVIEW_POSTED, None, ("review", "triage")),
        (Event.MERGED, Role.DEVELOPER, ("qa", "pending")),
    ]:
        p.stage, p.stage_status = process.check(p, event, role)
        assert (p.stage, p.stage_status) == expected


def test_task_moves():
    t = Task(key="KAR-1", status="draft")
    with pytest.raises(process.TransitionError):
        process.move_task(t, "in_progress")
    process.move_task(t, "ready")
    process.move_task(t, "in_progress")
    process.move_task(t, "review")
    process.move_task(t, "done")
    with pytest.raises(process.TransitionError):
        process.move_task(t, "ready")
