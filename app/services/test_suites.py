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

"""Test suites of a run (unit, integration, ...), as the Developer station shows them.

Pure functions: the run callback merges each report into ``runs.test_suites``.
Counts come from the runner; when it sends none, they are read from the
pytest or Jest summary line in the output.
"""

from __future__ import annotations

import re
from typing import Any

from app.schemas import SuiteReport

# Unit first, then integration, then anything else in the order it arrived.
_ORDER = {"unit": 0, "integration": 1, "e2e": 2}

_PYTEST = re.compile(r"(\d+) (passed|failed|skipped|errors?|xfailed|xpassed)")
_JEST = re.compile(
    r"Tests:\s+(?:(\d+) failed, )?(?:(\d+) skipped, )?(?:(\d+) passed, )?(\d+) total"
)


def parse_counts(output: str) -> dict[str, int]:
    """Passed/failed/skipped/total from the last pytest or Jest summary in ``output``."""
    tail = output[-4000:]
    jest = _JEST.findall(tail)
    if jest:
        failed, skipped, passed, total = (int(x or 0) for x in jest[-1])
        return {"passed": passed, "failed": failed, "skipped": skipped, "total": total}
    lines = [ln for ln in tail.splitlines() if _PYTEST.search(ln)]
    if not lines:
        return {}
    counts = {"passed": 0, "failed": 0, "skipped": 0}
    for n, word in _PYTEST.findall(lines[-1]):
        if word == "passed" or word == "xpassed":
            counts["passed"] += int(n)
        elif word in ("failed", "error", "errors"):
            counts["failed"] += int(n)
        else:
            counts["skipped"] += int(n)
    counts["total"] = sum(counts.values())
    return counts


def merge(suites: list[dict[str, Any]], report: SuiteReport) -> list[dict[str, Any]]:
    """``suites`` with ``report`` applied: one entry per suite name, in a stable order."""
    entry: dict[str, Any] = {
        "suite": report.suite,
        "status": report.status,
        "command": report.command,
        "durationMs": report.duration_ms,
    }
    counts = {
        k: v
        for k, v in {
            "passed": report.passed,
            "failed": report.failed,
            "skipped": report.skipped,
            "total": report.total,
        }.items()
        if v is not None
    }
    if not counts and report.output:
        counts = parse_counts(report.output)
    entry.update(counts)
    if report.output:
        entry["output"] = report.output[-4000:]
    out = [dict(s) for s in suites if s.get("suite") != report.suite]
    previous = next((s for s in suites if s.get("suite") == report.suite), {})
    out.append({**previous, **{k: v for k, v in entry.items() if v is not None}})
    arrival = {s["suite"]: i for i, s in enumerate(out)}
    return sorted(out, key=lambda s: (_ORDER.get(s["suite"], 9), arrival[s["suite"]]))


def overall(suites: list[dict[str, Any]]) -> str:
    """One word for all suites: running, failed, passed or not_run."""
    states = {s.get("status") for s in suites}
    if not suites:
        return "not_run"
    if "running" in states:
        return "running"
    if states & {"failed", "error"}:
        return "failed"
    return "passed"
