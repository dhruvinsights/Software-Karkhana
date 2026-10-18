# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Karkhana benchmark suite (``pytest -m bench``).

Every bench test records what it measured with ``record(name, **numbers)``.
At the end of the session the numbers are written to
``reports/bench/results.json`` so the report and the slides quote the same run.
"""

from __future__ import annotations

import datetime as dt
import json
import platform
import subprocess
from pathlib import Path

import pytest

RESULTS: dict[str, dict] = {}
OUT = Path(__file__).resolve().parents[2] / "reports" / "bench" / "results.json"


def pytest_collection_modifyitems(items):
    here = Path(__file__).parent
    for item in items:
        if here in Path(item.fspath).parents:
            item.add_marker(pytest.mark.bench)


def record(name: str, **numbers) -> None:
    """Stores one benchmark's measured numbers for the results file."""
    RESULTS[name] = numbers


def pytest_sessionfinish(session, exitstatus):
    if not RESULTS:
        return
    try:
        sha = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=False
        ).stdout.strip()
    except OSError:
        sha = ""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    previous = json.loads(OUT.read_text()) if OUT.exists() else {}
    merged = {**previous.get("results", {}), **RESULTS}
    OUT.write_text(
        json.dumps(
            {
                "run_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
                "commit": sha,
                "python": platform.python_version(),
                "machine": platform.platform(),
                "results": merged,
            },
            indent=2,
        )
    )
