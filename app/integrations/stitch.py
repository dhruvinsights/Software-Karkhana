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

"""Google Stitch client: the remote MCP server at ``stitch.googleapis.com/mcp``.

Stitch generates UI screens (HTML plus a screenshot) from a text prompt. Google
exposes it as a remote MCP server over Streamable HTTP, authenticated with an
API key in ``X-Goog-Api-Key``. The tool names and argument shapes below follow
the official ``@google/stitch-sdk`` (Apache-2.0) tool manifest.

Rules this module keeps:

- The API key only ever goes to the configured MCP endpoint. Generated assets
  are fetched from their signed download URLs *without* it, and only from an
  allowlist of Google content hosts, over HTTPS, with size caps and manual,
  re-validated redirects (no SSRF into the VPC or metadata server).
- Generation is not idempotent and can take minutes; the server says not to
  retry. :meth:`StitchClient.call_tool` never retries a mutating tool. Reads
  are retried once on a transient failure.
- Errors become :class:`StitchError` with a stable ``code`` and a message that
  never contains the key.
"""

from __future__ import annotations

import asyncio
import ipaddress
import itertools
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urljoin, urlsplit

import httpx

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "software-karkhana", "version": "1.0"}

DeviceType = Literal["MOBILE", "DESKTOP", "TABLET", "AGNOSTIC"]
ModelId = Literal["GEMINI_3_FLASH", "GEMINI_3_1_PRO"]
CreativeRange = Literal["REFINE", "EXPLORE", "REIMAGINE"]
Aspect = Literal["LAYOUT", "COLOR_SCHEME", "IMAGES", "TEXT_FONT", "TEXT_CONTENT"]

DEVICE_TYPES: tuple[str, ...] = ("MOBILE", "DESKTOP", "TABLET", "AGNOSTIC")
MODEL_IDS: tuple[str, ...] = ("GEMINI_3_FLASH", "GEMINI_3_1_PRO")

# Tools that create or change designs: never retried (the server may still be
# working on the first call), and they count against the workspace quota.
MUTATING_TOOLS = frozenset(
    {"create_project", "generate_screen_from_text", "edit_screens", "generate_variants"}
)

ErrorCode = Literal[
    "NOT_CONFIGURED",
    "AUTH_FAILED",
    "PERMISSION_DENIED",
    "NOT_FOUND",
    "RATE_LIMITED",
    "NETWORK_ERROR",
    "TIMEOUT",
    "VALIDATION_ERROR",
    "BAD_RESPONSE",
    "UNKNOWN_ERROR",
]


class StitchError(Exception):
    """A Stitch call failed. ``code`` is stable; ``message`` is safe to show."""

    def __init__(
        self, code: ErrorCode, message: str, *, recoverable: bool = False
    ) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message
        # True when the operation may have succeeded server-side anyway
        # (connection dropped mid-generation): reconcile by listing screens.
        self.recoverable = recoverable


def _classify(text: str, status: int | None = None) -> ErrorCode:
    low = text.lower()
    if (
        status == 429
        or "rate limit" in low
        or "resource_exhausted" in low
        or "quota" in low
    ):
        return "RATE_LIMITED"
    if (
        status == 401
        or "unauthenticated" in low
        or "api key not valid" in low
        or "invalid authentication" in low
    ):
        return "AUTH_FAILED"
    if status == 403 or "permission" in low:
        return "PERMISSION_DENIED"
    if status == 404 or "not found" in low:
        return "NOT_FOUND"
    if status == 400 or "invalid argument" in low:
        return "VALIDATION_ERROR"
    return "UNKNOWN_ERROR"


def _scrub(text: str, secret: str | None) -> str:
    text = text[:600]
    return text.replace(secret, "***") if secret else text


# --------------------------------------------------------------------------
# Results
# --------------------------------------------------------------------------


@dataclass
class StitchScreen:
    """A screen as Stitch returns it."""

    screen_id: str
    title: str
    html_url: str | None
    screenshot_url: str | None
    device_type: str | None
    width: int | None = None
    height: int | None = None


@dataclass
class GenerationResult:
    """Screens produced by a generate/edit/variants call, plus any model text."""

    screens: list[StitchScreen] = field(default_factory=list)
    messages: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)


def resource_id(name: str | None, kind: str) -> str | None:
    """``projects/123/screens/abc`` → ``abc`` for kind ``screens``."""
    if not name:
        return None
    marker = f"{kind}/"
    if marker not in name:
        return None
    return name.rsplit(marker, 1)[1].split("/", 1)[0] or None


