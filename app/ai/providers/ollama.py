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

"""Ollama (local models): chat with JSON-schema output, and embeddings.

Talks to the Ollama HTTP API directly (``/api/chat``, ``/api/embed``) so there
is no extra dependency. Structured output uses Ollama's ``format`` parameter
with the Pydantic JSON schema, which constrains decoding to that shape.
Embeddings use ``nomic-embed-text`` (768 dimensions), with the task prefixes
the model was trained on.
"""

from __future__ import annotations

import logging
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.ai.errors import ModelError
from app.config import get_settings

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

# nomic-embed-text expects a task prefix on every input.
_PREFIX = {
    "RETRIEVAL_DOCUMENT": "search_document: ",
    "RETRIEVAL_QUERY": "search_query: ",
}


def _http(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=get_settings().ollama_base_url, timeout=timeout)


async def health() -> dict:
    """Returns reachability and the installed model names."""
    try:
        async with _http(5) as http:
            r = await http.get("/api/tags")
            r.raise_for_status()
    except httpx.HTTPError as exc:
        return {"ok": False, "error": str(exc), "models": []}
    return {"ok": True, "models": [m["name"] for m in r.json().get("models", [])]}


async def generate_structured(
    *,
    prompt: str,
    schema: type[T],
    system: str,
    model: str | None = None,
    temperature: float = 0.3,
    timeout_s: float = 90.0,
) -> T:
    """Calls an Ollama model and returns a validated instance of ``schema``.

    Raises:
        ModelError: On connection failure, API error or invalid output.
    """
    s = get_settings()
    model = model or s.ollama_model
    body = {
        "model": model,
        "stream": False,
        "format": schema.model_json_schema(),
        "options": {"temperature": temperature},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    }
    try:
        async with _http(max(timeout_s, s.ollama_timeout_s)) as http:
            r = await http.post("/api/chat", json=body)
            r.raise_for_status()
    except httpx.HTTPError as exc:
        raise ModelError(f"ollama {model} call failed: {exc!r}") from exc
    text = (r.json().get("message") or {}).get("content", "")
    try:
        return schema.model_validate_json(text)
    except ValidationError as exc:
        logger.warning("Ollama output failed validation: %s", exc.errors()[:3])
        raise ModelError(
            f"ollama {model} output did not match {schema.__name__}: {exc}"
        ) from exc


async def embed(text: str, *, task_type: str = "RETRIEVAL_DOCUMENT") -> list[float]:
    """Embeds text with Ollama (default ``nomic-embed-text``)."""
    s = get_settings()
    body = {
        "model": s.ollama_embed_model,
        "input": _PREFIX.get(task_type, "") + text,
    }
    try:
        async with _http(60) as http:
            r = await http.post("/api/embed", json=body)
            r.raise_for_status()
    except httpx.HTTPError as exc:
        raise ModelError(f"ollama embedding failed: {exc!r}") from exc
    vectors = r.json().get("embeddings") or []
    if not vectors or len(vectors[0]) != s.embedding_dim:
        raise ModelError(
            f"ollama {s.ollama_embed_model} returned a vector that is not "
            f"{s.embedding_dim}-dimensional"
        )
    return list(vectors[0])
