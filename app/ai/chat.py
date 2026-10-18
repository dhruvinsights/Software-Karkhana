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

"""Streaming chat across providers: Ollama, Gemini, Claude and IBM Bob.

Every provider yields the same events, so the UI and the agents never care
which one ran:

    {"type": "thinking", "delta": "..."}   reasoning, when the model exposes it
    {"type": "text", "delta": "..."}       the answer, streamed
    {"type": "status", "text": "..."}      progress from tool-using agents (Bob)

``complete()`` collects a stream into a single string for the scan agents.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal

import httpx

from app.ai.errors import ModelError
from app.ai.providers import bob
from app.config import get_settings

logger = logging.getLogger(__name__)

Provider = Literal["ollama", "gemini", "claude", "bob"]
PROVIDERS: tuple[Provider, ...] = ("ollama", "gemini", "claude", "bob")
Event = dict[str, str]
Message = dict[str, str]  # {"role": "user" | "assistant", "content": str}


@dataclass
class ProviderInfo:
    """One chat provider and whether it can run right now (for the picker)."""

    id: Provider
    label: str
    available: bool
    detail: str
    models: list[str] = field(default_factory=list)
    default_model: str = ""


# ── Provider availability ─────────────────────────────────────────────────────


async def _ollama_models() -> list[str]:
    s = get_settings()
    try:
        async with httpx.AsyncClient(base_url=s.ollama_base_url, timeout=3) as http:
            r = await http.get("/api/tags")
            r.raise_for_status()
    except httpx.HTTPError:
        return []
    names = [m["name"] for m in r.json().get("models", [])]
    # Embedding and vision-only models can't chat.
    return [n for n in names if "embed" not in n and not n.startswith("llava")]


def _claude_key() -> str | None:
    return get_settings().anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")


async def list_providers() -> list[ProviderInfo]:
    """What can run right now, for the provider picker."""
    from app.ai.providers import gemini as gemini_provider

    s = get_settings()
    ollama_models = await _ollama_models()
    ollama_default = (
        s.ollama_chat_model
        if s.ollama_chat_model in ollama_models
        else (ollama_models[0] if ollama_models else "")
    )
    vertex = gemini_provider.backend() == "vertex"
    gemini_via = f"Vertex AI, {s.google_cloud_project}" if vertex else "AI Studio key"
    return [
        ProviderInfo(
            "ollama",
            "Ollama (local)",
            bool(ollama_models),
            f"{len(ollama_models)} local models"
            if ollama_models
            else f"Not reachable at {s.ollama_base_url}",
            ollama_models,
            ollama_default,
        ),
        ProviderInfo(
            "gemini",
            "Gemini (Vertex AI)" if vertex else "Gemini",
            gemini_provider.configured(),
            f"Ready ({gemini_via})"
            if gemini_provider.configured()
            else gemini_provider.NOT_CONFIGURED,
            list(
                dict.fromkeys(
                    [s.gemini_model, s.gemini_pro_model, s.gemini_coder_model]
                )
            ),
            s.gemini_model,
        ),
        ProviderInfo(
            "claude",
            "Claude",
            bool(_claude_key()),
            "Ready" if _claude_key() else "Set ANTHROPIC_API_KEY in .env",
            [s.claude_model, "claude-sonnet-5-5", "claude-haiku-5-5"],
            s.claude_model,
        ),
        ProviderInfo(
            "bob",
            "IBM Bob",
            bob.configured(),
            "Ready"
            if bob.configured()
            else (
                "Set BOB_API_KEY in .env" if bob.binary() else "Install the `bob` CLI"
            ),
            ["bob"],
            "bob",
        ),
    ]


# ── Streaming ─────────────────────────────────────────────────────────────────


async def stream(
    provider: Provider,
    messages: list[Message],
    *,
    system: str,
    model: str | None = None,
    workspace_dir: str | None = None,
) -> AsyncIterator[Event]:
    """Streams one assistant turn. Raises ModelError when the provider fails."""
    if provider == "ollama":
        gen = _stream_ollama(messages, system, model)
    elif provider == "gemini":
        gen = _stream_gemini(messages, system, model)
    elif provider == "claude":
        gen = _stream_claude(messages, system, model)
    elif provider == "bob":
        gen = _stream_bob(messages, system, workspace_dir)
    else:
        raise ModelError(f"Unknown provider {provider!r}")
    async for event in gen:
        yield event


async def complete(
    provider: Provider,
    messages: list[Message],
    *,
    system: str,
    model: str | None = None,
) -> str:
    """The full answer text (thinking dropped), for agents that post-process it."""
    parts: list[str] = []
    async for event in stream(provider, messages, system=system, model=model):
        if event["type"] == "text":
            parts.append(event["delta"])
    return "".join(parts)


async def _stream_ollama(
    messages: list[Message], system: str, model: str | None
) -> AsyncIterator[Event]:
    s = get_settings()
    models = await _ollama_models()
    model = model or (
        s.ollama_chat_model
        if s.ollama_chat_model in models
        else (models[0] if models else s.ollama_model)
    )
    body = {
        "model": model,
        "stream": True,
        # Thinking-capable models (qwen3, gpt-oss) return reasoning separately.
        "think": True,
        "messages": [{"role": "system", "content": system}, *messages],
    }
    try:
        async with httpx.AsyncClient(
            base_url=s.ollama_base_url, timeout=s.ollama_timeout_s
        ) as http:
            async with http.stream("POST", "/api/chat", json=body) as r:
                if r.status_code == 400:
                    # Models without thinking support reject "think"; retry without it.
                    body.pop("think")
                    async with http.stream("POST", "/api/chat", json=body) as r2:
                        r2.raise_for_status()
                        async for event in _ollama_lines(r2):
                            yield event
                    return
                r.raise_for_status()
                async for event in _ollama_lines(r):
                    yield event
    except httpx.HTTPError as exc:
        raise ModelError(f"ollama {model} call failed: {exc!r}") from exc


async def _ollama_lines(r: httpx.Response) -> AsyncIterator[Event]:
    async for line in r.aiter_lines():
        if not line.strip():
            continue
        chunk = json.loads(line)
        if chunk.get("error"):
            raise ModelError(f"ollama: {chunk['error']}")
        msg = chunk.get("message") or {}
        if msg.get("thinking"):
            yield {"type": "thinking", "delta": msg["thinking"]}
        if msg.get("content"):
            yield {"type": "text", "delta": msg["content"]}


async def _stream_gemini(
    messages: list[Message], system: str, model: str | None
) -> AsyncIterator[Event]:
    from google.genai import types

    from app.ai.providers import gemini as gemini_provider

    if not gemini_provider.configured():
        raise ModelError(f"Gemini is not configured: {gemini_provider.NOT_CONFIGURED}")
    model = model or get_settings().gemini_model
    contents = [
        types.Content(
            role="model" if m["role"] == "assistant" else "user",
            parts=[types.Part(text=m["content"])],
        )
        for m in messages
    ]
    config = types.GenerateContentConfig(
        system_instruction=system,
        thinking_config=types.ThinkingConfig(include_thoughts=True),
    )
    try:
        async for (
            chunk
        ) in await gemini_provider.client().aio.models.generate_content_stream(
            model=model, contents=contents, config=config
        ):
            for cand in chunk.candidates or []:
                for part in (cand.content.parts if cand.content else None) or []:
                    if not part.text:
                        continue
                    yield {
                        "type": "thinking" if part.thought else "text",
                        "delta": part.text,
                    }
    except ModelError:
        raise
    except Exception as exc:  # the SDK raises several error types
        raise ModelError(f"gemini {model} call failed: {exc!r}") from exc


async def _stream_claude(
    messages: list[Message], system: str, model: str | None
) -> AsyncIterator[Event]:
    import anthropic

    key = _claude_key()
    if not key:
        raise ModelError("Claude is not configured: set ANTHROPIC_API_KEY in .env")
    model = model or get_settings().claude_model
    client = anthropic.AsyncAnthropic(api_key=key)
    try:
        # Server-side fallback re-runs a policy decline on Anthropic's recommended
        # model inside the same call instead of returning a refusal.
        async with client.beta.messages.stream(
            model=model,
            max_tokens=64000,
            system=system,
            messages=messages,
            thinking={"type": "adaptive", "display": "summarized"},
            output_config={"effort": "high"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as s:
            async for event in s:
                if event.type == "content_block_delta":
                    if event.delta.type == "thinking_delta":
                        yield {"type": "thinking", "delta": event.delta.thinking}
                    elif event.delta.type == "text_delta":
                        yield {"type": "text", "delta": event.delta.text}
            final = await s.get_final_message()
            if final.stop_reason == "refusal":
                yield {
                    "type": "text",
                    "delta": "\n\n_Claude declined to answer this request._",
                }
    except anthropic.APIConnectionError as exc:
        raise ModelError(f"claude: network error {exc!r}") from exc
    except anthropic.APIStatusError as exc:
        raise ModelError(f"claude {model}: {exc.status_code} {exc.message}") from exc


async def _stream_bob(
    messages: list[Message], system: str, workspace_dir: str | None
) -> AsyncIterator[Event]:
    """IBM Bob as a tool-using agent; it reads ``workspace_dir`` when given."""
    transcript = "\n\n".join(
        f"[{'You' if m['role'] == 'user' else 'Assistant'}]\n{m['content']}"
        for m in messages
    )
    prompt = f"<system>\n{system}\n</system>\n\n{transcript}"
    async for event in bob.stream(prompt, workspace_dir=workspace_dir):
        if event["type"] == "status":
            yield event
        else:
            yield {"type": "text", "delta": event["text"] or "(Bob returned no answer)"}
