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

"""Context compression for every model call, built on Headroom (``headroom-ai``).

One choke point: the provider dispatch in ``app.ai.llm``, the ADK agents'
``before_model_callback`` and the free-text endpoints all call this module, so
no prompt reaches Gemini or Ollama uncompressed.

Modes (``HEADROOM_MODE``):

``lossless`` (default)
    ``headroom.compress(mode="agent")``: Headroom's live-agent regime. Only
    deterministic densification runs, and Headroom round-trips every changed
    message and reverts any it cannot prove lossless. Safe for code the Coder
    must edit byte-for-byte, and prompt-cache stable across agent turns.
``aggressive``
    Headroom's content router with lossy compressors enabled (log, search,
    and optionally Kompress) but **CCR disabled**.

Tenant safety: Headroom's CCR ("compress, cache, retrieve") parks originals in
a process-wide store that the model fetches by hash. Karkhana never enables
it: (1) the store is global, so a marker could retrieve another workspace's
data, and (2) our providers expose no retrieval tool, so a marker would be an
unrecoverable hole. As defence in depth each call runs against a throwaway,
per-call store (``set_request_compression_store``) that is dropped afterwards,
and any message that still carries a CCR or dropped-rows marker is reverted to
its original. Headroom's in-process result cache is keyed by a content hash,
so a hit needs the original text, and returns nothing a caller did not send.

If ``headroom`` is not importable, disabled, or raises, every function here is
the identity, so a compression problem can never fail a model call.
"""

from __future__ import annotations

import contextlib
import contextvars
import copy
import json
import logging
import os
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

# Headroom counts tokens with this when it does not know the model name; it
# falls back to a character estimate offline, which is fine for accounting.
_COUNT_MODEL = "gemini-3-flash-preview"


@dataclass
class CompressionStats:
    """Token accounting for one compression call."""

    kind: str
    mode: str
    tokens_before: int = 0
    tokens_after: int = 0
    applied: bool = False  # False: disabled, too small, unavailable or failed.
    transforms: list[str] = field(default_factory=list)

    @property
    def tokens_saved(self) -> int:
        """Tokens removed by compression (never negative)."""
        return max(0, self.tokens_before - self.tokens_after)

    def as_dict(self) -> dict[str, Any]:
        """JSON-safe view for logs and reports."""
        return {
            "kind": self.kind,
            "mode": self.mode,
            "tokens_before": self.tokens_before,
            "tokens_after": self.tokens_after,
            "tokens_saved": self.tokens_saved,
            "applied": self.applied,
        }


@dataclass
class CompressionTotals:
    """Running totals for one unit of work (an agent run, a request)."""

    calls: int = 0
    tokens_before: int = 0
    tokens_after: int = 0
    by_kind: dict[str, dict[str, int]] = field(default_factory=dict)

    def add(self, s: CompressionStats) -> None:
        """Adds one call's stats."""
        self.calls += 1
        self.tokens_before += s.tokens_before
        self.tokens_after += s.tokens_after
        k = self.by_kind.setdefault(
            s.kind, {"calls": 0, "tokens_before": 0, "tokens_after": 0}
        )
        k["calls"] += 1
        k["tokens_before"] += s.tokens_before
        k["tokens_after"] += s.tokens_after

    def as_dict(self) -> dict[str, Any]:
        """JSON-safe totals for the run report."""
        saved = max(0, self.tokens_before - self.tokens_after)
        return {
            "engine": "headroom",
            "mode": get_settings().headroom_mode,
            "calls": self.calls,
            "tokens_before": self.tokens_before,
            "tokens_after": self.tokens_after,
            "tokens_saved": saved,
            "ratio_saved": round(saved / self.tokens_before, 4)
            if self.tokens_before
            else 0.0,
            "by_kind": self.by_kind,
        }


_totals: contextvars.ContextVar[CompressionTotals | None] = contextvars.ContextVar(
    "karkhana_compression_totals", default=None
)


