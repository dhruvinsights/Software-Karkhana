# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Google Stitch: the MCP client, asset downloads, previews and the designer-only rule."""

from __future__ import annotations

import json

import httpx
import pytest

from app.integrations import stitch
from app.services import stitch_design

KEY = "AIza-test-key-123"
ENDPOINT = "https://stitch.googleapis.com/mcp"

SCREEN = {
    "name": "projects/42/screens/abc123",
    "title": "Checkout",
    "deviceType": "DESKTOP",
    "width": "1280",
    "height": 1024,
    "htmlCode": {
        "downloadUrl": "https://contribution.usercontent.google.com/download?x=1"
    },
    "screenshot": {"downloadUrl": "https://lh3.googleusercontent.com/abc"},
}


# --------------------------------------------------------------------------
# Access
# --------------------------------------------------------------------------


def test_only_design_station_members_may_use_stitch():
    assert stitch_design.decide(member_stations=["design"]) == (True, "")
    assert stitch_design.decide(member_stations=["developer", "design"])[0]
    ok, why = stitch_design.decide(member_stations=["developer", "qa"])
    assert not ok and "designers only" in why
    # Not on the team at all (e.g. a manager of an open project): still no.
    assert not stitch_design.decide(member_stations=None)[0]
    assert not stitch_design.decide(member_stations=[])[0]
    assert not stitch_design.decide(member_stations=["design"], archived=True)[0]


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------


def test_parse_generation_reads_screens_text_and_suggestions():
    raw = {
        "outputComponents": [
            {"text": "Here is your checkout."},
            {"design": {"screens": [SCREEN, {"title": "no id"}]}},
            {"suggestions": ["Make it dark", {"text": "Add a coupon field"}]},
        ]
    }
    out = stitch.parse_generation(raw)
    assert [s.screen_id for s in out.screens] == ["abc123"]
    s = out.screens[0]
    assert (s.title, s.device_type, s.width, s.height) == (
        "Checkout",
        "DESKTOP",
        1280,
        1024,
    )
    assert s.html_url.startswith(
        "https://contribution."
    ) and s.screenshot_url.startswith("https://lh3.")
    assert out.messages == ["Here is your checkout."]
    assert out.suggestions == ["Make it dark", "Add a coupon field"]
    assert stitch.parse_generation("nonsense").screens == []


def test_resource_ids():
    assert stitch.resource_id("projects/42", "projects") == "42"
    assert stitch.resource_id("projects/42/screens/ab", "screens") == "ab"
    assert stitch.resource_id("projects/42", "screens") is None
    assert stitch.resource_id(None, "projects") is None


def test_sse_parser_finds_the_matching_response():
    body = (
        "event: message\n"
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n'
        "event: message\n"
        'data: {"jsonrpc":"2.0","id":7,\n'
        'data: "result":{"ok":true}}\n\n'
    )
    assert stitch._parse_sse(body, 7) == {
        "jsonrpc": "2.0",
        "id": 7,
        "result": {"ok": True},
    }
    assert stitch._parse_sse(body, 8) is None


# --------------------------------------------------------------------------
# The MCP client
# --------------------------------------------------------------------------


class FakeMcp:
    """A Streamable-HTTP MCP server double that records what it was sent."""

    def __init__(
        self,
        tool_reply,
        *,
        sse: bool = False,
        http_status: int = 200,
        fail_calls: int = 0,
    ):
        self.tool_reply = tool_reply
        self.sse = sse
        self.http_status = http_status
        self.fail_calls = fail_calls
        self.requests: list[httpx.Request] = []
        self.tool_calls: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "DELETE":
            return httpx.Response(204)
        msg = json.loads(request.content)
        method = msg.get("method")
        if method == "initialize":
            return httpx.Response(
                200,
                headers={"Mcp-Session-Id": "sess-1"},
                json={
                    "jsonrpc": "2.0",
                    "id": msg["id"],
                    "result": {"protocolVersion": stitch.PROTOCOL_VERSION},
                },
            )
        if method == "notifications/initialized":
            return httpx.Response(202)
        assert method == "tools/call"
        assert request.headers.get("mcp-session-id") == "sess-1"
        self.tool_calls.append(msg["params"])
        if self.fail_calls:
            self.fail_calls -= 1
            raise httpx.ConnectError("boom", request=request)
        if self.http_status != 200:
            return httpx.Response(self.http_status, text=f"denied for key {KEY}")
        reply = {"jsonrpc": "2.0", "id": msg["id"], "result": self.tool_reply}
        if self.sse:
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text=f"event: message\ndata: {json.dumps(reply)}\n\n",
            )
        return httpx.Response(200, json=reply)


