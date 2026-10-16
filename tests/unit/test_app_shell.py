# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""The web shell: SPA fallback must never mask API errors, and security headers are set."""

import httpx
import pytest

from app.config import get_settings


@pytest.fixture
def app_with_static(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>shell</html>")
    monkeypatch.setenv("STATIC_DIR", str(tmp_path))
    get_settings.cache_clear()
    from app.fast_api_app import create_app

    yield create_app()
    get_settings.cache_clear()


async def _get(app, path, **kw):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        return await c.get(path, **kw)


async def test_unknown_api_route_is_404_not_the_app_shell(app_with_static):
    for path in ("/api/does-not-exist", "/api", "/internal/x"):
        r = await _get(app_with_static, path)
        assert r.status_code == 404, path
        assert "shell" not in r.text


async def test_client_side_routes_still_serve_the_app(app_with_static):
    for path in ("/", "/?invite=inv_abc", "/projects/123"):
        r = await _get(app_with_static, path)
        assert r.status_code == 200 and "shell" in r.text, path


async def test_security_headers_are_present(app_with_static):
    r = await _get(app_with_static, "/")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "strict-origin" in r.headers["referrer-policy"]
    assert "strict-transport-security" not in r.headers  # plain http
    r = await _get(app_with_static, "/", headers={"x-forwarded-proto": "https"})
    assert "max-age" in r.headers["strict-transport-security"]
