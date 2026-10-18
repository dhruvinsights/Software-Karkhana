# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Hallucination guard: fabricated citations never get through.

Sources are the demo idea transcripts plus every long paragraph in ``docs/``.
For each source we draw genuine quotes (with the case, curly-quote and
whitespace drift a model really produces) and fabricated quotes made by the
edits models really make: a swapped word, a dropped word, a changed number,
a paraphrase, a splice of two distant fragments, a sentence from another
source, an invented sentence. ``evaluator.check_output`` must accept every
genuine quote and reject every fabricated one. Invented learning ids in
``memory_citations`` and invented repository paths in IdeaQ evidence are
measured the same way.
"""

from __future__ import annotations

import random
import re
from pathlib import Path
from types import SimpleNamespace

from app.ai import evaluator
from app.ai.evaluator import MemoryItem, normalize
from tests.bench.conftest import record
from tests.fakes import IDEAS

ROOT = Path(__file__).resolve().parents[2]
SYNONYMS = {
    "the": "a", "users": "customers", "invoice": "bill", "must": "should", "can": "may",
    "data": "information", "agent": "bot", "task": "job", "project": "initiative",
    "team": "group", "code": "source", "test": "check", "review": "audit",
}


def _sources() -> list[str]:
    texts = [i["idea_text"] for i in IDEAS.values()]
    for md in sorted((ROOT / "docs").glob("*.md")):
        for para in md.read_text(errors="ignore").split("\n\n"):
            p = " ".join(para.split())
            if len(p) >= 300 and not p.startswith(("```", "|", "#", "-", "*", ">")):
                texts.append(p)
    return texts


def _span(words: list[str], rng: random.Random, n: int) -> list[str]:
    i = rng.randrange(0, max(1, len(words) - n))
    return words[i : i + n]


def _genuine(src: str, rng: random.Random) -> str:
    q = " ".join(_span(src.split(), rng, rng.randint(6, 18)))
    drift = rng.choice(["none", "case", "curly", "space", "trailing"])
    if drift == "case":
        q = q.upper() if rng.random() < 0.5 else q.lower()
    elif drift == "curly":
        q = q.replace("'", "\u2019").replace('"', "\u201c")
    elif drift == "space":
        q = q.replace(" ", "  \n ", 2)
    elif drift == "trailing":
        q = q + "."
    return q


def _fabricated(src: str, other: str, rng: random.Random, kind: str) -> str:
    words = _span(src.split(), rng, rng.randint(8, 18))
    if kind == "swapped word":
        i = rng.randrange(len(words))
        words[i] = SYNONYMS.get(words[i].lower(), words[i] + "s")
    elif kind == "dropped word":
        del words[rng.randrange(1, len(words) - 1)]
    elif kind == "changed number":
        joined = " ".join(words)
        nums = re.findall(r"\d+", src)
        if nums:
            n = rng.choice(nums)
            joined = src[src.index(n) - 30 if src.index(n) >= 30 else 0 : src.index(n)] + str(int(n) + 7)
        else:
            joined += " by 37%"
        return joined
    elif kind == "paraphrase":
        words = [SYNONYMS.get(w.lower(), w) for w in words]
        words.insert(rng.randrange(len(words)), "basically")
    elif kind == "spliced fragments":
        sw = src.split()
        a, b = sw[: len(sw) // 3], sw[2 * len(sw) // 3 :]
        words = _span(a, rng, 5) + _span(b, rng, 5)
    elif kind == "other source":
        words = _span(other.split(), rng, 12)
    elif kind == "invented":
        words = "customers reported a 40% drop in churn after the rollout".split()
    return " ".join(words)


KINDS = ["swapped word", "dropped word", "changed number", "paraphrase", "spliced fragments", "other source", "invented"]


def _out(quotes: list[str], citations: list[str] | None = None):
    return SimpleNamespace(
        epics=[SimpleNamespace(title=f"E{i}", source_quote=q) for i, q in enumerate(quotes)],
        memory_citations=[SimpleNamespace(learning_id=c) for c in citations or []],
    )


def test_bench_quote_guard():
    rng = random.Random(20261018)
    sources = _sources()
    genuine_total = genuine_accepted = 0
    fab_total = fab_caught = 0
    per_kind = {k: [0, 0] for k in KINDS}
    for idx, src in enumerate(sources):
        other = sources[(idx + 1) % len(sources)]
        for _ in range(10):
            q = _genuine(src, rng)
            if len(normalize(q)) < 8:
                continue
            genuine_total += 1
            genuine_accepted += not evaluator.check_output(src, _out([q]), [])
        for kind in KINDS:
            for _ in range(4):
                q = _fabricated(src, other, rng, kind)
                if normalize(q) in normalize(src) or len(normalize(q)) < 8:
                    continue  # The edit happened to produce real text; not a fabrication.
                fab_total += 1
                per_kind[kind][0] += 1
                caught = bool(evaluator.check_output(src, _out([q]), []))
                fab_caught += caught
                per_kind[kind][1] += caught

    memory = [MemoryItem(id=f"L-{i}", text="lesson", project="p") for i in range(5)]
    cit_total = cit_caught = 0
    for i in range(200):
        bad = rng.choice([f"L-{rng.randint(5, 999)}", f"lesson-{i}", "", "L-1 ", str(uuid_like(rng))])
        cit_total += 1
        cit_caught += bool(evaluator.check_output(sources[0], _out([], [bad]), memory))
    real_cites_ok = not evaluator.check_output(sources[0], _out([], [m.id for m in memory]), memory)

    record(
        "hallucination_quotes",
        sources=len(sources),
        genuine_quotes=genuine_total,
        genuine_accepted=genuine_accepted,
        fabricated_quotes=fab_total,
        fabricated_caught=fab_caught,
        fabricated_passed_through=fab_total - fab_caught,
        per_kind={k: {"trials": v[0], "caught": v[1]} for k, v in per_kind.items()},
        invented_memory_citations=cit_total,
        invented_memory_citations_caught=cit_caught,
        real_memory_citations_accepted=real_cites_ok,
    )
    assert fab_caught == fab_total
    assert genuine_accepted == genuine_total
    assert cit_caught == cit_total and real_cites_ok


def uuid_like(rng: random.Random) -> str:
    return f"{rng.getrandbits(128):032x}"


def test_bench_ideaq_evidence_paths():
    from app.ai import idea_agents

    rng = random.Random(7)
    real = sorted(
        str(p.relative_to(ROOT)) for p in (ROOT / "app").rglob("*.py") if "__pycache__" not in p.parts
    )
    known = set(real)
    import app.services.repo_context as rc

    snapshot = SimpleNamespace()
    orig = rc.known_path
    rc.known_path = lambda _snap, p: p.strip().lstrip("./") in known
    try:
        invented_ideas = real_ideas = mixed = 0
        dropped_invented = kept_real = mixed_cleaned = 0
        ideas = []
        for i in range(300):
            kind = rng.choice(["invented", "real", "mixed"])
            fake = [f"app/{rng.choice(['billing', 'auth', 'core'])}/{rng.choice(['engine', 'utils', 'svc'])}_{i}.py"]
            ev = {"invented": fake, "real": rng.sample(real, 2), "mixed": [rng.choice(real), *fake]}[kind]
            ideas.append((kind, SimpleNamespace(title=f"Idea {i} {kind}", evidence=ev,
                                                model_copy=lambda update, _ev=ev: SimpleNamespace(evidence=update["evidence"]))))
        for kind, idea in ideas:
            kept, _dropped = idea_agents.verify([idea], snapshot)
            if kind == "invented":
                invented_ideas += 1
                dropped_invented += not kept
            elif kind == "real":
                real_ideas += 1
                kept_real += bool(kept)
            else:
                mixed += 1
                mixed_cleaned += bool(kept) and all(p in known for p in kept[0].evidence)
    finally:
        rc.known_path = orig
    record(
        "hallucination_ideaq_paths",
        ideas=len(ideas),
        invented_only=invented_ideas,
        invented_only_dropped=dropped_invented,
        real_evidence=real_ideas,
        real_evidence_kept=kept_real,
        mixed_evidence=mixed,
        mixed_invented_paths_stripped=mixed_cleaned,
    )
    assert dropped_invented == invented_ideas and kept_real == real_ideas and mixed_cleaned == mixed