def _client(fake: FakeMcp) -> stitch.StitchClient:
    return stitch.StitchClient(
        api_key=KEY,
        endpoint=ENDPOINT,
        timeout_s=30,
        transport=httpx.MockTransport(fake),
    )


async def test_generate_over_mcp_sends_key_and_typed_arguments():
    fake = FakeMcp(
        {
            "structuredContent": {
                "outputComponents": [{"design": {"screens": [SCREEN]}}]
            }
        },
        sse=True,
    )
    out = await _client(fake).generate(
        "42", "A checkout page", "DESKTOP", "GEMINI_3_FLASH"
    )
    assert out.screens[0].screen_id == "abc123"
    assert fake.tool_calls == [
        {
            "name": "generate_screen_from_text",
            "arguments": {
                "projectId": "42",
                "prompt": "A checkout page",
                "deviceType": "DESKTOP",
                "modelId": "GEMINI_3_FLASH",
            },
        }
    ]
    assert all(
        r.headers.get("x-goog-api-key") == KEY
        for r in fake.requests
        if r.method == "POST"
    )


async def test_none_arguments_are_dropped_and_text_json_is_parsed():
    fake = FakeMcp(
        {"content": [{"type": "text", "text": json.dumps({"name": "projects/987"})}]}
    )
    assert await _client(fake).create_project("Demo") == "987"
    assert fake.tool_calls[0]["arguments"] == {"title": "Demo"}


async def test_tool_errors_are_classified_and_never_leak_the_key():
    fake = FakeMcp(
        {
            "isError": True,
            "content": [{"type": "text", "text": "Quota exceeded: rate limit"}],
        }
    )
    with pytest.raises(stitch.StitchError) as err:
        await _client(fake).list_screens("42")
    assert err.value.code == "RATE_LIMITED"

    fake = FakeMcp({}, http_status=401)
    with pytest.raises(stitch.StitchError) as err:
        await _client(fake).list_screens("42")
    assert err.value.code == "AUTH_FAILED"
    assert KEY not in err.value.message


async def test_generation_is_never_retried_but_reads_are():
    fake = FakeMcp({"structuredContent": {}}, fail_calls=1)
    with pytest.raises(stitch.StitchError) as err:
        await _client(fake).generate("42", "x", None, None)
    assert err.value.code == "NETWORK_ERROR" and err.value.recoverable
    assert len(fake.tool_calls) == 1

    fake = FakeMcp({"structuredContent": {"screens": [SCREEN]}}, fail_calls=1)
    screens = await _client(fake).list_screens("42")
    assert [s.screen_id for s in screens] == ["abc123"] and len(fake.tool_calls) == 2


def test_missing_key_is_not_configured():
    with pytest.raises(stitch.StitchError) as err:
        stitch.StitchClient(api_key="", endpoint=ENDPOINT, timeout_s=1)
    assert err.value.code == "NOT_CONFIGURED"


# --------------------------------------------------------------------------
# Downloads
# --------------------------------------------------------------------------

HOSTS = ["googleusercontent.com", "usercontent.google.com"]


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://lh3.googleusercontent.com/a", True),
        ("https://contribution.usercontent.google.com/x", True),
        ("http://lh3.googleusercontent.com/a", False),
        ("https://evilgoogleusercontent.com/a", False),
        ("https://googleusercontent.com.evil.io/a", False),
        ("https://169.254.169.254/latest", False),
        ("https://[::1]/x", False),
        ("https://lh3.googleusercontent.com:8443/a", False),
        ("https://user:pw@lh3.googleusercontent.com/a", False),
        ("file:///etc/passwd", False),
    ],
)
def test_asset_host_allowlist(url, ok):
    assert stitch.host_allowed(url, HOSTS) is ok


