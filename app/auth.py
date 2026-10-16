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
"""Authentication with Firebase Auth and server-side authorization.

Identity comes from a verified Firebase ID token. The *role* never comes from
the browser or the token: it is looked up in Cloud SQL on every request. A
signed-in Google account with no row in ``users`` gets 403, so nobody can
grant themselves Director by editing client state.
"""

from __future__ import annotations

import asyncio
import base64
import functools
import hashlib
import hmac
import json
import logging
import os
import time
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import User
from app.process import Role

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Password Hashing (PBKDF2-HMAC-SHA256)
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    """Hashes a password with a random 16-byte salt using PBKDF2-HMAC-SHA256."""
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return f"pbkdf2_sha256$100000${salt.hex()}${key.hex()}"


def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    """Verifies a plain password against its stored hash."""
    if not hashed_password or not hashed_password.startswith("pbkdf2_sha256$"):
        return False
    try:
        _, iterations, salt_hex, key_hex = hashed_password.split("$")
        salt = bytes.fromhex(salt_hex)
        expected_key = bytes.fromhex(key_hex)
        computed_key = hashlib.pbkdf2_hmac(
            "sha256", plain_password.encode("utf-8"), salt, int(iterations)
        )
        return hmac.compare_digest(expected_key, computed_key)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT / Signed Token Generation & Verification
# ---------------------------------------------------------------------------

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (4 - (len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_token(payload: dict[str, Any], expires_in_seconds: int = 86400 * 7) -> str:
    """Creates a cryptographically signed HMAC-SHA256 JWT."""
    settings = get_settings()
    secret = (settings.run_hmac_secret or "karkhana-jwt-secret-default").encode("utf-8")
    
    header = {"alg": "HS256", "typ": "JWT"}
    body = {**payload, "exp": int(time.time()) + expires_in_seconds, "iat": int(time.time())}
    
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    body_bytes = json.dumps(body, separators=(",", ":")).encode("utf-8")
    
    signing_input = f"{_b64url_encode(header_bytes)}.{_b64url_encode(body_bytes)}".encode("utf-8")
    signature = hmac.new(secret, signing_input, hashlib.sha256).digest()
    
    return f"{signing_input.decode('utf-8')}.{_b64url_encode(signature)}"


def decode_token(token: str) -> dict[str, Any] | None:
    """Verifies and decodes a signed HMAC-SHA256 JWT."""
    settings = get_settings()
    secret = (settings.run_hmac_secret or "karkhana-jwt-secret-default").encode("utf-8")
    
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        signing_input = f"{parts[0]}.{parts[1]}".encode("utf-8")
        expected_sig = hmac.new(secret, signing_input, hashlib.sha256).digest()
        provided_sig = _b64url_decode(parts[2])
        if not hmac.compare_digest(expected_sig, provided_sig):
            return None
        
        body = json.loads(_b64url_decode(parts[1]).decode("utf-8"))
        if body.get("exp") and body["exp"] < time.time():
            return None
        return body
    except Exception:
        return None


@functools.cache
def _firebase_app():
    import firebase_admin

    settings = get_settings()
    project = settings.firebase_project_id or settings.google_cloud_project
    return firebase_admin.initialize_app(options={"projectId": project})


async def _verify_firebase_token(token: str) -> dict[str, Any]:
    from firebase_admin import auth as fb_auth

    app = _firebase_app()
    try:
        # verify_id_token does blocking I/O (cached cert fetch), keep it off the loop.
        return await asyncio.to_thread(fb_auth.verify_id_token, token, app, True)
    except Exception as exc:
        logger.info("Rejected Firebase token: %s", type(exc).__name__)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid or expired sign-in"
        ) from exc


async def current_user(
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
    x_dev_user: Annotated[str | None, Header()] = None,
) -> User:
    """Resolves the signed-in user and their server-side role."""
    settings = get_settings()
    email: str | None = None

    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        # 1. Try our internal signed JWT token
        payload = decode_token(token)
        if payload and payload.get("email"):
            email = payload["email"]
        # 2. Try Firebase ID token if configured and not internal token
        elif settings.auth_mode == "firebase":
            claims = await _verify_firebase_token(token)
            if claims.get("email"):
                email = claims["email"]
        else:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    elif x_dev_user and settings.auth_mode == "dev":
        # The dev header is trusted only in dev mode. In any other mode it is
        # ignored, so it can never be used to sign in as someone else.
        email = x_dev_user
    elif settings.auth_mode == "dev":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing authentication")
    else:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")

    if not email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Could not determine identity")

    user = await session.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This account is not registered. Please sign up or contact an administrator.",
        )
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_role(*roles: Role) -> Callable[..., Coroutine[Any, Any, User]]:
    """Builds a dependency that admits only the given roles.

    Example:
        ``@router.post("/approve", dependencies=[Depends(require_role(Role.DIRECTOR))])``
    """
    allowed = frozenset(roles)

    async def _dep(user: CurrentUser) -> User:
        if Role(user.role) not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Requires role: {', '.join(sorted(r.value for r in allowed))}",
            )
        return user

    return _dep
