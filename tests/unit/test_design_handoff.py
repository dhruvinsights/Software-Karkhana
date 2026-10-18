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

"""Each story gets exactly its part of the approved design."""

from app.services.design_handoff import as_note, keys_with_screens, slice_for

SPEC = {
    "screens": [
        {"name": "Cart", "purpose": "Shows totals", "story_keys": ["ISS-2"], "states": ["empty"], "html": "<p>x</p>" * 3000},
    ],
    "api_contracts": [
        {"method": "POST", "path": "/discounts", "summary": "Create", "story_keys": ["ISS-1", "ISS-2"],
         "request_example": "{}", "response_example": "{}", "errors": ["400: bad percent"]},
    ],
    "tokens": [{"name": "primary", "value": "#075BFF"}],
    "accessibility": ["Labels on every input"],
}


def test_slices_follow_story_keys():
    assert [s["name"] for s in slice_for(SPEC, "ISS-2")["screens"]] == ["Cart"]
    assert slice_for(SPEC, "ISS-1")["screens"] == [] and len(slice_for(SPEC, "ISS-1")["contracts"]) == 1
    assert slice_for(SPEC, "ISS-9") == {"screens": [], "contracts": []}
    assert keys_with_screens(SPEC) == {"ISS-2"}


def test_run_note_has_contracts_screens_and_a_bounded_prototype():
    note = as_note(SPEC, "ISS-2", 3)
    assert "Approved design v3 for ISS-2" in note and "POST /discounts" in note and "SCREEN Cart" in note
    assert "(truncated)" in note and "primary" in note and "Labels on every input" in note
    backend = as_note(SPEC, "ISS-1", 3)
    assert "SCREEN" not in backend and "primary" not in backend
    assert as_note(SPEC, "ISS-9", 3) is None
