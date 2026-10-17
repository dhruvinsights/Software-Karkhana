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

"""ADK Coder and Reviewer agents (features A8 and A10).

The Coder is an ``LlmAgent`` with five workspace tools. The Reviewer is an
``LlmAgent`` with ``output_schema`` so its comments arrive as typed data. Both
run under an ADK ``Runner`` with an in-memory session: run state that matters
lives in Cloud SQL, owned by the control plane.
"""

from __future__ import annotations

import logging
import os
import uuid

from google.adk.agents import LlmAgent
from google.adk.agents.run_config import RunConfig
from google.adk.models import BaseLlm, Gemini
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.agents.ollama_llm import OllamaLlm
from app.agents.tools import Workspace, make_tools
from app.ai import compression
from app.config import get_settings
from app.schemas import ReviewOutput

logger = logging.getLogger(__name__)
APP_NAME = "karkhana"


def configure_gemini_env() -> None:
    """Points ADK's Gemini at an AI Studio key, else Vertex AI with ADC."""
    s = get_settings()
    if s.gemini_api_key:
        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "False"
        os.environ["GOOGLE_API_KEY"] = s.gemini_api_key
        return
    # Assign, never setdefault: a stray regional GOOGLE_CLOUD_LOCATION in the
    # environment would break Gemini 3 models, which are served from "global".
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "True"
    os.environ["GOOGLE_CLOUD_PROJECT"] = s.google_cloud_project
    os.environ["GOOGLE_CLOUD_LOCATION"] = s.genai_location


def _model(gemini_name: str, ollama_name: str) -> BaseLlm:
    """The ADK model for the configured provider (Gemini or Ollama)."""
    if get_settings().llm_provider == "ollama":
        return OllamaLlm(model=ollama_name)
    return Gemini(model=gemini_name, retry_options=types.HttpRetryOptions(attempts=3))


CODER_INSTRUCTION = """\
You are the Coder agent in Software Karkhana. You implement exactly one story
in the repository you can see through your tools.

Process:
1. Read AGENTS.md and README.md first, then the code you need.
2. Make the smallest change that meets every acceptance criterion. Use
   replace_in_file for edits; use write_file only for new files.
3. Add or update pytest tests that prove each criterion.
4. Call run_tests. If anything fails, read the output, fix, and run again.
5. Stop when tests pass. Reply with a short summary of what you changed.

Never edit files outside the repository, never add dependencies, never weaken
or delete existing tests to make them pass.
"""

REVIEWER_INSTRUCTION = """\
You are the Reviewer agent in Software Karkhana. You review a unified diff for
correctness, missing tests, money and rounding errors, error handling and
readability. Return 3 to 5 specific, actionable comments, each tied to a file
path in the diff. Each added or context line is prefixed with its line number in
the new file: set "line" to that number for the exact line you mean, and leave it
null only for a whole-file remark. Rank severity honestly: use "high" only for
real bugs, such as injection, data loss or wrong results.
Your comments are AI-generated and unverified; a developer will triage each one.
"""


def build_coder(ws: Workspace) -> LlmAgent:
    """Builds the Coder bound to one workspace."""
    return LlmAgent(
        name="coder",
        description="Implements one story with tests in a path-confined repository checkout.",
        model=_model(
            get_settings().gemini_coder_model, get_settings().ollama_coder_model
        ),
        instruction=CODER_INSTRUCTION,
        tools=make_tools(ws),
        generate_content_config=types.GenerateContentConfig(temperature=0.2),
        # File reads feed replace_in_file, so tool outputs must stay
        # byte-exact: always Headroom's verified-lossless regime.
        before_model_callback=compression.adk_before_model_callback(
            kind="coder", lossless=True
        ),
    )


def build_reviewer() -> LlmAgent:
    """Builds the Reviewer with a typed output schema."""
    return LlmAgent(
        name="reviewer",
        description="Reviews a diff and returns 3-5 typed comments.",
        model=_model(get_settings().gemini_model, get_settings().ollama_model),
        instruction=REVIEWER_INSTRUCTION,
        output_schema=ReviewOutput,
        output_key="review",
        generate_content_config=types.GenerateContentConfig(temperature=0.2),
        before_model_callback=compression.adk_before_model_callback(
            kind="reviewer", lossless=None
        ),
    )


async def _run(agent: LlmAgent, message: str, max_llm_calls: int) -> tuple[str, dict]:
    """Runs an agent to completion and returns (final text, session state)."""
    configure_gemini_env()
    sessions = InMemorySessionService()
    runner = Runner(app_name=APP_NAME, agent=agent, session_service=sessions)
    user_id, session_id = "worker", uuid.uuid4().hex
    await sessions.create_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id
    )
    final = ""
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=types.Content(role="user", parts=[types.Part(text=message)]),
        run_config=RunConfig(max_llm_calls=max_llm_calls),
    ):
        if event.is_final_response() and event.content and event.content.parts:
            final = "".join(p.text or "" for p in event.content.parts)
    session = await sessions.get_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id
    )
    return final, dict(session.state) if session else {}


async def run_coder(
    ws: Workspace,
    *,
    title: str,
    description: str,
    criteria: list[str],
    context: list[str] | None = None,
) -> str:
    """Runs the Coder on one story and returns its summary."""
    message = (
        f"STORY: {title}\n\nDESCRIPTION:\n{description or '(none)'}\n\n"
        "ACCEPTANCE CRITERIA:\n" + "\n".join(f"- {c}" for c in criteria)
    )
    if context:
        message += (
            "\n\nSHARED PROJECT CONTEXT (decisions and handoffs from people and "
            "earlier runs; follow decisions, do not repeat finished work):\n"
            + "\n".join(context)
        )
    summary, _ = await _run(build_coder(ws), message, max_llm_calls=40)
    return summary


async def run_reviewer(diff: str, *, title: str) -> ReviewOutput:
    """Runs the Reviewer on a diff and returns validated comments."""
    from app.review.diff import number_diff

    shown = number_diff(diff) or diff
    message = f"STORY: {title}\n\nDIFF:\n```\n{shown[:60_000]}\n```"
    final, state = await _run(build_reviewer(), message, max_llm_calls=3)
    raw = state.get("review") or final
    if isinstance(raw, dict):
        return ReviewOutput.model_validate(raw)
    return ReviewOutput.model_validate_json(raw)
