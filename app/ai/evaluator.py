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

"""Evaluator agent: idea in, validated evaluation out.

Three layers of defence keep hallucinations off the director's screen:

1. Gemini must answer in the ``EvaluationOutput`` schema.
2. Every epic's ``source_quote`` must appear verbatim in the idea text.
3. Memory citations may only reference learnings we actually retrieved; the
   UI shows project, PR and verifier from the database, not from the model.

If validation fails, the model gets one repair attempt with the exact errors.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.ai import llm
from app.ai.errors import ModelError
from app.schemas import EvaluationOutput

logger = logging.getLogger(__name__)

NO_MEMORY = "no relevant memory"

SYSTEM = """\
You are the Evaluator in Software Karkhana, acting like a strict PMO reviewer.
You assess a product idea for a director who must approve or reject it.

Rules:
- Use only the idea text and the memory entries provided. Do not invent facts,
  customers, numbers or deadlines.
- Produce 3 to 5 epics. For every epic, `source_quote` MUST be copied verbatim
  from the idea text (an exact substring, 5 to 25 words). If you cannot quote
  the idea for an epic, do not create that epic.
- Gaps are questions the idea does not answer and that change the plan.
- Score 1 to 10 for potential; justify it in one or two sentences.
- Memory: you may cite only learnings listed under MEMORY, by their id, and
  only when they genuinely change the plan. If none apply, return an empty
  `memory_citations` list and set `memory_note` to exactly "no relevant memory".
- Write plainly. No marketing language.
"""


@dataclass(frozen=True)
class MemoryItem:
    """A verified learning offered to the model."""

    id: str
    text: str
    project: str


def normalize(text: str) -> str:
    """Folds case, quotes, dashes and whitespace for quote matching."""
    text = unicodedata.normalize("NFKC", text).casefold()
    text = text.translate(
        str.maketrans(
            {
                "\u2018": "'",
                "\u2019": "'",
                "\u201c": '"',
                "\u201d": '"',
                "\u2013": "-",
                "\u2014": "-",
            }
        )
    )
    return re.sub(r"\s+", " ", text).strip().strip(".,;:\"'")


def check_output(
    idea_text: str, out: EvaluationOutput, memory: list[MemoryItem]
) -> list[str]:
    """Returns human-readable problems; empty means the output is acceptable."""
    problems: list[str] = []
    idea = normalize(idea_text)
    for i, epic in enumerate(out.epics, start=1):
        quote = normalize(epic.source_quote)
        if len(quote) < 8:
            problems.append(
                f"Epic {i} ('{epic.title}') has a source_quote that is too short."
            )
        elif quote not in idea:
            problems.append(
                f"Epic {i} ('{epic.title}') source_quote is not a verbatim substring of the idea: "
                f"{epic.source_quote!r}"
            )
    allowed = {m.id for m in memory}
    for c in out.memory_citations:
        if c.learning_id not in allowed:
            problems.append(
                f"memory_citations references unknown learning id {c.learning_id!r}."
            )
    return problems


def enforce_memory_rules(
    out: EvaluationOutput, memory: list[MemoryItem]
) -> EvaluationOutput:
    """Applies the memory contract regardless of what the model said."""
    if not memory or not out.memory_citations:
        return out.model_copy(update={"memory_citations": [], "memory_note": NO_MEMORY})
    return out


def build_prompt(idea_text: str, project_name: str, memory: list[MemoryItem]) -> str:
    """Builds the user turn."""
    mem = (
        "\n".join(f"- id={m.id} (from project '{m.project}'): {m.text}" for m in memory)
        if memory
        else "(none retrieved)"
    )
    return (
        f"PROJECT NAME: {project_name}\n\n"
        f"IDEA TEXT (quote from this verbatim):\n<<<\n{idea_text}\n>>>\n\n"
        f"MEMORY (verified learnings from earlier projects):\n{mem}\n"
    )


Generator = Callable[..., Awaitable[EvaluationOutput]]


@dataclass
class EvaluationResult:
    """Validated evaluation plus provenance."""

    output: EvaluationOutput
    model: str


async def evaluate(
    *,
    idea_text: str,
    project_name: str,
    memory: list[MemoryItem],
    generate: Generator | None = None,
) -> EvaluationResult:
    """Runs the evaluator with validation and one repair pass.

    Args:
        idea_text: The PM's idea, the only allowed source for epics.
        project_name: For context in the prompt.
        memory: Verified learnings retrieved for this idea.
        generate: Injected model call for tests; defaults to the configured provider.

    Returns:
        A validated :class:`EvaluationResult`.

    Raises:
        ModelError: If the model fails or its output stays invalid.
    """
    generate = generate or llm.generate_structured
    prompt = build_prompt(idea_text, project_name, memory)
    out = await generate(prompt=prompt, schema=EvaluationOutput, system=SYSTEM)
    problems = check_output(idea_text, out, memory)
    if problems:
        logger.info("Evaluator repair pass: %s", problems)
        repair = (
            prompt
            + "\n\nYOUR PREVIOUS ANSWER WAS REJECTED FOR THESE REASONS:\n- "
            + "\n- ".join(problems)
            + "\n\nPrevious answer:\n"
            + json.dumps(out.model_dump())
            + "\n\nReturn a corrected answer in the same schema."
        )
        out = await generate(
            prompt=repair, schema=EvaluationOutput, system=SYSTEM, temperature=0.1
        )
        problems = check_output(idea_text, out, memory)
        if problems:
            raise ModelError(
                "Evaluation failed validation twice: " + "; ".join(problems)
            )
    return EvaluationResult(enforce_memory_rules(out, memory), llm.chat_model_name())
