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

import pytest

from app.ai import evaluator, fallbacks, genai
from app.ai.evaluator import MemoryItem, check_output, normalize
from app.config import get_settings
from app.schemas import EvaluationOutput
from tests.fakes import IDEAS

IDEA = IDEAS["discounts"]["idea_text"]


def good() -> EvaluationOutput:
    return fallbacks.evaluation_for(IDEA)


def test_fixture_quotes_are_verbatim():
    for key, idea in IDEAS.items():
        out = fallbacks.evaluation_for(idea["idea_text"])
        assert check_output(idea["idea_text"], out, []) == [], key


def test_normalize_folds_quotes_case_and_space():
    assert normalize("  It\u2019s   A\nTest. ") == "it's a test"


def test_invented_quote_is_rejected():
    out = good()
    out.epics[0].source_quote = "customers want loyalty points on every purchase"
    problems = check_output(IDEA, out, [])
    assert any("not a verbatim substring" in p for p in problems)


def test_unknown_memory_citation_is_rejected():
    out = good().model_copy(
        update={"memory_citations": [{"learning_id": "nope", "how_it_applies": "x"}]}
    )
    out = EvaluationOutput.model_validate(out.model_dump())
    assert any("unknown learning id" in p for p in check_output(IDEA, out, []))


def test_epic_count_is_enforced_by_schema():
    data = good().model_dump()
    data["epics"] = data["epics"][:2]
    with pytest.raises(ValueError):
        EvaluationOutput.model_validate(data)


async def test_repair_pass_fixes_a_bad_quote():
    calls = []

    async def gen(**kw):
        calls.append(kw)
        out = good()
        if len(calls) == 1:
            out.epics[0].source_quote = "an invented requirement nobody wrote"
        return out

    result = await evaluator.evaluate(
        idea_text=IDEA, project_name="x", memory=[], generate=gen
    )
    assert len(calls) == 2
    assert "REJECTED" in calls[1]["prompt"]
    assert result.output.memory_note == evaluator.NO_MEMORY
    assert not result.served_from_cache


async def test_two_bad_answers_raise():
    async def gen(**kw):
        out = good()
        out.epics[0].source_quote = "still invented text here"
        return out

    with pytest.raises(genai.ModelError):
        await evaluator.evaluate(
            idea_text=IDEA, project_name="x", memory=[], generate=gen
        )


async def test_no_memory_means_no_citations():
    async def gen(**kw):
        out = good().model_copy(
            update={"memory_citations": [], "memory_note": "lots of memory"}
        )
        return out

    result = await evaluator.evaluate(
        idea_text=IDEA, project_name="x", memory=[], generate=gen
    )
    assert result.output.memory_note == "no relevant memory"


async def test_valid_citation_is_kept():
    mem = [MemoryItem(id="L1", text="Use Decimal", project="Old")]

    async def gen(**kw):
        out = good().model_copy(
            update={
                "memory_citations": [{"learning_id": "L1", "how_it_applies": "y"}],
                "memory_note": "used L1",
            }
        )
        return EvaluationOutput.model_validate(out.model_dump())

    result = await evaluator.evaluate(
        idea_text=IDEA, project_name="x", memory=mem, generate=gen
    )
    assert result.output.memory_citations[0].learning_id == "L1"


async def test_fallback_serves_cache_only_when_enabled(monkeypatch):
    async def boom(**kw):
        raise genai.ModelError("quota")

    with pytest.raises(genai.ModelError):
        await evaluator.evaluate(
            idea_text=IDEA, project_name="x", memory=[], generate=boom
        )

    monkeypatch.setenv("DEMO_FALLBACK", "true")
    get_settings.cache_clear()
    try:
        result = await evaluator.evaluate(
            idea_text=IDEA, project_name="x", memory=[], generate=boom
        )
        assert result.served_from_cache and result.model == "cached-fallback"
    finally:
        monkeypatch.setenv("DEMO_FALLBACK", "false")
        get_settings.cache_clear()


async def test_fallback_keeps_retrieved_memory(monkeypatch):
    async def boom(**kw):
        raise genai.ModelError("quota")

    monkeypatch.setenv("DEMO_FALLBACK", "true")
    get_settings.cache_clear()
    try:
        mem = [MemoryItem(id="L9", text="Use Decimal", project="Old")]
        result = await evaluator.evaluate(
            idea_text=IDEA, project_name="x", memory=mem, generate=boom
        )
        assert result.served_from_cache
        assert [c.learning_id for c in result.output.memory_citations] == ["L9"]
        assert "Cached" in result.output.memory_note
    finally:
        monkeypatch.setenv("DEMO_FALLBACK", "false")
        get_settings.cache_clear()
