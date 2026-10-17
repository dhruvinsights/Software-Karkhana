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

"""The code checks that keep AI grouping honest."""

from app.services.idea_scope import GroupPlan, _heuristic_profile, check_groups


def _plan(*groups):
    return GroupPlan.model_validate(
        {
            "groups": [
                {"title": f"G{i}", "problem_statement": "p", "expected_value": "v", "feature_numbers": g, "rationale": "r"}
                for i, g in enumerate(groups)
            ]
        }
    )


def test_valid_groups_pass():
    assert check_groups(_plan([1, 2], [3, 4]), 4) == []


def test_unknown_numbers_and_overlaps_are_rejected():
    problems = check_groups(_plan([1, 5], [1, 2]), 4)
    assert any("unknown numbers" in p for p in problems)
    assert any("more than one group" in p for p in problems)


def test_a_repeated_number_does_not_make_a_group():
    assert any("fewer than" in p for p in check_groups(_plan([3, 3]), 4))


def test_heuristic_sizes():
    assert _heuristic_profile({}, 10)["size"] == "small"
    assert _heuristic_profile({"keyFeatures": ["x"] * 7}, 10)["size"] == "medium"
    assert _heuristic_profile({}, 5000)["size"] == "large"
