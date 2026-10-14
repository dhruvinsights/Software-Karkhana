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

"""Cached Gemini outputs for the demo (feature C5).

Used only when ``DEMO_FALLBACK=true`` and a live call fails. Anything served
from here is stored with ``served_from_cache=true`` and labelled "Cached" in
the UI, so the audience is never misled about what ran live.
"""

from __future__ import annotations

import functools
import json
from pathlib import Path

from app.schemas import EvaluationOutput, ReviewOutput

_DIR = Path(__file__).parent


@functools.cache
def demo_ideas() -> list[dict[str, str]]:
    """Returns the seeded demo ideas."""
    return json.loads((_DIR / "demo_ideas.json").read_text())


def evaluation_for(idea_text: str) -> EvaluationOutput | None:
    """Returns the cached evaluation for a known demo idea, else None."""
    from app.ai.evaluator import normalize

    for idea in demo_ideas():
        if normalize(idea["idea_text"]) == normalize(idea_text):
            path = _DIR / f"eval_{idea['key']}.json"
            return EvaluationOutput.model_validate_json(path.read_text())
    return None


def review() -> ReviewOutput:
    """Returns a cached review for the demo discount story."""
    return ReviewOutput.model_validate_json(
        (_DIR / "review_discounts.json").read_text()
    )


def demo_patch() -> str:
    """Returns the pre-built patch for the demo discount story."""
    return (_DIR / "demo_patch.diff").read_text()
