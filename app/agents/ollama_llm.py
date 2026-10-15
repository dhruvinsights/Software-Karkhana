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

"""An ADK ``BaseLlm`` backed by a local Ollama server.

ADK ships Gemini, Anthropic and LiteLLM adapters but no Ollama one. This adapter
speaks Ollama's native ``/api/chat`` so the Coder and Reviewer agents run
unchanged on local models: it maps ADK contents (text, function calls and
function responses) to Ollama messages, ADK tool declarations to Ollama tools,
and ``output_schema`` to Ollama's constrained ``format``.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncGenerator
from typing import Any

import httpx
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import BaseModel

from app.config import get_settings


def _lower_types(node: Any) -> Any:
    """Converts genai's upper-case schema types (``STRING``) to JSON Schema."""
    if isinstance(node, dict):
        return {
            k: (v.lower() if k == "type" and isinstance(v, str) else _lower_types(v))
            for k, v in node.items()
        }
    if isinstance(node, list):
        return [_lower_types(v) for v in node]
    return node


def _schema_json(schema: Any) -> dict[str, Any] | None:
    """JSON Schema for a pydantic class, genai ``Schema`` or plain dict."""
    if schema is None:
        return None
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        return schema.model_json_schema()
    if isinstance(schema, BaseModel):
        return _lower_types(schema.model_dump(mode="json", exclude_none=True))
    if isinstance(schema, dict):
        return _lower_types(schema)
    return None


def _tools(config: types.GenerateContentConfig) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for tool in config.tools or []:
        for fn in getattr(tool, "function_declarations", None) or []:
            params = _schema_json(
                getattr(fn, "parameters_json_schema", None) or fn.parameters
            ) or {"type": "object", "properties": {}}
            out.append(
                {
                    "type": "function",
                    "function": {
                        "name": fn.name,
                        "description": fn.description or "",
                        "parameters": params,
                    },
                }
            )
    return out


def _system_text(config: types.GenerateContentConfig) -> str:
    si = config.system_instruction
    if si is None:
        return ""
    if isinstance(si, str):
        return si
    parts = getattr(si, "parts", None) or []
    if parts:
        return "".join(p.text or "" for p in parts)
    return str(si)


def to_messages(llm_request: LlmRequest) -> list[dict[str, Any]]:
    """Maps ADK contents to Ollama chat messages."""
    messages: list[dict[str, Any]] = []
    system = _system_text(llm_request.config)
    if system:
        messages.append({"role": "system", "content": system})
    for content in llm_request.contents:
        parts = content.parts or []
        text = "".join(p.text or "" for p in parts if p.text and not p.thought)
        calls = [p.function_call for p in parts if p.function_call]
        responses = [p.function_response for p in parts if p.function_response]
        if responses:
            for fr in responses:
                messages.append(
                    {
                        "role": "tool",
                        "tool_name": fr.name,
                        "content": json.dumps(fr.response, default=str),
                    }
                )
            if text:
                messages.append({"role": "user", "content": text})
        elif content.role == "model":
            msg: dict[str, Any] = {"role": "assistant", "content": text}
            if calls:
                msg["tool_calls"] = [
                    {"function": {"name": c.name, "arguments": dict(c.args or {})}}
                    for c in calls
                ]
            messages.append(msg)
        else:
            messages.append({"role": "user", "content": text})
    return messages


def to_response(message: dict[str, Any], body: dict[str, Any]) -> LlmResponse:
    """Maps an Ollama reply to an ADK response."""
    parts: list[types.Part] = []
    if message.get("content"):
        parts.append(types.Part(text=message["content"]))
    for call in message.get("tool_calls") or []:
        fn = call.get("function", {})
        args = fn.get("arguments") or {}
        if isinstance(args, str):
            args = json.loads(args or "{}")
        parts.append(
            types.Part(
                function_call=types.FunctionCall(
                    id=f"call_{uuid.uuid4().hex[:12]}", name=fn.get("name"), args=args
                )
            )
        )
    usage = types.GenerateContentResponseUsageMetadata(
        prompt_token_count=body.get("prompt_eval_count", 0),
        candidates_token_count=body.get("eval_count", 0),
        total_token_count=body.get("prompt_eval_count", 0) + body.get("eval_count", 0),
    )
    return LlmResponse(
        content=types.Content(role="model", parts=parts or [types.Part(text="")]),
        usage_metadata=usage,
        partial=False,
    )


class OllamaLlm(BaseLlm):
    """Local Ollama chat model for ADK agents."""

    model: str

    @classmethod
    def supported_models(cls) -> list[str]:
        """Not registered by pattern: build instances explicitly."""
        return []

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        """Runs one model turn (non-streaming)."""
        s = get_settings()
        config = llm_request.config
        body: dict[str, Any] = {
            "model": self.model,
            "stream": False,
            "messages": to_messages(llm_request),
            "options": {"temperature": config.temperature or 0.2},
        }
        if tools := _tools(config):
            body["tools"] = tools
        elif fmt := _schema_json(
            getattr(config, "response_json_schema", None) or config.response_schema
        ):
            body["format"] = fmt
        try:
            async with httpx.AsyncClient(
                base_url=s.ollama_base_url, timeout=s.ollama_timeout_s
            ) as http:
                r = await http.post("/api/chat", json=body)
                r.raise_for_status()
        except httpx.HTTPError as exc:
            yield LlmResponse(error_code="OLLAMA_ERROR", error_message=repr(exc))
            return
        data = r.json()
        yield to_response(data.get("message") or {}, data)
