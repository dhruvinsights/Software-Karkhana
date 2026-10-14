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
import functools
import logging
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
    if settings.auth_mode == "dev":
        email = x_dev_user
        if not email:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Missing X-Dev-User header"
            )
    else:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")
        claims = await _verify_firebase_token(authorization.removeprefix("Bearer "))
        if not claims.get("email") or not claims.get("email_verified"):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "A verified email is required"
            )
        email = claims["email"]

    user = await session.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This account has no Karkhana role yet. Ask an admin.",
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
