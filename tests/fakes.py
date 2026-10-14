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

"""Deterministic stand-ins for Gemini so tests never call the network."""

from __future__ import annotations

import hashlib

from app.ai import fallbacks
from app.schemas import EvaluationOutput, LearningOutput, ReviewOutput

IDEAS = {i["key"]: i for i in fallbacks.demo_ideas()}


def fake_vector(text: str) -> list[float]:
    """Stable 768-d vector; texts sharing the word 'rounding' land close together."""
    base = [0.0] * 768
    if "round" in text.lower() or "minor unit" in text.lower():
        base[0] = 1.0
    h = hashlib.sha256(text.encode()).digest()
    for i in range(1, 16):
        base[i] = h[i] / 2550.0
    return base


class FakeGemini:
    """Records calls and returns canned, schema-valid answers."""

    def __init__(self, cite_memory: bool = True) -> None:
        self.calls: list[str] = []
        self.cite_memory = cite_memory

    async def generate(
        self, *, prompt, schema, system, model=None, temperature=0.3, timeout_s=90.0
    ):
        self.calls.append(prompt)
        if schema is EvaluationOutput:
            key = "refunds" if "refund" in prompt.lower() else "discounts"
            out = fallbacks.evaluation_for(IDEAS[key]["idea_text"])
            if self.cite_memory and "id=" in prompt:
                lid = prompt.split("id=", 1)[1].split(" ", 1)[0]
                out = out.model_copy(
                    update={
                        "memory_citations": [
                            {
                                "learning_id": lid,
                                "how_it_applies": "Use Decimal rounding for refunds.",
                            }
                        ],
                        "memory_note": "Applied one verified learning about rounding.",
                    }
                )
                out = EvaluationOutput.model_validate(out.model_dump())
            return out
        if schema is LearningOutput:
            return LearningOutput(
                text="Quantize money once per amount with ROUND_HALF_UP to the minor unit."
            )
        if schema is ReviewOutput:
            return fallbacks.review()
        raise AssertionError(f"unexpected schema {schema}")

    async def embed(self, text, *, task_type="RETRIEVAL_DOCUMENT"):
        return fake_vector(text)
