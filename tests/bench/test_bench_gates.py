# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Gate bypass: every move a role may not make is refused.

Three surfaces:
1. The stage machine itself, exhaustively: every stage x status x event x role.
2. The HTTP API: director gates attempted by every other role, by strangers,
   anonymously and with forged session tokens. Success is judged by the
   project's state afterwards, not only by the status code.
3. Worker callbacks: forged, cross-run and replayed per-run HMAC tokens.
"""

from __future__ import annotations

import base64
import itertools
import json
import uuid

import pytest

from app import auth, process
from app.process import (
    STAGES,
    TRANSITIONS,
    Event,
    ForbiddenTransition,
    Role,
    TransitionError,
)
from app.runner.base import run_token
from tests.bench.conftest import record
from tests.fakes import IDEAS
from tests.integration.test_golden_path import (  # noqa: F401
    DEV,
    DIR,
    LEAD,
    PM,
    as_,
    client,
    fakes,
    wait_for_stage,
)


class _P:
    def __init__(self, stage, status):
        self.stage, self.stage_status = stage, status


def test_bench_state_machine_exhaustive():
    statuses = sorted(
        {k[1] for k in TRANSITIONS} | {v[1] for v in TRANSITIONS.values()} | {"approved", "merged", "done"}
    )
    attempts = illegal = refused = legal = accepted = 0
    for stage, st, event, role in itertools.product(
        [s.id for s in STAGES], statuses, list(Event), list(Role)
    ):
        attempts += 1
        rule = TRANSITIONS.get((stage, st, event))
        allowed = bool(rule and rule[2] and role in rule[2])
        try:
            process.check(_P(stage, st), event, role)
            ok = True
        except (TransitionError, ForbiddenTransition):
            ok = False
        if allowed:
            legal += 1
            accepted += ok
        else:
            illegal += 1
            refused += not ok
    record(
        "gate_state_machine",
        stages=len(STAGES),
        statuses=len(statuses),
        events=len(Event),
        roles=len(Role),
        attempts=attempts,
        illegal_attempts=illegal,
        illegal_refused=refused,
        legal_attempts=legal,
        legal_accepted=accepted,
    )
    assert refused == illegal and accepted == legal


def _forged_tokens(email: str) -> dict[str, str]:
    def b64(d: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    good = auth.create_token({"email": PM})
    h, _b, sig = good.split(".")
    import app.auth as a

    real = a._session_secret
    a._session_secret = lambda: b"attacker-key-attacker-key-000000"
    try:
        wrong_key = auth.create_token({"email": email})
    finally:
        a._session_secret = real
    return {
        "alg_none": f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64({'email': email, 'typ': 'session'})}.",
        "wrong_signing_key": wrong_key,
        "body_swapped_to_director": f"{h}.{b64({'email': email, 'typ': 'session', 'exp': 9999999999})}.{sig}",
        "expired": auth.create_token({"email": email}, expires_in_seconds=-60),
        "garbage": "eyJ.not.a-token",
        "run_token_as_session": run_token(uuid.uuid4()),
    }


pytestmark_db = pytest.mark.usefixtures("database")


@pytestmark_db
async def test_bench_api_gate_bypass(client, fakes):
    idea = IDEAS["discounts"]
    r = await client.post("/api/projects", json={"name": "Bench gates", "idea_text": idea["idea_text"]}, headers=as_(PM))
    pid = r.json()["id"]
    detail = await wait_for_stage(client, pid, "evaluated")
    tid = detail["tasks"][0]["id"]

    identities: dict[str, dict[str, str]] = {
        "pm": as_(PM),
        "developer": as_(DEV),
        "lead": as_(LEAD),
        "unregistered user": as_("mallory@evil.example"),
        "anonymous": {},
    }
    for name, tok in _forged_tokens(DIR).items():
        identities[f"forged session: {name}"] = {"Authorization": f"Bearer {tok}"}

    actions = [
        ("approve", "post", f"/api/projects/{pid}/approve", {"decision": "approved", "reason": "bypass"}),
        ("reject", "post", f"/api/projects/{pid}/approve", {"decision": "rejected", "reason": "bypass"}),
        ("batch approve", "post", "/api/projects/batch-approve", {"project_ids": [pid], "decision": "approved"}),
        ("start run on draft task", "post", f"/api/tasks/{tid}/runs", None),
    ]
    attempts = refused = 0
    leaks: list[str] = []
    for (who, headers), (what, method, url, body) in itertools.product(identities.items(), actions):
        attempts += 1
        r = await client.request(method.upper(), url, json=body, headers=headers)
        state = (await client.get(f"/api/projects/{pid}", headers=as_(PM))).json()
        unchanged = state["project"]["stage_status"] == "evaluated" and all(
            t["status"] == "draft" for t in state["tasks"]
        )
        runs = (await client.get(f"/api/tasks/{tid}/runs", headers=as_(PM))).json()
        if unchanged and not runs and (r.status_code >= 400 or r.json().get("approved_count") == 0):
            refused += 1
        else:
            leaks.append(f"{who} -> {what}: {r.status_code}")

    # The one legitimate actor still gets through: the gate is not simply broken shut.
    ok = await client.post(f"/api/projects/{pid}/approve", json={"decision": "approved", "reason": "ok"}, headers=as_(DIR))
    record(
        "gate_api_bypass",
        identities=len(identities),
        gate_actions=len(actions),
        attempts=attempts,
        refused=refused,
        leaks=leaks,
        director_still_allowed=ok.status_code == 200,
    )
    assert refused == attempts, leaks
    assert ok.status_code == 200


@pytestmark_db
async def test_bench_hmac_callbacks(client, fakes):
    idea = IDEAS["discounts"]
    r = await client.post("/api/projects", json={"name": "Bench hmac", "idea_text": idea["idea_text"]}, headers=as_(PM))
    pid = r.json()["id"]
    detail = await wait_for_stage(client, pid, "evaluated")
    await client.post(f"/api/projects/{pid}/approve", json={"decision": "approved", "reason": "go"}, headers=as_(DIR))
    tasks = detail["tasks"]
    run_a = (await client.post(f"/api/tasks/{tasks[0]['id']}/runs", headers=as_(DEV))).json()["id"]
    run_b = (await client.post(f"/api/tasks/{tasks[1]['id']}/runs", headers=as_(DEV))).json()["id"]

    import hashlib
    import hmac

    valid = run_token(run_a)
    forged = {
        "missing header": None,
        "empty token": "Run ",
        "random 64-hex": "Run " + uuid.uuid4().hex + uuid.uuid4().hex,
        "token of another run (cross-run replay)": f"Run {run_token(run_b)}",
        "signed with wrong secret": "Run " + hmac.new(b"wrong", f"run:{run_a}".encode(), hashlib.sha256).hexdigest(),
        "truncated token": f"Run {valid[:32]}",
        "upper-cased token": f"Run {valid.upper()}",
        "one character flipped": f"Run {valid[:-1]}{'0' if valid[-1] != '0' else '1'}",
        "session JWT instead of run token": f"Run {auth.create_token({'email': DEV})}",
        "bearer scheme": f"Bearer {valid}",
    }
    fail = {"ok": False, "error": "forged"}
    endpoints = [
        ("GET", f"/internal/runs/{run_a}/spec", None),
        ("POST", f"/internal/runs/{run_a}/progress", {"phase": "coding"}),
        ("POST", f"/internal/runs/{run_a}/tests", {"suite": "unit", "status": "passed"}),
        ("POST", f"/internal/runs/{run_a}/complete", fail),
    ]
    attempts = refused = 0
    leaks = []
    for (name, header), (method, url, body) in itertools.product(forged.items(), endpoints):
        attempts += 1
        headers = {"Authorization": header} if header is not None else {}
        r = await client.request(method, url, json=body, headers=headers)
        if r.status_code == 401:
            refused += 1
        else:
            leaks.append(f"{name} {method} {url.rsplit('/', 1)[-1]}: {r.status_code}")
    run = (await client.get(f"/api/runs/{run_a}", headers=as_(DEV))).json()
    untouched = run["status"] not in ("failed", "succeeded")

    # Replay of a genuine final callback: the first counts, the replay changes nothing.
    auth_ok = {"Authorization": f"Run {valid}"}
    first = await client.post(f"/internal/runs/{run_a}/complete", json={"ok": False, "error": "real failure"}, headers=auth_ok)
    replays_blocked = 0
    replays = 20
    for _ in range(replays):
        r = await client.post(
            f"/internal/runs/{run_a}/complete",
            json={"ok": True, "patch": "diff --git a b", "test_exit_code": 0, "test_command": "pytest"},
            headers=auth_ok,
        )
        replays_blocked += r.json().get("note") == "already final"
    final = (await client.get(f"/api/runs/{run_a}", headers=as_(DEV))).json()

    record(
        "gate_hmac_callbacks",
        forged_variants=len(forged),
        endpoints=len(endpoints),
        attempts=attempts,
        refused=refused,
        leaks=leaks,
        run_untouched_by_forgeries=untouched,
        replays=replays,
        replays_blocked=replays_blocked,
        final_status_after_replays=final["status"],
    )
    assert first.status_code == 200
    assert refused == attempts and untouched, leaks
    assert replays_blocked == replays and final["status"] == "failed"