@contextlib.contextmanager
def track() -> Iterator[CompressionTotals]:
    """Collects the stats of every compression inside the block (async-safe)."""
    totals = CompressionTotals()
    token = _totals.set(totals)
    try:
        yield totals
    finally:
        _totals.reset(token)


# ---------------------------------------------------------------------------
# Headroom loading
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_loaded: Any = None  # module namespace, or False when unavailable
_aggressive_pipeline: Any = None


def _headroom() -> Any:
    """Imports Headroom once; returns None when it is unavailable."""
    global _loaded
    if _loaded is None:
        with _lock:
            if _loaded is None:
                if get_settings().headroom_offline:
                    # No telemetry beacon, update check or model download:
                    # tenant prompts never trigger third-party egress.
                    os.environ.setdefault("HEADROOM_OFFLINE", "1")
                    os.environ.setdefault("HEADROOM_TELEMETRY", "off")
                    os.environ.setdefault("HEADROOM_BEACON", "off")
                try:
                    import headroom  # noqa: F401
                    from headroom import compress as hr_compress
                    from headroom.cache.compression_store import (
                        CompressionStore,
                        clear_request_compression_store,
                        set_request_compression_store,
                    )
                    from headroom.transforms.compaction_codec import (
                        contains_removal_marker,
                    )

                    _loaded = {
                        "compress": hr_compress,
                        "Store": CompressionStore,
                        "set_store": set_request_compression_store,
                        "clear_store": clear_request_compression_store,
                        "has_marker": contains_removal_marker,
                    }
                except Exception as exc:  # ImportError or a broken install
                    logger.warning(
                        "Headroom unavailable, sending context uncompressed: %s", exc
                    )
                    _loaded = False
    return _loaded or None


def available() -> bool:
    """True when Headroom is installed and importable."""
    return _headroom() is not None


def _aggressive() -> Any:
    """Content router with lossy compressors on and CCR off (built once)."""
    global _aggressive_pipeline
    if _aggressive_pipeline is None:
        with _lock:
            if _aggressive_pipeline is None:
                from headroom.transforms import TransformPipeline
                from headroom.transforms.content_router import (
                    ContentRouter,
                    ContentRouterConfig,
                )

                router = ContentRouter(
                    ContentRouterConfig(
                        ccr_enabled=False,
                        ccr_inject_marker=False,
                        enable_kompress=get_settings().headroom_kompress,
                        # Relevance scoring pre-warms an embedding model in the
                        # background; keep the request path deterministic.
                        relevance_split=False,
                    )
                )
                _aggressive_pipeline = TransformPipeline(transforms=[router])
    return _aggressive_pipeline


def estimate_tokens(text: str) -> int:
    """Cheap token estimate (about four characters per token)."""
    return (len(text) + 3) // 4


def _size(messages: list[dict[str, Any]]) -> int:
    return sum(len(m["content"]) for m in messages if isinstance(m.get("content"), str))


