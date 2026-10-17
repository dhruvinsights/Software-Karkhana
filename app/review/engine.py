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

"""Selects the review engine from settings."""

from __future__ import annotations

from app.ai import llm
from app.config import get_settings
from app.review import pr_agent
from app.review.types import ReviewResult


async def review_diff(diff: str, *, title: str) -> ReviewResult:
    """Reviews a diff with the configured engine. Raises ``ModelError`` on failure."""
    if get_settings().review_engine == "pr_agent":
        return await pr_agent.review_diff(diff, title=title)
    from app.agents.coder import run_reviewer

    out = await run_reviewer(diff, title=title)
    engine = "bob" if get_settings().llm_provider == "bob" else "adk"
    return ReviewResult(
        engine=engine,
        model=llm.chat_model_name(),
        comments=list(out.comments),
        summary=f"{len(out.comments)} comment(s) from the {engine} reviewer.",
    )
