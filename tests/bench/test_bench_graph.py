# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""FalkorDB Engineering Intelligence Graph on this repository's own code.

The graph is loaded with every Python file under ``app/`` and ``tests/``, its
real import edges (parsed with ``ast``) and test-coverage edges. Then:

- context scoping: size of the graph answer to "who imports this file and
  which tests cover it" against the source an agent would otherwise scan;
- parallel-safety: random task pairs touching random real files, checked
  against the exact set intersection (precision / recall);
- latency of each query on a live FalkorDB server.

Skipped when no FalkorDB server is reachable (``KARKHANA_GRAPH_HOST/PORT``).
"""

from __future__ import annotations

import ast
import os
import random
import statistics
import time
import uuid
from pathlib import Path

import pytest

from app.graph.base import FileNode
from tests.bench.conftest import record

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def graph():
    from app.graph.falkordb_backend import FalkorDBBackend

    name = f"karkhana_bench_{uuid.uuid4().hex[:8]}"
    g = FalkorDBBackend(
        host=os.environ.get("KARKHANA_GRAPH_HOST", "localhost"),
        port=int(os.environ.get("KARKHANA_GRAPH_PORT", "6379")),
        graph_name=name,
    )
    g.connect()
    if not g.is_available():
        pytest.skip("no FalkorDB server")
    yield g
    try:
        g._graph.delete()
    finally:
        g.close()


def _module_of(path: str) -> str:
    return path[:-3].replace("/", ".").removesuffix(".__init__")


def _repo():
    files = sorted(
        str(p.relative_to(ROOT))
        for d in ("app", "tests")
        for p in (ROOT / d).rglob("*.py")
        if "__pycache__" not in p.parts
    )
    by_module = {_module_of(f): f for f in files}
    imports: set[tuple[str, str]] = set()
    for f in files:
        try:
            tree = ast.parse((ROOT / f).read_text())
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                names = [node.module] + [f"{node.module}.{a.name}" for a in node.names]
            for n in names:
                if n in by_module and by_module[n] != f:
                    imports.add((f, by_module[n]))
    tests = {}
    for f in files:
        name = Path(f).name
        if f.startswith("tests/") and name.startswith("test_"):
            target = name[5:]
            for src in files:
                if src.startswith("app/") and Path(src).name == target:
                    tests.setdefault(src, []).append(f)
    return files, imports, tests


def _ms(samples: list[float]) -> dict:
    s = sorted(samples)
    return {
        "p50_ms": round(statistics.median(s) * 1000, 2),
        "p95_ms": round(s[int(len(s) * 0.95) - 1] * 1000, 2),
    }


def test_bench_graph(graph):
    rng = random.Random(20261018)
    pid = "bench-repo"
    files, imports, tests = _repo()

    t0 = time.perf_counter()
    graph.ingest_repo_files(pid, [FileNode(f, "python", f.startswith("tests/")) for f in files])
    for a, b in imports:
        graph.add_import_edge(pid, a, b)
    for src, ts in tests.items():
        for t in ts:
            graph.add_test_covers_edge(pid, t, src)
    ingest_s = time.perf_counter() - t0

    # Context scoping.
    callers_of: dict[str, set[str]] = {}
    for a, b in imports:
        callers_of.setdefault(b, set()).add(a)
    sample = rng.sample([f for f in files if f.startswith("app/") and f in callers_of], 100)
    repo_chars = sum(len((ROOT / f).read_text(errors="ignore")) for f in files)
    lat, sizes, recall_hits, recall_total = [], [], 0, 0
    for f in sample:
        t = time.perf_counter()
        ctx = graph.get_scoped_context(pid, f"task-{f}", [f])
        lat.append(time.perf_counter() - t)
        sizes.append(len(ctx.to_prompt_prefix()))
        truth = callers_of[f]
        got = set(ctx.callers)
        recall_total += min(len(truth), 15)  # The query returns at most 15 callers.
        recall_hits += min(len(truth & got), 15)
        assert got <= truth

    # Parallel-safety conflict detection.
    pairs = 500
    tp = fp = fn = tn = 0
    conflict_lat = []
    for i in range(pairs):
        a_files = rng.sample(files, rng.randint(1, 4))
        b_files = rng.sample(files, rng.randint(1, 4))
        if rng.random() < 0.4:
            b_files.append(rng.choice(a_files))
        ta, tb = f"A{i}", f"B{i}"
        graph.record_task_touches(pid, ta, "task a", a_files)
        t = time.perf_counter()
        res = graph.check_parallel_conflicts(pid, tb, b_files, [ta])
        conflict_lat.append(time.perf_counter() - t)
        truth = bool(set(a_files) & set(b_files))
        got = res.has_conflicts
        tp += truth and got
        fp += got and not truth
        fn += truth and not got
        tn += not truth and not got

    blast_lat = []
    for f in sample[:50]:
        t = time.perf_counter()
        graph.get_blast_radius(pid, [f])
        blast_lat.append(time.perf_counter() - t)

    avg_prefix = statistics.mean(sizes)
    record(
        "graph_falkordb",
        files=len(files),
        import_edges=len(imports),
        test_edges=sum(len(v) for v in tests.values()),
        ingest_seconds=round(ingest_s, 2),
        context_samples=len(sample),
        avg_graph_context_chars=round(avg_prefix),
        repo_source_chars=repo_chars,
        context_reduction_factor=round(repo_chars / avg_prefix),
        caller_recall=round(recall_hits / recall_total, 4),
        scoped_context_latency=_ms(lat),
        conflict_pairs=pairs,
        conflict_true_positive=tp,
        conflict_false_positive=fp,
        conflict_false_negative=fn,
        conflict_true_negative=tn,
        conflict_precision=round(tp / (tp + fp), 4) if tp + fp else 1.0,
        conflict_recall=round(tp / (tp + fn), 4) if tp + fn else 1.0,
        conflict_check_latency=_ms(conflict_lat),
        blast_radius_latency=_ms(blast_lat),
    )
    assert fn == 0 and fp == 0
