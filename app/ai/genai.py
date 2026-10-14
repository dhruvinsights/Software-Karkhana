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

"""Gemini on Vertex AI through the Google Gen AI SDK.

One cached client per process. Every call requests structured JSON with a
Pydantic ``response_schema``, uses SDK-level retries with backoff, and has a
hard timeout so a slow model call can never hang a request.
"""

from __future__ import annotations

import asyncio
import functools
import logging
from typing import TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.config import get_settings

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

RETRY = types.HttpRetryOptions(attempts=3, initial_delay=1.0, max_delay=8.0)


class ModelError(Exception):
    """The model call failed or returned something that does not validate."""


@functools.cache
def client(location: str | None = None) -> genai.Client:
    """Returns a cached Vertex AI client for a location (ADC credentials)."""
    s = get_settings()
    return genai.Client(
        vertexai=True,
        project=s.google_cloud_project,
        location=location or s.genai_location,
        http_options=types.HttpOptions(retry_options=RETRY),
    )


async def generate_structured(
    *,
    prompt: str,
    schema: type[T],
    system: str,
    model: str | None = None,
    temperature: float = 0.3,
    timeout_s: float = 90.0,
) -> T:
    """Calls Gemini and returns a validated instance of ``schema``.

    Args:
        prompt: The user turn.
        schema: Pydantic model used both as ``response_schema`` and validator.
        system: System instruction.
        model: Model id; defaults to ``GEMINI_MODEL``.
        temperature: Sampling temperature.
        timeout_s: Wall-clock limit for the whole call, retries included.

    Returns:
        The parsed and validated response.

    Raises:
        ModelError: On timeout, API error or invalid output.
    """
    model = model or get_settings().gemini_model
    config = types.GenerateContentConfig(
        system_instruction=system,
        temperature=temperature,
        response_mime_type="application/json",
        response_schema=schema,
    )
    try:
        response = await asyncio.wait_for(
            client().aio.models.generate_content(
                model=model, contents=prompt, config=config
            ),
            timeout=timeout_s,
        )
    except TimeoutError as exc:
        raise ModelError(f"{model} timed out after {timeout_s:.0f}s") from exc
    except Exception as exc:
        raise ModelError(f"{model} call failed: {exc}") from exc

    text = response.text or ""
    try:
        return schema.model_validate_json(text)
    except ValidationError as exc:
        logger.warning("Gemini output failed validation: %s", exc.errors()[:3])
        raise ModelError(
            f"{model} output did not match {schema.__name__}: {exc}"
        ) from exc


async def embed(text: str, *, task_type: str = "RETRIEVAL_DOCUMENT") -> list[float]:
    """Embeds text with the configured Gemini embedding model."""
    s = get_settings()
    try:
        resp = await asyncio.wait_for(
            client(s.embedding_location).aio.models.embed_content(
                model=s.embedding_model,
                contents=text,
                config=types.EmbedContentConfig(
                    task_type=task_type, output_dimensionality=s.embedding_dim
                ),
            ),
            timeout=30,
        )
    except Exception as exc:
        raise ModelError(f"embedding failed: {exc}") from exc
    values = resp.embeddings[0].values if resp.embeddings else None
    if not values or len(values) != s.embedding_dim:
        raise ModelError("embedding has the wrong dimension")
    return list(values)
