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

"""Identity: one-time codes, Google/GitHub sign-in, password login and the current user."""

from __future__ import annotations

import datetime as dt
import hmac
import logging
import os
import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access, db, ledger, otp
from app.auth import CurrentUser, create_token, hash_password, verify_password
from app.models import User
from app.schemas import (
    TokenOut,
    UserLogin,
    UserOut,
    UserSignUp,
)

_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

router = APIRouter(tags=["auth"])

_OTP = otp.OtpStore()


class SendOTPRequest(BaseModel):
    """Request body for sending an email OTP code."""

    email: str


class VerifyOTPRequest(BaseModel):
    """Request body for verifying an email OTP code."""

    email: str
    code: str


class GoogleAuthRequest(BaseModel):
    """Request body carrying a Google Identity Services ID token."""

    credential: str


GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")


def _send_otp_email(to_email: str, otp_code: str) -> bool:
    """Sends a branded OTP verification email via Resend.

    Returns True when the email was dispatched, False when RESEND_API_KEY is
    not configured (local dev without secrets set).
    """
    from app.config import get_settings
    from app.email import send_email

    settings = get_settings()
    base_url = settings.public_base_url.rstrip("/")
    logo_url = "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/logo-iPRZvqKRlb13DWnnPrieJh1ogqAfm9.png"

    html_body = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your verification code</title>
</head>
<body style="margin:0;background:#f3f6fb;color:#0a0d14;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;padding:32px 12px;">
<tr>
<td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #dbe5f5;border-radius:24px;overflow:hidden;box-shadow:0 24px 80px rgba(15,35,90,.16);">
<tr>
<td style="padding:28px 32px 46px;background:linear-gradient(135deg,#05070b 0%,#0b1934 52%,#1261d6 100%);color:#fff;">
<img src="{logo_url}" width="58" height="58" alt="Software Karkhana" style="display:block;border-radius:14px;background:#fff;padding:4px;">
<p style="margin:48px 0 12px;color:#b9d3ff;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Security verification</p>
<h1 style="margin:0;font-size:42px;line-height:1.08;letter-spacing:-1.5px;">Confirm it&apos;s you.</h1>
<p style="margin:18px 0 0;max-width:430px;color:#dce8ff;font-size:16px;line-height:1.6;">Use the verification code below to securely continue to your Software Karkhana account.</p>
</td>
</tr>
<tr>
<td style="padding:40px 32px 36px;text-align:center;">
<p style="margin:0;color:#526071;font-size:14px;line-height:1.5;">Your one-time verification code is</p>
<div style="display:inline-block;margin:22px 0 18px;padding:20px 30px;background:#eef4ff;border:1px solid #cfe0fb;border-radius:16px;color:#07101f;font-size:36px;line-height:1;letter-spacing:9px;font-weight:bold;">{otp_code}</div>
<p style="margin:0;color:#667386;font-size:13px;line-height:1.6;">This code expires in <strong style="color:#1261d6;">10 minutes</strong>.</p>
</td>
</tr>
<tr>
<td style="padding:24px 32px;background:#f8faff;border-top:1px solid #e5edf8;">
<p style="margin:0;color:#526071;font-size:13px;line-height:1.65;">If you didn&apos;t request this code, you can safely ignore this email. Never share your verification code with anyone.</p>
</td>
</tr>
<tr>
<td style="padding:24px 32px;text-align:center;">
<p style="margin:0;color:#8290a3;font-size:12px;line-height:1.6;">Need help? Reply to this email or visit<br>
<a href="{base_url}" style="color:#1261d6;font-weight:bold;text-decoration:none;">softwarekarkhana.com</a>
</p>
</td>
</tr>
</table>
<p style="margin:20px 0 0;color:#8290a3;font-size:11px;">© 2026 Software Karkhana. All rights reserved.</p>
</td>
</tr>
</table>
</body>
</html>"""

    try:
        result = send_email(
            to=to_email,
            subject=f"\U0001f512 {otp_code} \u2014 Your Software Karkhana sign-in code",
            html=html_body,
            from_address=settings.email_from,
        )
        return result is not None
    except Exception as exc:
        logging.getLogger("auth").warning(f"Resend email dispatch error: {exc}")
        return False


def _send_welcome_email(to_email: str, display_name: str) -> None:
    """Fires a one-time welcome email to every brand-new user account.

    Non-blocking: failures are logged, never raised.
    """
    from app.config import get_settings
    from app.email import send_email

    settings = get_settings()

    html_body = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Software Karkhana</title>
</head>
<body style="margin:0;background:#f3f6fb;color:#0a0d14;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #dbe5f5;border-radius:24px;overflow:hidden;box-shadow:0 24px 80px rgba(15,35,90,.16);">
        <tr>
          <td style="padding:28px 32px 56px;background:linear-gradient(135deg,#05070b 0%,#0b1934 52%,#1261d6 100%);color:#fff;">
            <a href="https://softwarekarkhana.com" style="text-decoration:none;">
              <img src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/logo-iPRZvqKRlb13DWnnPrieJh1ogqAfm9.png" width="58" height="58" alt="Software Karkhana logo" style="display:block;border-radius:14px;">
            </a>
            <p style="margin:58px 0 14px;color:#b9d3ff;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Welcome to Software Karkhana</p>
            <h1 style="margin:0;max-width:480px;font-size:46px;line-height:1.05;letter-spacing:-2px;font-weight:700;">Make your next move.</h1>
            <p style="margin:22px 0 0;max-width:430px;color:#dce8ff;font-size:17px;line-height:1.65;">Build smarter, move faster, and turn your best ideas into something real.</p>
            <a href="https://softwarekarkhana.com" style="display:inline-block;margin-top:30px;padding:16px 24px;background:#fff;color:#07101f;text-decoration:none;font-size:14px;font-weight:bold;border-radius:999px;">Explore Software Karkhana</a>
          </td>
        </tr>
        <tr>
          <td style="padding:34px 32px 10px;">
            <p style="margin:0;color:#1261d6;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;">Your workspace is ready</p>
            <h2 style="margin:10px 0 12px;font-size:28px;line-height:1.15;letter-spacing:-.7px;">Everything starts with one good first step.</h2>
            <p style="margin:0;color:#526071;font-size:16px;line-height:1.65;">Here are three simple ways to get started with your new Software Karkhana workspace.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr><td style="padding:18px 0;border-bottom:1px solid #e5edf8;"><strong style="font-size:16px;">01 &nbsp; Set up your profile</strong><p style="margin:8px 0 0;color:#667386;line-height:1.5;">Add your details and make the workspace yours.</p></td></tr>
              <tr><td style="padding:18px 0;border-bottom:1px solid #e5edf8;"><strong style="font-size:16px;">02 &nbsp; Explore your tools</strong><p style="margin:8px 0 0;color:#667386;line-height:1.5;">Discover the tools designed to keep your work moving.</p></td></tr>
              <tr><td style="padding:18px 0;"><strong style="font-size:16px;">03 &nbsp; Start building</strong><p style="margin:8px 0 0;color:#667386;line-height:1.5;">Turn your next idea into momentum.</p></td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 38px;">
            <img src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/factory-icon-illustration-96nmA5XkHLoQPyNlbm93RyxBEOcvaZ.jpg" width="100%" alt="Factory illustration" style="display:block;border-radius:16px;max-width:556px;">
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;background:#eef4ff;text-align:center;">
            <p style="margin:0;color:#526071;font-size:13px;line-height:1.6;">Need help? Reply to this email or visit our website.</p>
            <p style="margin:12px 0 0;"><a href="https://softwarekarkhana.com" style="color:#1261d6;font-size:13px;font-weight:bold;text-decoration:none;">softwarekarkhana.com</a></p>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0;color:#8290a3;font-size:11px;">© 2026 Software Karkhana. All rights reserved.</p>
    </td></tr>
  </table>
</body>
</html>"""

    try:
        send_email(
            to=to_email,
            subject="Welcome to Software Karkhana 🚀 — you're in!",
            html=html_body,
            from_address=settings.email_from_team,
        )
    except Exception as exc:
        logging.getLogger("auth").warning("Welcome email failed for %s: %s", to_email, exc)


