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

"""One entry point for model calls, routed by configuration.

``LLM_PROVIDER`` picks the chat model and ``EMBED_PROVIDER`` picks the
embedding model, independently. The rest of the app imports only this module.
"""

from __future__ import annotations

from typing import TypeVar

from pydantic import BaseModel

from app.ai import compression
from app.ai.errors import ModelError
from app.ai.providers import gemini, ollama
from app.config import get_settings

__all__ = [
    "ModelError",
    "chat_model_name",
    "embed",
    "embed_model_name",
    "generate_structured",
    "generate_text",
    "text_configured",
]

T = TypeVar("T", bound=BaseModel)


def chat_model_name() -> str:
    """The model id that ``generate_structured`` will use right now."""
    s = get_settings()
    return s.ollama_model if s.llm_provider == "ollama" else s.gemini_model


def embed_model_name() -> str:
    """Provider-qualified embedding model id, stored beside every vector."""
    s = get_settings()
    if s.embed_provider == "ollama":
        return f"ollama/{s.ollama_embed_model}"
    return f"gemini/{s.embedding_model}"


async def generate_structured(
    *,
    prompt: str,
    schema: type[T],
    system: str,
    model: str | None = None,
    temperature: float = 0.3,
    timeout_s: float = 90.0,
) -> T:
    """Returns a validated ``schema`` instance from the configured chat provider.

    The prompt is compressed with Headroom first (``app.ai.compression``); the
    system instruction is sent verbatim.
    """
    provider = ollama if get_settings().llm_provider == "ollama" else gemini
    prompt, _ = await compression.acompress_prompt(
        prompt, kind=f"structured:{schema.__name__}", model=model or chat_model_name()
    )
    return await provider.generate_structured(
        prompt=prompt,
        schema=schema,
        system=system,
        model=model,
        temperature=temperature,
        timeout_s=timeout_s,
    )


def text_configured() -> bool:
    """True when the chat provider is worth calling (Ollama, or Gemini with credentials)."""
    return get_settings().llm_provider == "ollama" or gemini.configured()


async def generate_text(
    *,
    messages: list[dict[str, str]],
    system: str,
    kind: str,
    model: str | None = None,
    temperature: float = 0.3,
    timeout_s: float = 60.0,
) -> str:
    """Returns free text from the configured chat provider.

    ``messages`` are ``{"role": "user"|"assistant", "content": str}`` turns.
    They are compressed with Headroom before the call; ``system`` is not.

    Raises:
        ModelError: On timeout, API error or an empty reply.
    """
    provider = ollama if get_settings().llm_provider == "ollama" else gemini
    messages, _ = await compression.acompress_messages(
        messages, kind=kind, model=model or chat_model_name()
    )
    return await provider.generate_text(
        messages=messages,
        system=system,
        model=model,
        temperature=temperature,
        timeout_s=timeout_s,
    )


async def embed(text: str, *, task_type: str = "RETRIEVAL_DOCUMENT") -> list[float]:
    """Returns a 768-d vector from the configured embedding provider."""
    provider = ollama if get_settings().embed_provider == "ollama" else gemini
    return await provider.embed(text, task_type=task_type)
