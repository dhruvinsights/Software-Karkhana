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

"""Unit tests for enterprise password hashing, JWT creation & auth contracts."""

from app.auth import create_token, decode_token, hash_password, verify_password
from app.process import Role


def test_password_hashing_and_verification():
    raw = "SuperSecretPassword123!"
    hashed = hash_password(raw)
    assert hashed.startswith("pbkdf2_sha256$100000$")
    assert verify_password(raw, hashed) is True
    assert verify_password("WrongPassword!", hashed) is False
    assert verify_password(raw, None) is False


def test_jwt_token_creation_and_decoding():
    payload = {
        "sub": "user-uuid-123",
        "email": "pm@enterprise.internal",
        "role": "product_manager",
    }
    token = create_token(payload, expires_in_seconds=3600)
    assert isinstance(token, str)
    decoded = decode_token(token)
    assert decoded is not None
    assert decoded["sub"] == "user-uuid-123"
    assert decoded["email"] == "pm@enterprise.internal"
    assert decoded["role"] == "product_manager"


def test_factory_roles_supported():
    all_roles = [r.value for r in Role]
    assert "product_manager" in all_roles
    assert "developer" in all_roles
    assert "executive" in all_roles
    assert "qa" in all_roles
    assert "security" in all_roles
    assert "devops" in all_roles
    assert "admin" in all_roles


import pytest
from app.routers.auth import send_otp, verify_otp, SendOTPRequest, VerifyOTPRequest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_send_and_verify_otp_flow(monkeypatch):
    monkeypatch.setenv("DEV_OTP_CODE", "424242")
    monkeypatch.delenv("K_SERVICE", raising=False)
    # Test send OTP
    req = SendOTPRequest(email="test.pilot@enterprise.internal")
    resp = await send_otp(req)
    assert resp["status"] == "ok"
    assert "expires_in" in resp

    # Test verify OTP with private bypass code and cache
    code = "424242"

    # Test verify OTP
    mock_session = AsyncMock()
    mock_session.scalar.return_value = None  # user doesn't exist yet (auto-provision)
    
    verify_req = VerifyOTPRequest(email="test.pilot@enterprise.internal", code=code)
    token_out = await verify_otp(verify_req, mock_session)
    assert token_out.access_token is not None
    assert token_out.user.email == "test.pilot@enterprise.internal"
