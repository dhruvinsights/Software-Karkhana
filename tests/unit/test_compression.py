# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Headroom context compression: flags, fallbacks, provider coverage, tenant safety."""

from __future__ import annotations

import json
import sys

import pytest
from google.genai import types
from pydantic import BaseModel

from app.ai import compression, llm
from app.ai.providers import gemini, ollama
from app.config import get_settings

pytest.importorskip("headroom")

ROWS = json.dumps(
    [
        {"id": i, "path": f"app/mod{i % 3}.py", "status": "ok", "msg": "fine"}
        for i in range(150)
    ]
)


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    s = get_settings()
    for name in ("headroom_enabled", "headroom_mode", "headroom_min_chars"):
        monkeypatch.setattr(s, name, getattr(s, name))
    s.headroom_enabled, s.headroom_mode = True, "lossless"
    yield s


def test_lossless_mode_densifies_json_and_counts_tokens():
    out, st = compression.compress_text(ROWS, kind="t")
    assert st.applied and st.mode == "lossless"
    assert st.tokens_after < st.tokens_before * 0.5 and st.tokens_saved > 0
    assert out != ROWS
    from headroom import expand_compacted

    assert expand_compacted(out) == json.loads(ROWS)  # nothing was lost


def test_aggressive_mode_never_loses_to_lossless(_settings):
    _, lossless = compression.compress_text(ROWS, kind="t")
    _settings.headroom_mode = "aggressive"
    _, aggressive = compression.compress_text(ROWS, kind="t")
    assert (
        aggressive.mode == "aggressive"
        and aggressive.tokens_after <= lossless.tokens_after
    )


def test_disabled_is_identity(_settings):
    _settings.headroom_enabled = False
    out, st = compression.compress_text(ROWS, kind="t")
    assert out == ROWS and not st.applied and st.tokens_saved == 0


def test_short_text_is_not_sent_to_headroom(monkeypatch):
    monkeypatch.setattr(compression, "_headroom", lambda: pytest.fail("called"))
    out, st = compression.compress_text("short", kind="t")
    assert out == "short" and not st.applied


def test_missing_headroom_falls_back_to_identity(monkeypatch):
    monkeypatch.setattr(compression, "_loaded", None)
    monkeypatch.setitem(sys.modules, "headroom", None)  # makes `import headroom` fail
    out, st = compression.compress_text(ROWS, kind="t")
    assert out == ROWS and not st.applied
    assert compression.available() is False


def test_headroom_error_falls_back_to_identity(monkeypatch):
    real = compression._headroom()

    def boom(*a, **k):
        raise RuntimeError("kaput")

    monkeypatch.setattr(compression, "_headroom", lambda: {**real, "compress": boom})
    out, st = compression.compress_text(ROWS, kind="t")
    assert out == ROWS and not st.applied


def test_ccr_markers_are_reverted_and_nothing_reaches_the_global_store(monkeypatch):
    from headroom.cache.compression_store import get_compression_store

    real = compression._headroom()
    global_store = get_compression_store()
    before = global_store.get_stats()["entry_count"]
    seen_stores = []

    class Res:
        def __init__(self, messages):
            self.messages = messages
            self.tokens_before, self.tokens_after = 1000, 10
            self.transforms_applied = ["fake"]

    def fake_compress(messages, **kw):
        store = get_compression_store()
        seen_stores.append(store)
        assert store is not global_store  # per-call sink, not the shared store
        return Res(
            [{**m, "content": "<<ccr:deadbeef>> 150 rows elided"} for m in messages]
        )

    monkeypatch.setattr(
        compression, "_headroom", lambda: {**real, "compress": fake_compress}
    )
    out1, st = compression.compress_text(ROWS, kind="t")
    out2, _ = compression.compress_text(ROWS, kind="t")
    assert out1 == ROWS and out2 == ROWS and not st.applied  # marker => original
    assert seen_stores[0] is not seen_stores[1]  # never shared between calls
    assert get_compression_store() is global_store  # request store cleared after
    assert global_store.get_stats()["entry_count"] == before


def test_real_compression_stores_no_originals(_settings):
    from headroom.cache.compression_store import get_compression_store

    before = get_compression_store().get_stats()["entry_count"]
    for mode in ("lossless", "aggressive"):
        _settings.headroom_mode = mode
        compression.compress_text(ROWS, kind="t")
    assert get_compression_store().get_stats()["entry_count"] == before