def _int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def parse_screen(data: dict[str, Any]) -> StitchScreen | None:
    """One Stitch screen object → :class:`StitchScreen` (``None`` if it has no id)."""
    if not isinstance(data, dict):
        return None
    sid = data.get("id") or resource_id(data.get("name"), "screens")
    if not sid:
        return None
    html = data.get("htmlCode") or {}
    shot = data.get("screenshot") or {}
    return StitchScreen(
        screen_id=str(sid),
        title=str(data.get("title") or data.get("displayName") or "Untitled screen")[
            :200
        ],
        html_url=html.get("downloadUrl") if isinstance(html, dict) else None,
        screenshot_url=shot.get("downloadUrl") if isinstance(shot, dict) else None,
        device_type=data.get("deviceType"),
        width=_int(data.get("width")),
        height=_int(data.get("height")),
    )


def parse_generation(raw: Any) -> GenerationResult:
    """The ``outputComponents`` of a generate/edit/variants response."""
    out = GenerationResult()
    if not isinstance(raw, dict):
        return out
    for comp in raw.get("outputComponents") or []:
        if not isinstance(comp, dict):
            continue
        for s in ((comp.get("design") or {}).get("screens")) or []:
            parsed = parse_screen(s)
            if parsed:
                out.screens.append(parsed)
        text = comp.get("text")
        if isinstance(text, str) and text.strip():
            out.messages.append(text.strip()[:2000])
        for sug in comp.get("suggestions") or []:
            label = (
                sug
                if isinstance(sug, str)
                else (sug or {}).get("text")
                if isinstance(sug, dict)
                else None
            )
            if isinstance(label, str) and label.strip():
                out.suggestions.append(label.strip()[:300])
    return out


# --------------------------------------------------------------------------
# MCP over Streamable HTTP
# --------------------------------------------------------------------------


def _parse_sse(body: str, want_id: int) -> dict[str, Any] | None:
    """Finds the JSON-RPC response with ``id == want_id`` in an SSE stream."""
    data_lines: list[str] = []

    def flush() -> dict[str, Any] | None:
        if not data_lines:
            return None
        chunk = "\n".join(data_lines)
        data_lines.clear()
        try:
            msg = json.loads(chunk)
        except json.JSONDecodeError:
            return None
        for m in msg if isinstance(msg, list) else [msg]:
            if (
                isinstance(m, dict)
                and m.get("id") == want_id
                and ("result" in m or "error" in m)
            ):
                return m
        return None

    for line in body.splitlines():
        if line == "":
            found = flush()
            if found:
                return found
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip(" "))
    return flush()