def _dev_otp_enabled() -> bool:
    """A fixed code for local development only; never on Cloud Run or in firebase mode."""
    from app.config import get_settings

    return (
        get_settings().auth_mode == "dev"
        and not os.environ.get("K_SERVICE")
        and bool(os.environ.get("DEV_OTP_CODE"))
    )


def _clean_email(raw: str) -> str:
    email = raw.strip().lower()
    if not _EMAIL_RE.fullmatch(email) or len(email) > 254:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a valid email address.")
    return email


def _refuse_guest_email(email: str) -> None:
    """Demo guests have no password and a reserved domain: never sign in by email."""
    if email.endswith(".invalid"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This address cannot sign in.")


@router.post("/api/auth/send-otp")
async def send_otp(payload: SendOTPRequest) -> dict:
    """Sends a one-time sign-in code (rate-limited per email)."""
    email_clean = _clean_email(payload.email)
    _refuse_guest_email(email_clean)
    try:
        code = _OTP.issue(email_clean)
    except otp.OtpError as e:
        headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        raise HTTPException(e.status, e.message, headers=headers) from e
    # The code itself is never logged.
    logging.getLogger("auth").info("Sign-in code issued for %s", email_clean)
    dispatched = _send_otp_email(email_clean, code)
    if not dispatched and not _dev_otp_enabled():
        logging.getLogger("auth").error("OTP email could not be sent to %s", email_clean)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "We could not send the email right now. Please try again shortly.",
        )
    return {
        "status": "ok",
        "message": f"Verification code sent to {email_clean}",
        "expires_in": otp.TTL_SECONDS,
        "resend_in": otp.RESEND_COOLDOWN,
    }


