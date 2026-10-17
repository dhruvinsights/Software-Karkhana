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

"""Suite reports merge into one ordered list, with counts read from the output."""

from app.schemas import SuiteReport
from app.services.test_suites import merge, overall, parse_counts


def test_pytest_summary():
    out = "....F\n=== 1 failed, 4 passed, 2 skipped, 1 error in 1.2s ==="
    assert parse_counts(out) == {"passed": 4, "failed": 2, "skipped": 2, "total": 8}


def test_jest_summary():
    out = "Tests:       1 failed, 2 skipped, 9 passed, 12 total"
    assert parse_counts(out) == {"passed": 9, "failed": 1, "skipped": 2, "total": 12}


def test_no_summary():
    assert parse_counts("Traceback ...") == {}


def test_merge_orders_and_keeps_earlier_fields():
    suites = merge([], SuiteReport(suite="e2e", status="running"))
    suites = merge(suites, SuiteReport(suite="integration", status="running", command="pytest it"))
    suites = merge(suites, SuiteReport(suite="unit", status="passed", passed=3, total=3))
    suites = merge(suites, SuiteReport(suite="integration", status="failed", output="1 failed, 2 passed"))
    assert [s["suite"] for s in suites] == ["unit", "integration", "e2e"]
    it = suites[1]
    assert it["command"] == "pytest it" and it["failed"] == 1 and it["total"] == 3
    assert overall(suites) == "running"
    assert overall(suites[:2]) == "failed"
    assert overall(suites[:1]) == "passed"
    assert overall([]) == "not_run"