class StitchClient:
    """One MCP session per :meth:`call_tool` (stateless across Cloud Run instances)."""

    def __init__(
        self,
        *,
        api_key: str,
        endpoint: str,
        timeout_s: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise StitchError(
                "NOT_CONFIGURED", "Google Stitch is not configured on this server."
            )
        self._key = api_key
        self._endpoint = endpoint
        self._timeout = timeout_s
        self._transport = transport
        self._ids = itertools.count(1)

    def _headers(self, session_id: str | None) -> dict[str, str]:
        h = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "X-Goog-Api-Key": self._key,
        }
        if session_id:
            h["Mcp-Session-Id"] = session_id
            h["MCP-Protocol-Version"] = PROTOCOL_VERSION
        return h

    async def _rpc(
        self,
        http: httpx.AsyncClient,
        method: str,
        params: dict[str, Any] | None,
        session_id: str | None,
        *,
        notify: bool = False,
    ) -> tuple[dict[str, Any] | None, str | None]:
        msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        rid = None
        if not notify:
            rid = next(self._ids)
            msg["id"] = rid
        try:
            resp = await http.post(
                self._endpoint, headers=self._headers(session_id), json=msg
            )
        except httpx.TimeoutException as exc:
            raise StitchError(
                "TIMEOUT",
                "Google Stitch did not answer in time.",
                recoverable=method == "tools/call",
            ) from exc
        except httpx.HTTPError as exc:
            raise StitchError(
                "NETWORK_ERROR",
                f"Could not reach Google Stitch ({type(exc).__name__}).",
                recoverable=method == "tools/call",
            ) from exc
        new_session = resp.headers.get("mcp-session-id") or session_id
        if notify:
            if resp.status_code >= 400:
                raise StitchError(
                    _classify(resp.text, resp.status_code),
                    f"Stitch rejected {method}: HTTP {resp.status_code}.",
                )
            return None, new_session
        if resp.status_code >= 400:
            detail = _scrub(resp.text, self._key)
            raise StitchError(
                _classify(detail, resp.status_code),
                f"Google Stitch returned HTTP {resp.status_code}: {detail}".strip(),
            )
        ctype = resp.headers.get("content-type", "")
        if "text/event-stream" in ctype:
            found = _parse_sse(resp.text, rid)  # type: ignore[arg-type]
        else:
            try:
                body = resp.json()
            except ValueError:
                body = None
            found = None
            for m in body if isinstance(body, list) else [body]:
                if isinstance(m, dict) and m.get("id") == rid:
                    found = m
        if found is None:
            raise StitchError(
                "BAD_RESPONSE", f"Google Stitch sent no answer to {method}."
            )
        if "error" in found:
            err = found["error"] or {}
            text = _scrub(str(err.get("message") or err), self._key)
            raise StitchError(_classify(text), f"Google Stitch error: {text}")
        return found.get("result") or {}, new_session

    async def _session(self, http: httpx.AsyncClient) -> str | None:
        _, sid = await self._rpc(
            http,
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": CLIENT_INFO,
            },
            None,
        )
        await self._rpc(http, "notifications/initialized", None, sid, notify=True)
        return sid

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(self._timeout, connect=15.0),
            transport=self._transport,
            follow_redirects=False,
        )

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        """Calls one MCP tool and returns its parsed result (structured or JSON text)."""
        args = {k: v for k, v in arguments.items() if v is not None}
        attempts = 1 if name in MUTATING_TOOLS else 2
        for attempt in range(attempts):
            try:
                async with self._http() as http:
                    sid = await self._session(http)
                    result, sid = await self._rpc(
                        http, "tools/call", {"name": name, "arguments": args}, sid
                    )
                    if sid:
                        try:  # Best effort: end the session server-side.
                            await http.delete(
                                self._endpoint, headers=self._headers(sid)
                            )
                        except httpx.HTTPError:
                            pass
                return self._tool_result(name, result or {})
            except StitchError as exc:
                transient = exc.code in ("NETWORK_ERROR", "TIMEOUT", "RATE_LIMITED")
                if attempt + 1 < attempts and transient:
                    await asyncio.sleep(1.5)
                    continue
                if name not in MUTATING_TOOLS:
                    exc.recoverable = False
                raise
        raise StitchError("UNKNOWN_ERROR", "unreachable")  # pragma: no cover

    def _tool_result(self, name: str, result: dict[str, Any]) -> Any:
        texts = [
            c.get("text", "")
            for c in result.get("content") or []
            if isinstance(c, dict) and c.get("type") == "text"
        ]
        if result.get("isError"):
            text = _scrub(" ".join(texts) or "tool error", self._key)
            raise StitchError(_classify(text), f"Stitch {name} failed: {text}")
        if result.get("structuredContent") is not None:
            return result["structuredContent"]
        joined = "".join(texts)
        try:
            return json.loads(joined) if joined else {}
        except json.JSONDecodeError:
            return {"text": joined}

    # -- Typed tools -------------------------------------------------------

    async def create_project(self, title: str) -> str:
        """Creates a Stitch project; returns its numeric id."""
        raw = await self.call_tool("create_project", {"title": title[:120]})
        pid = None
        if isinstance(raw, dict):
            pid = (
                raw.get("projectId")
                or raw.get("id")
                or resource_id(raw.get("name"), "projects")
            )
        if not pid:
            raise StitchError(
                "BAD_RESPONSE", "Stitch created a project but returned no id."
            )
        return str(pid)

    async def generate(
        self,
        project_id: str,
        prompt: str,
        device_type: str | None,
        model_id: str | None,
    ) -> GenerationResult:
        """``generate_screen_from_text``: a new screen from a prompt (slow, never retried)."""
        raw = await self.call_tool(
            "generate_screen_from_text",
            {
                "projectId": project_id,
                "prompt": prompt,
                "deviceType": device_type,
                "modelId": model_id,
            },
        )
        return parse_generation(raw)

    async def edit(
        self,
        project_id: str,
        screen_ids: list[str],
        prompt: str,
        device_type: str | None,
        model_id: str | None,
    ) -> GenerationResult:
        """``edit_screens``: changes existing screens with a prompt."""
        raw = await self.call_tool(
            "edit_screens",
            {
                "projectId": project_id,
                "selectedScreenIds": screen_ids,
                "prompt": prompt,
                "deviceType": device_type,
                "modelId": model_id,
            },
        )
        return parse_generation(raw)

    async def variants(
        self,
        project_id: str,
        screen_ids: list[str],
        prompt: str,
        *,
        count: int,
        creative_range: str,
        aspects: list[str],
        device_type: str | None,
        model_id: str | None,
    ) -> GenerationResult:
        """``generate_variants``: 1 to 5 alternatives of a screen."""
        options: dict[str, Any] = {
            "variantCount": count,
            "creativeRange": creative_range,
        }
        if aspects:
            options["aspects"] = aspects
        raw = await self.call_tool(
            "generate_variants",
            {
                "projectId": project_id,
                "selectedScreenIds": screen_ids,
                "prompt": prompt,
                "variantOptions": options,
                "deviceType": device_type,
                "modelId": model_id,
            },
        )
        return parse_generation(raw)

    async def list_screens(self, project_id: str) -> list[StitchScreen]:
        """``list_screens``: every screen in a Stitch project."""
        raw = await self.call_tool("list_screens", {"projectId": project_id})
        items = (
            raw.get("screens")
            if isinstance(raw, dict)
            else raw
            if isinstance(raw, list)
            else []
        )
        return [s for s in (parse_screen(x) for x in items or []) if s]

    async def get_screen(self, project_id: str, screen_id: str) -> StitchScreen | None:
        """``get_screen``: one screen with fresh download URLs."""
        raw = await self.call_tool(
            "get_screen",
            {
                "name": f"projects/{project_id}/screens/{screen_id}",
                "projectId": project_id,
                "screenId": screen_id,
            },
        )
        return parse_screen(raw) if isinstance(raw, dict) else None