def test_genai_contents_compress_tool_output_without_mutating_history():
    rows = json.loads(ROWS)
    contents = [
        types.Content(role="user", parts=[types.Part(text="Fix the failing test")]),
        types.Content(
            role="model",
            parts=[types.Part(function_call=types.FunctionCall(name="scan", args={}))],
        ),
        types.Content(
            role="user",
            parts=[
                types.Part(
                    function_response=types.FunctionResponse(
                        name="scan", response={"rows": rows, "exit_code": 1}
                    )
                )
            ],
        ),
    ]
    with compression.track() as totals:
        new, st = compression.compress_genai_contents(contents, kind="coder")
    assert st.applied and totals.calls == 1 and totals.as_dict()["tokens_saved"] > 0
    assert contents[2].parts[0].function_response.response["rows"] == rows  # untouched
    resp = new[2].parts[0].function_response.response
    assert isinstance(resp["rows"], str) and resp["exit_code"] == 1
    assert new[0] is contents[0] and new[1] is contents[1]


async def test_adk_callback_rewrites_the_request():
    from google.adk.models import LlmRequest

    req = LlmRequest(
        model="gemini-3-flash-preview",
        contents=[types.Content(role="user", parts=[types.Part(text=ROWS)])],
    )
    cb = compression.adk_before_model_callback(kind="coder")
    assert await cb(None, req) is None
    assert req.contents[0].parts[0].text != ROWS


def test_coder_and_reviewer_compress_every_model_call():
    from app.agents.coder import build_coder, build_reviewer
    from app.agents.tools import Workspace

    coder = build_coder(Workspace(__import__("pathlib").Path(".")))
    assert coder.before_model_callback is not None
    assert build_reviewer().before_model_callback is not None


class Out(BaseModel):
    ok: bool


@pytest.mark.parametrize("provider", ["gemini", "ollama"])
async def test_every_provider_path_is_compressed(monkeypatch, provider):
    s = get_settings()
    monkeypatch.setattr(s, "llm_provider", provider)
    calls, sent = [], {}

    def spy(messages, **kw):
        calls.append(kw["kind"])
        return [
            {**m, "content": "COMPRESSED"} for m in messages
        ], compression.CompressionStats(kind=kw["kind"], mode="lossless")

    monkeypatch.setattr(compression, "compress_messages", spy)
    monkeypatch.setattr(s, "headroom_min_chars", 0)
    mod = gemini if provider == "gemini" else ollama

    async def fake_structured(**kw):
        sent["structured"] = kw["prompt"]
        return Out(ok=True)

    async def fake_text(**kw):
        sent["text"] = kw["messages"]
        return "hi"

    monkeypatch.setattr(mod, "generate_structured", fake_structured)
    monkeypatch.setattr(mod, "generate_text", fake_text)
    await llm.generate_structured(prompt=ROWS, schema=Out, system="sys")
    await llm.generate_text(
        messages=[{"role": "user", "content": ROWS}], system="s", kind="rag"
    )
    assert calls == ["structured:Out", "rag"]
    assert sent["structured"] == "COMPRESSED"
    assert sent["text"][0]["content"] == "COMPRESSED"


async def test_gemini_router_goes_through_the_provider_layer(monkeypatch):
    from app.routers import gemini as gemini_router

    kinds = []

    async def fake_text(*, messages, system, kind, **_):
        kinds.append(kind)
        return '{"ideas": [{"title": "x"}]}' if kind == "gemini:ideas" else "hello"

    monkeypatch.setattr(llm, "generate_text", fake_text)
    monkeypatch.setattr(llm, "text_configured", lambda: True)
    out = await gemini_router.generate_ideas(
        gemini_router.GenerateIdeasRequest(prompt="p")
    )
    assert out["ideas"][0]["title"] == "x"
    reply = await gemini_router.ai_companion(
        gemini_router.CompanionRequest(messages=[{"role": "user", "content": "hi"}])
    )
    assert reply["reply"] == "hello" and kinds == ["gemini:ideas", "gemini:companion"]


async def test_worker_reports_compression_totals(monkeypatch):
    from app.schemas import RunResult
    from app.worker import main as worker

    async def fake_build(spec, cp):
        compression.compress_text(ROWS, kind="coder")
        return RunResult(ok=False, error="x")

    monkeypatch.setattr(worker, "_build", fake_build)
    result = await worker.build(None, None)
    cc = result.context_compression
    assert cc["engine"] == "headroom" and cc["calls"] == 1 and cc["tokens_saved"] > 0