def _record(stats: CompressionStats) -> CompressionStats:
    totals = _totals.get()
    if totals is not None:
        totals.add(stats)
    if stats.applied:
        logger.info(
            "context_compression kind=%s mode=%s tokens_before=%d tokens_after=%d saved=%d",
            stats.kind,
            stats.mode,
            stats.tokens_before,
            stats.tokens_after,
            stats.tokens_saved,
            extra={"compression": stats.as_dict()},
        )
    return stats


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compress_messages(
    messages: list[dict[str, Any]],
    *,
    kind: str,
    model: str | None = None,
    lossless: bool | None = None,
) -> tuple[list[dict[str, Any]], CompressionStats]:
    """Compresses OpenAI-style ``{"role", "content"}`` messages.

    Args:
        messages: Messages whose string ``content`` may be compressed. Roles:
            ``system``, ``user``, ``assistant`` or ``tool``.
        kind: A label for metrics (``evaluation``, ``coder_tool``, ``rag``...).
        model: Model name, used only for token counting.
        lossless: Force the lossless regime regardless of ``HEADROOM_MODE``
            (the Coder's tool outputs must stay byte-exact).

    Returns:
        The messages to send (the input list when nothing changed) and stats.
    """
    s = get_settings()
    mode = "lossless" if lossless or s.headroom_mode == "lossless" else "aggressive"
    size = _size(messages)
    stats = CompressionStats(
        kind=kind,
        mode=mode,
        tokens_before=(size + 3) // 4,
        tokens_after=(size + 3) // 4,
    )
    if not s.headroom_enabled or not messages or size < s.headroom_min_chars:
        return messages, _record(stats)
    hr = _headroom()
    if hr is None:
        return messages, _record(stats)

    original = copy.deepcopy(messages)
    store = hr["Store"](max_entries=1, enable_feedback=False)
    hr["set_store"](store)  # per-call sink: nothing reaches the global store
    try:
        count_model = model or _COUNT_MODEL
        common: dict[str, Any] = {
            "compress_user_messages": True,
            "compress_system_messages": False,
            "protect_recent": 0,
            "min_tokens_to_compress": 250,
            "kompress_model": "disabled",
        }
        res = hr["compress"](
            copy.deepcopy(messages), model=count_model, model_limit=1_000_000,
            mode="agent", **common,
        )  # fmt: skip
        out, before, after, transforms = (
            res.messages,
            res.tokens_before,
            res.tokens_after,
            res.transforms_applied,
        )
        if mode == "aggressive":
            # Lossy compressors win on logs and diffs, lossless densification
            # wins on JSON; keep whichever result is smaller.
            if s.headroom_kompress:
                common.pop("kompress_model")
            lossy = _aggressive().apply(
                messages=copy.deepcopy(messages), model=count_model,
                model_limit=1_000_000, context="", **common,
            )  # fmt: skip
            lossy_out = _revert_unsafe(original, lossy.messages, hr["has_marker"])
            if lossy_out != original and lossy.tokens_after < after:
                out, before, after, transforms = (
                    lossy_out, lossy.tokens_before, lossy.tokens_after,
                    lossy.transforms_applied,
                )  # fmt: skip
        out = _revert_unsafe(original, out, hr["has_marker"])
    except Exception as exc:
        logger.warning(
            "Headroom compression failed for %s, sending original: %s", kind, exc
        )
        return messages, _record(stats)
    finally:
        hr["clear_store"]()
        with contextlib.suppress(Exception):
            store.clear()

    if not before or after >= before or out == original:
        stats.tokens_before = stats.tokens_after = before or stats.tokens_before
        return messages, _record(stats)
    stats.tokens_before, stats.tokens_after = before, after
    stats.applied, stats.transforms = True, list(transforms or [])
    return out, _record(stats)


def _revert_unsafe(
    original: list[dict[str, Any]], out: list[dict[str, Any]], has_marker: Any
) -> list[dict[str, Any]]:
    """Reverts messages that changed shape or carry a CCR / dropped-rows marker."""
    if len(out) != len(original):
        return original
    fixed = []
    for orig, new in zip(original, out, strict=True):
        content = new.get("content")
        if not isinstance(content, str) or new.get("role") != orig.get("role"):
            fixed.append(orig)
        elif content != orig.get("content") and has_marker(content):
            fixed.append(orig)
        else:
            fixed.append({**orig, "content": content})
    return fixed


def compress_text(
    text: str,
    *,
    kind: str,
    role: str = "user",
    model: str | None = None,
    lossless: bool | None = None,
) -> tuple[str, CompressionStats]:
    """Compresses one block of text sent as a single message."""
    out, stats = compress_messages(
        [{"role": role, "content": text}], kind=kind, model=model, lossless=lossless
    )
    return out[0]["content"], stats


def compress_prompt(
    prompt: str, *, kind: str, model: str | None = None
) -> tuple[str, CompressionStats]:
    """Compresses a user prompt. System instructions are never compressed."""
    return compress_text(prompt, kind=kind, model=model)