# --------------------------------------------------------------------------
# Asset downloads (no API key, allowlisted hosts only)
# --------------------------------------------------------------------------


def host_allowed(url: str, allowed_suffixes: list[str]) -> bool:
    """HTTPS, a DNS name (not an IP literal), port 443, under an allowed suffix."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
    ):
        return False
    if parts.port not in (None, 443):
        return False
    host = parts.hostname.lower().rstrip(".")
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return any(
        host == s or host.endswith("." + s)
        for s in (x.lower().lstrip(".") for x in allowed_suffixes if x)
    )


async def download(
    url: str,
    *,
    allowed_suffixes: list[str],
    max_bytes: int,
    timeout_s: float = 60.0,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[bytes, str]:
    """Fetches a generated asset. Returns ``(body, content_type)``."""
    current = url
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(timeout_s, connect=10.0),
        transport=transport,
        follow_redirects=False,
    ) as http:
        for _ in range(4):
            if not host_allowed(current, allowed_suffixes):
                raise StitchError(
                    "VALIDATION_ERROR",
                    "Stitch asset URL is not on an allowed Google host.",
                )
            try:
                async with http.stream("GET", current) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308):
                        loc = resp.headers.get("location")
                        if not loc:
                            raise StitchError(
                                "BAD_RESPONSE", "Stitch asset redirect had no location."
                            )
                        current = urljoin(current, loc)
                        continue
                    if resp.status_code >= 400:
                        raise StitchError(
                            _classify("", resp.status_code),
                            f"Could not download the Stitch asset (HTTP {resp.status_code}).",
                        )
                    declared = _int(resp.headers.get("content-length"))
                    if declared is not None and declared > max_bytes:
                        raise StitchError(
                            "VALIDATION_ERROR", "Stitch asset is larger than allowed."
                        )
                    buf = bytearray()
                    async for chunk in resp.aiter_bytes():
                        buf.extend(chunk)
                        if len(buf) > max_bytes:
                            raise StitchError(
                                "VALIDATION_ERROR",
                                "Stitch asset is larger than allowed.",
                            )
                    return bytes(buf), resp.headers.get("content-type", "").split(";")[
                        0
                    ].strip().lower()
            except httpx.TimeoutException as exc:
                raise StitchError(
                    "TIMEOUT", "Downloading the Stitch asset timed out."
                ) from exc
            except httpx.HTTPError as exc:
                raise StitchError(
                    "NETWORK_ERROR",
                    f"Could not download the Stitch asset ({type(exc).__name__}).",
                ) from exc
    raise StitchError(
        "BAD_RESPONSE", "Too many redirects downloading the Stitch asset."
    )