@router.post("/api/auth/verify-otp", response_model=TokenOut)
async def verify_otp(
    payload: VerifyOTPRequest,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> TokenOut:
    """Verifies the one-time code and signs the user in (creating them if new)."""
    email_clean = _clean_email(payload.email)
    _refuse_guest_email(email_clean)
    code_input = payload.code.strip()

    dev_code = os.environ.get("DEV_OTP_CODE", "")
    if _dev_otp_enabled() and hmac.compare_digest(code_input.encode(), dev_code.encode()):
        pass
    else:
        try:
            _OTP.verify(email_clean, code_input)
        except otp.OtpError as e:
            raise HTTPException(e.status, e.message) from e

    # Find or auto-provision user
    user = await session.scalar(select(User).where(User.email == email_clean))
    if user is None:
        display_name = email_clean.split("@")[0].replace(".", " ").title()
        user = User(
            id=uuid.uuid4(),
            email=email_clean,
            display_name=display_name,
            role=access.DEFAULT_ACCOUNT_ROLE,
            hashed_password=None,
            is_active=True,
            is_verified=True,
            onboarded_at=None,
        )
        session.add(user)
        await session.flush()
        _send_welcome_email(user.email, user.display_name)
    else:
        user.is_verified = True
        session.add(user)
        await session.flush()

    token = create_token({
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "name": user.display_name,
    })

    return TokenOut(access_token=token, token_type="Bearer", user=UserOut.model_validate(user))  # noqa: S106 - OAuth token type label, not a secret


@router.post("/api/auth/google", response_model=TokenOut)
async def google_auth(
    payload: GoogleAuthRequest,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> TokenOut:
    """Verifies Google ID token from Google Identity Services and provisions or logs in user."""
    from app.config import get_settings
    settings = get_settings()
    target_client_id = settings.google_client_id or os.getenv("GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID)
    try:
        id_info = id_token.verify_oauth2_token(
            payload.credential,
            google_requests.Request(),
            target_client_id,
        )
    except Exception as exc:
        logging.getLogger("auth").error(f"Google OAuth verification failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Google authentication failed: {exc!s}",
        ) from exc

    email = (id_info.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google ID token does not contain a verified email address.",
        )

    display_name = id_info.get("name") or email.split("@")[0].capitalize()
    avatar_url = id_info.get("picture")

    user = await session.scalar(select(User).where(User.email == email))

    if user is None:
        user = User(
            id=uuid.uuid4(),
            email=email,
            display_name=display_name,
            role=access.DEFAULT_ACCOUNT_ROLE,
            hashed_password=None,
            avatar_url=avatar_url,
            is_active=True,
            is_verified=True,
            onboarded_at=dt.datetime.now(dt.UTC),
        )
        session.add(user)
        await session.flush()
        await ledger.append_entry(
            session=session,
            action="user_created_via_google_oauth",
            actor=email,
            payload={"user_id": str(user.id), "email": email, "display_name": display_name},
        )
        _send_welcome_email(user.email, user.display_name)
    else:
        user.is_verified = True
        if avatar_url and user.avatar_url != avatar_url:
            user.avatar_url = avatar_url
        session.add(user)
        await session.flush()

    token = create_token({
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "name": user.display_name,
    })

    return TokenOut(access_token=token, token_type="Bearer", user=UserOut.model_validate(user))  # noqa: S106 - OAuth token type label, not a secret


class GitHubAuthRequest(BaseModel):
    """Request body carrying a GitHub OAuth authorization code."""

    code: str


@router.get("/api/auth/google/client-id")
async def get_google_client_id() -> dict:
    """Returns the configured Google OAuth client ID for frontend Google Identity Services."""
    from app.config import get_settings
    settings = get_settings()
    client_id = settings.google_client_id or os.getenv("GOOGLE_CLIENT_ID", "") or GOOGLE_CLIENT_ID or ""
    return {"client_id": client_id}


@router.get("/api/auth/github/client-id")
async def get_github_client_id() -> dict:
    """Returns the configured GitHub OAuth client ID for frontend redirect."""
    from app.config import get_settings
    settings = get_settings()
    client_id = settings.github_client_id or os.getenv("GITHUB_CLIENT_ID", "")
    return {"client_id": client_id}


@router.post("/api/auth/github", response_model=TokenOut)
async def github_auth(
    payload: GitHubAuthRequest,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> TokenOut:
    """Exchanges GitHub OAuth authorization code for profile and provisions/logs in user."""
    from app.config import get_settings
    settings = get_settings()
    client_id = settings.github_client_id or os.getenv("GITHUB_CLIENT_ID", "")
    client_secret = settings.github_client_secret or os.getenv("GITHUB_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GitHub OAuth is not configured on backend. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in environment.",
        )

    try:
        import httpx

        async with httpx.AsyncClient(timeout=15.0) as client:
            token_resp = await client.post(
                "https://github.com/login/oauth/access_token",
                headers={"Accept": "application/json"},
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": payload.code.strip(),
                },
            )
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=token_data.get("error_description") or "Failed to exchange GitHub authorization code.",
                )

            # Fetch user profile
            user_resp = await client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "Software-Karkhana-Auth",
                },
            )
            gh_user = user_resp.json()

            email = (gh_user.get("email") or "").strip().lower()

            # If email is private on GitHub profile, fetch from emails endpoint
            if not email:
                emails_resp = await client.get(
                    "https://api.github.com/user/emails",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/vnd.github+json",
                        "User-Agent": "Software-Karkhana-Auth",
                    },
                )
                if emails_resp.status_code == 200:
                    emails_data = emails_resp.json()
                    for em in emails_data:
                        if em.get("primary") and em.get("verified"):
                            email = em.get("email", "").strip().lower()
                            break
                        elif em.get("verified") and not email:
                            email = em.get("email", "").strip().lower()

            if not email:
                email = f"{gh_user.get('login', 'developer').lower()}@users.noreply.github.com"

            display_name = gh_user.get("name") or gh_user.get("login") or "GitHub Developer"
            avatar_url = gh_user.get("avatar_url")

    except HTTPException:
        raise
    except Exception as exc:
        logging.getLogger("auth").error(f"GitHub OAuth error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"GitHub authentication failed: {exc!s}",
        ) from exc

    stmt = select(User).where(User.email == email)
    user = (await session.execute(stmt)).scalar_one_or_none()

    if user is None:
        user = User(
            id=uuid.uuid4(),
            email=email,
            display_name=display_name,
            role=access.DEFAULT_ACCOUNT_ROLE,
            hashed_password=None,
            avatar_url=avatar_url,
            is_active=True,
            is_verified=True,
            onboarded_at=dt.datetime.now(dt.UTC),
        )
        session.add(user)
        await session.flush()
        await ledger.append_entry(
            session=session,
            action="user_created_via_github_oauth",
            actor=email,
            payload={"user_id": str(user.id), "email": email, "display_name": display_name},
        )
        _send_welcome_email(user.email, user.display_name)
    else:
        user.is_verified = True
        if avatar_url and user.avatar_url != avatar_url:
            user.avatar_url = avatar_url
        session.add(user)
        await session.flush()

    token = create_token({
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "name": user.display_name,
    })

    return TokenOut(access_token=token, token_type="Bearer", user=UserOut.model_validate(user))  # noqa: S106 - OAuth token type label, not a secret