# ---------------------------------------------------------------------------
# google-genai / ADK structures
# ---------------------------------------------------------------------------


def compress_genai_contents(
    contents: list[Any],
    *,
    kind: str,
    model: str | None = None,
    lossless: bool | None = True,
) -> tuple[list[Any], CompressionStats]:
    """Compresses ``google.genai.types.Content`` lists (ADK ``LlmRequest.contents``).

    Text parts become user/assistant messages; each string or JSON value in a
    function response becomes a ``tool`` message. Only changed parts are
    replaced, on deep copies, so the ADK session history is never mutated.
    Function calls, thoughts and binary parts pass through untouched.
    """
    slots: list[
        tuple[int, int, str | None]
    ] = []  # (content idx, part idx, response key)
    messages: list[dict[str, Any]] = []
    for ci, content in enumerate(contents or []):
        role = "assistant" if getattr(content, "role", "user") == "model" else "user"
        for pi, part in enumerate(getattr(content, "parts", None) or []):
            if getattr(part, "text", None) and not getattr(part, "thought", False):
                slots.append((ci, pi, None))
                messages.append({"role": role, "content": part.text})
                continue
            fr = getattr(part, "function_response", None)
            if fr is not None and isinstance(fr.response, dict):
                for key, value in fr.response.items():
                    if isinstance(value, str):
                        text = value
                    elif isinstance(value, list | dict):
                        text = json.dumps(value, ensure_ascii=False)
                    else:
                        continue
                    slots.append((ci, pi, key))
                    messages.append({"role": "tool", "content": text})
    if not messages:
        return contents, _record(CompressionStats(kind=kind, mode="lossless"))
    out, stats = compress_messages(messages, kind=kind, model=model, lossless=lossless)
    if not stats.applied:
        return contents, stats

    new_contents = list(contents)
    copied: set[int] = set()
    for (ci, pi, key), orig, new in zip(slots, messages, out, strict=True):
        if new["content"] == orig["content"]:
            continue
        if ci not in copied:
            new_contents[ci] = new_contents[ci].model_copy(deep=True)
            copied.add(ci)
        part = new_contents[ci].parts[pi]
        if key is None:
            part.text = new["content"]
        else:
            part.function_response.response[key] = new["content"]
    return new_contents, stats


def adk_before_model_callback(*, kind: str, lossless: bool | None = True):
    """Builds an ADK ``before_model_callback`` that compresses the request in place.

    Returns ``None`` so ADK always proceeds with the (compressed) request.
    """

    async def _callback(callback_context: Any, llm_request: Any) -> None:
        import asyncio

        try:
            contents, _ = await asyncio.to_thread(
                compress_genai_contents,
                llm_request.contents,
                kind=kind,
                model=getattr(llm_request, "model", None),
                lossless=lossless,
            )
            llm_request.contents = contents
        except Exception as exc:  # never break the agent loop
            logger.warning("ADK context compression skipped: %s", exc)
        return None

    return _callback


async def acompress_prompt(
    prompt: str, *, kind: str, model: str | None = None
) -> tuple[str, CompressionStats]:
    """``compress_prompt`` off the event loop (Headroom is CPU-bound)."""
    if len(prompt) < get_settings().headroom_min_chars:
        return compress_prompt(prompt, kind=kind, model=model)
    import asyncio

    return await asyncio.to_thread(compress_prompt, prompt, kind=kind, model=model)


async def acompress_messages(
    messages: list[dict[str, Any]], *, kind: str, model: str | None = None
) -> tuple[list[dict[str, Any]], CompressionStats]:
    """``compress_messages`` off the event loop."""
    if _size(messages) < get_settings().headroom_min_chars:
        return compress_messages(messages, kind=kind, model=model)
    import asyncio

    return await asyncio.to_thread(compress_messages, messages, kind=kind, model=model)
