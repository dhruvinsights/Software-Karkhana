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

"""IBM Bob through its CLI (``bob run``): text, structured output and agent runs.

Bob's gateway sits behind bot protection, so the official CLI (which signs its
requests) is the only reliable client. Bob is an agent with its own file and
shell tools. For plain generation it runs in an empty scratch directory with a
small turn budget; for coding it runs inside a checkout (``workspace_dir``).

``bob run --format json`` prints one JSON object per line. Progress lines
become status events; the ``result`` line carries the answer and its cost.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.ai.errors import ModelError
from app.config import get_settings

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

# One `bob run` is a Node process plus a remote agent session; cap how many
# this process starts at once so a burst of requests cannot fork-bomb the host.
_SLOTS = asyncio.Semaphore(4)
_PROGRESS_TYPES = ("tool_use", "tool_call", "progress", "assistant")


@dataclass
class BobResult:
    """The final answer of one ``bob run`` and what it cost."""

    text: str
    cost_usd: float


def binary() -> str | None:
    """Path to the ``bob`` CLI, from settings or PATH."""
    s = get_settings()
    if s.bob_bin and os.path.isfile(s.bob_bin):
        return s.bob_bin
    return shutil.which("bob")


def api_key() -> str | None:
    """The Bob API key from settings or the environment."""
    return (
        get_settings().bob_api_key
        or os.environ.get("BOB_API_KEY")
        or os.environ.get("BOBSHELL_API_KEY")
    )


def configured() -> bool:
    """True when the CLI is installed and a key is set."""
    return bool(binary() and api_key())


async def stream(
    prompt: str, *, workspace_dir: str | None = None, max_turns: int = 20
) -> AsyncIterator[dict[str, Any]]:
    """Runs ``bob run`` and yields ``status`` events, then one ``result`` event.

    Raises:
        ModelError: If Bob is not configured, times out or exits without an answer.
    """
    bob, key = binary(), api_key()
    if not bob or not key:
        raise ModelError(
            "IBM Bob is not configured: install the bob CLI and set BOB_API_KEY"
        )
    cmd = [
        bob,
        "run",
        "--format",
        "json",
        "--max-turns",
        str(max_turns),
        "--disable-mcp",
        "--disable-subagents",
        "--trust",
        "--accept-license",
    ]
    if workspace_dir:
        cmd += ["--workspace", workspace_dir]
    env = {**os.environ, "BOB_API_KEY": key, "BOB_LOG_LEVEL": "error"}
    # Bob refuses to start when both key variables are set to different values.
    env.pop("BOBSHELL_API_KEY", None)

    async with _SLOTS:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=workspace_dir,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            limit=16 * 1024 * 1024,  # A result line can hold a long document.
        )
        result: dict[str, Any] | None = None
        try:
            assert proc.stdin is not None and proc.stdout is not None
            # The prompt goes through stdin: Linux caps one argv string at 128 KB,
            # and repository context is often larger.
            proc.stdin.write(prompt.encode())
            await proc.stdin.drain()
            proc.stdin.close()
            async with asyncio.timeout(get_settings().bob_timeout_s):
                async for raw in proc.stdout:
                    try:
                        obj: dict[str, Any] = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if obj.get("type") == "result":
                        result = obj
                    elif obj.get("type") in _PROGRESS_TYPES:
                        note = (
                            obj.get("name")
                            or obj.get("tool")
                            or obj.get("text")
                            or obj["type"]
                        )
                        yield {"type": "status", "text": str(note)[:200]}
                await proc.wait()
        except TimeoutError as exc:
            proc.kill()
            raise ModelError("IBM Bob timed out") from exc
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()

    if result is None or result.get("status") not in (None, "success"):
        err = (await proc.stderr.read()).decode(errors="replace") if proc.stderr else ""
        detail = (result or {}).get("error") or err[-500:]
        raise ModelError(f"bob run failed (exit {proc.returncode}): {detail}")
    cost = float((result.get("stats") or {}).get("session_costs") or 0.0)
    logger.info("bob run finished: $%.4f", cost)
    yield {"type": "result", "text": result.get("last_message", ""), "cost_usd": cost}


async def run(
    prompt: str, *, workspace_dir: str | None = None, max_turns: int = 20
) -> BobResult:
    """Runs Bob to completion and returns its final answer."""
    async for event in stream(prompt, workspace_dir=workspace_dir, max_turns=max_turns):
        if event["type"] == "result":
            return BobResult(event["text"], event["cost_usd"])
    raise ModelError("bob run produced no result")  # stream() always yields one


async def _generate(prompt: str) -> str:
    """One tool-free generation in an empty scratch directory."""
    with tempfile.TemporaryDirectory(prefix="karkhana-bob-") as scratch:
        out = await run(prompt, workspace_dir=scratch, max_turns=3)
    if not out.text.strip():
        raise ModelError("IBM Bob returned an empty answer")
    return out.text


def _prompt(system: str, body: str) -> str:
    return (
        f"<system>\n{system}\n\nAnswer directly from the information given. "
        "Do not use tools, read files or run commands.\n</system>\n\n"
        f"{body}"
    )


async def generate_text(
    *,
    messages: list[dict[str, str]],
    system: str,
    model: str | None = None,
    temperature: float = 0.3,
    timeout_s: float = 60.0,
) -> str:
    """Free text over a short conversation.

    ``model``, ``temperature`` and ``timeout_s`` exist for interface parity:
    Bob picks its own model and its timeout comes from ``BOB_TIMEOUT_S``.
    """
    del model, temperature, timeout_s
    transcript = "\n\n".join(
        f"[{'User' if m['role'] == 'user' else 'Assistant'}]\n{m['content']}"
        for m in messages
    )
    return await _generate(_prompt(system, transcript))


_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def extract_json(text: str) -> str:
    """The JSON object in a model answer: a fenced block, else the outermost braces."""
    fenced = _FENCE.search(text)
    if fenced:
        return fenced.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in the answer")
    return text[start : end + 1]


async def generate_structured(
    *,
    prompt: str,
    schema: type[T],
    system: str,
    model: str | None = None,
    temperature: float = 0.3,
    timeout_s: float = 90.0,
) -> T:
    """Returns a validated ``schema`` instance.

    Bob has no constrained decoding, so the JSON Schema goes in the prompt and
    an invalid answer gets one repair pass.

    Raises:
        ModelError: If the answer is still invalid after the repair pass.
    """
    del model, temperature, timeout_s
    contract = (
        "Return ONLY one JSON object that validates against this JSON Schema. "
        "No prose before or after it.\n"
        f"{json.dumps(schema.model_json_schema())}"
    )
    body = f"{prompt}\n\n{contract}"
    answer = await _generate(_prompt(system, body))
    try:
        return schema.model_validate_json(extract_json(answer))
    except (ValueError, ValidationError) as exc:
        logger.info("Bob %s repair pass: %s", schema.__name__, str(exc)[:300])
        repair = (
            f"{body}\n\nYour previous answer was rejected:\n{str(exc)[:2000]}\n\n"
            f"Previous answer:\n{answer[:20000]}\n\nReturn the corrected JSON object only."
        )
    answer = await _generate(_prompt(system, repair))
    try:
        return schema.model_validate_json(extract_json(answer))
    except (ValueError, ValidationError) as exc:
        raise ModelError(
            f"bob output did not match {schema.__name__} after a repair pass: {exc}"
        ) from exc
