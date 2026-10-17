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

from app.schemas import EvaluationOutput, LearningOutput, ReviewOutput
from app.services.project_docs import Backlog, Erd, Prd
from tests import fixtures as fallbacks

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


PRD = {
    "summary": "Add percentage discounts to invoices.",
    "problem": "Invoices cannot carry a discount.",
    "goals": ["Apply a discount to an invoice total"],
    "non_goals": [],
    "personas": [{"name": "Billing clerk", "needs": "Discount an invoice"}],
    "journeys": [{"name": "Discount", "steps": ["Open invoice", "Apply discount"]}],
    "functional": [
        {"id": "FR-1", "title": "Discount", "description": "Apply a percentage.", "priority": "Must",
         "acceptance_criteria": ["10% off 100.00 is 90.00"]},
        {"id": "FR-2", "title": "Rounding", "description": "Round half up.", "priority": "Should",
         "acceptance_criteria": ["Rounds to the minor unit"]},
    ],
    "non_functional": [],
    "success_metrics": ["Discounted invoices total correctly"],
    "dependencies": [],
    "risks": [],
    "open_questions": [],
    "milestones": ["Discounts live"],
}
ERD = {
    "entities": [{"name": "invoices", "status": "new", "description": "Invoices",
                  "columns": [{"name": "id", "type": "uuid", "key": "PK"}]}],
    "relations": [],
    "notes": [],
}
BACKLOG = {
    "epics": [{"title": "Discounts", "description": "Discounts on invoices", "stories": [
        {"title": "As a clerk, I want a discount so that invoices are correct.",
         "acceptance_criteria": ["Given 100.00, when 10% off, then 90.00", "Given a total, then round half up"],
         "requirement_ids": ["FR-1", "FR-2"], "estimate": 2, "layer": "backend"},
    ]}],
}


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
        if schema is Prd:
            return Prd.model_validate(PRD)
        if schema is Erd:
            return Erd.model_validate(ERD)
        if schema is Backlog:
            return Backlog.model_validate(BACKLOG)
        raise AssertionError(f"unexpected schema {schema}")

    async def embed(self, text, *, task_type="RETRIEVAL_DOCUMENT"):
        return fake_vector(text)