@router.post("/api/auth/signup", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def signup(
    payload: UserSignUp,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> TokenOut:
    """Creates a new enterprise user account."""
    email_clean = payload.email.strip().lower()
    existing = await session.scalar(select(User).where(User.email == email_clean))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address already exists.",
        )

    # Signup never grants an authorization role. Workspace roles are assigned
    # by an owner or through an accepted invitation.
    role = "developer"

    user = User(
        id=uuid.uuid4(),
        email=email_clean,
        display_name=payload.display_name.strip(),
        role=role,
        hashed_password=hash_password(payload.password),
        is_active=True,
        is_verified=False,
        onboarded_at=None,
    )
    session.add(user)
    await session.flush()
    _send_welcome_email(user.email, user.display_name)

    token = create_token({
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "name": user.display_name,
    })

    return TokenOut(access_token=token, token_type="Bearer", user=UserOut.model_validate(user))  # noqa: S106 - OAuth token type label, not a secret


@router.post("/api/auth/login", response_model=TokenOut)
async def login(
    payload: UserLogin,
    session: Annotated[AsyncSession, Depends(db.get_session)],
) -> TokenOut:
    """Authenticates with email and password."""
    email_clean = payload.email.strip().lower()
    user = await session.scalar(select(User).where(User.email == email_clean))
    if user is None or user.is_guest or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    # If password is set, verify it; if user has no password (e.g. seeded demo user), allow sign in
    if not user.hashed_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This account uses Google sign-in. Please continue with Google.")
    if True:
        if not verify_password(payload.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )

    token = create_token({
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "name": user.display_name,
    })

    return TokenOut(access_token=token, token_type="Bearer", user=UserOut.model_validate(user))  # noqa: S106 - OAuth token type label, not a secret


@router.get("/api/auth/me", response_model=UserOut)
async def get_me(user: CurrentUser) -> UserOut:
    """Returns profile for currently authenticated user."""
    return UserOut.model_validate(user)
