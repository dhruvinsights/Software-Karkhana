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

"""Developer/QA accountability rules."""

from app import dev_qa_rules as r


def test_bug_states():
    assert r.bug_state("backlog", 0) == "new"
    assert r.bug_state("backlog", 2) == "reopened"
    assert r.bug_state("in_progress", 1) == "fixing"
    assert r.bug_state("ready_for_qa", 0) == "fixed"
    assert r.bug_state("done", 0) == "verified"


def test_layer_from_label_or_description():
    assert r.layer_of(["plan", "layer:frontend"]) == "frontend"
    assert r.layer_of(["layer:nonsense"], "Delivers FR-1 · backend · 3 points") == "backend"
    assert r.layer_of([], "no layer here") is None


def test_manual_check_needs_every_criterion_and_notes():
    crit = ["Given A then B", "Given C then D"]
    ok = [{"text": c, "ok": True} for c in crit]
    assert r.check_problem(crit, ok, "Clicked through both flows.") is None
    assert "not confirmed" in r.check_problem(crit, ok[:1], "Clicked through both flows.")
    assert "not confirmed" in r.check_problem(crit, [{"text": crit[0], "ok": True}, {"text": crit[1], "ok": False}], "Clicked through both flows.")
    assert "characters" in r.check_problem(crit, ok, "fine")


def test_who_can_move_what():
    assert r.story_check_allowed("in_review") and not r.story_check_allowed("ready")
    assert r.fix_allowed("backlog") and r.fix_allowed("in_progress") and not r.fix_allowed("done")
    assert r.verify_allowed("ready_for_qa") and not r.verify_allowed("backlog")