async def test_download_never_sends_the_key_and_revalidates_redirects():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if (
            request.url.host == "lh3.googleusercontent.com"
            and request.url.path == "/hop"
        ):
            return httpx.Response(
                302, headers={"location": "https://lh4.googleusercontent.com/final"}
            )
        if request.url.path == "/evil":
            return httpx.Response(
                302, headers={"location": "http://169.254.169.254/computeMetadata"}
            )
        return httpx.Response(
            200, headers={"content-type": "image/png"}, content=b"\x89PNG\r\n\x1a\nabc"
        )

    body, ctype = await stitch.download(
        "https://lh3.googleusercontent.com/hop",
        allowed_suffixes=HOSTS,
        max_bytes=100,
        transport=httpx.MockTransport(handler),
    )
    assert body.startswith(b"\x89PNG") and ctype == "image/png"
    assert all("x-goog-api-key" not in r.headers for r in seen)

    with pytest.raises(stitch.StitchError) as err:
        await stitch.download(
            "https://lh3.googleusercontent.com/evil",
            allowed_suffixes=HOSTS,
            max_bytes=100,
            transport=httpx.MockTransport(handler),
        )
    assert err.value.code == "VALIDATION_ERROR"


async def test_download_enforces_the_size_cap():
    def handler(request):
        return httpx.Response(200, content=b"x" * 500)

    with pytest.raises(stitch.StitchError) as err:
        await stitch.download(
            "https://lh3.googleusercontent.com/a",
            allowed_suffixes=HOSTS,
            max_bytes=100,
            transport=httpx.MockTransport(handler),
        )
    assert "larger" in err.value.message


def test_image_type_uses_magic_bytes():
    assert stitch_design.image_type(b"\x89PNG\r\n\x1a\n...") == "image/png"
    assert stitch_design.image_type(b"\xff\xd8\xff\xe0...") == "image/jpeg"
    assert stitch_design.image_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert stitch_design.image_type(b"<svg onload=alert(1)>") is None


# --------------------------------------------------------------------------
# Preview sandboxing
# --------------------------------------------------------------------------


def test_preview_injects_csp_first_and_strips_base_and_refresh():
    raw = (
        '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script>'
        '<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example">'
        "</head><body><h1>Hi</h1></body></html>"
    )
    out = stitch_design.preview_document(raw)
    head = out.index("<head>") + len("<head>")
    assert out[head:].startswith('<meta http-equiv="Content-Security-Policy"')
    assert out.index("Content-Security-Policy") < out.index("cdn.tailwindcss.com")
    assert "<base" not in out and "refresh" not in out
    assert (
        "connect-src &#x27;none&#x27;" in out and "form-action &#x27;none&#x27;" in out
    )


def test_preview_wraps_fragments():
    out = stitch_design.preview_document("<div>fragment</div>")
    assert out.startswith(
        '<!doctype html><html><head><meta http-equiv="Content-Security-Policy"'
    )
    assert "<div>fragment</div>" in out


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------


def test_stitch_url_must_be_https_outside_local_dev(monkeypatch):
    from app.config import Settings

    assert Settings(
        auth_mode="dev", stitch_mcp_url="http://localhost:9000/mcp"
    ).stitch_mcp_url
    with pytest.raises(ValueError, match="STITCH_MCP_URL"):
        Settings(auth_mode="dev", stitch_mcp_url="http://stitch.example/mcp")
    s = Settings(auth_mode="dev", stitch_enabled=True, stitch_api_key=None)
    assert not s.stitch_configured
    assert Settings(
        auth_mode="dev", stitch_enabled=True, stitch_api_key="k"
    ).stitch_configured
    assert "googleusercontent.com" in Settings(auth_mode="dev").stitch_asset_host_list
