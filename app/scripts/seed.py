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

"""Seeds demo users (and optionally Firebase accounts and a past learning).

Usage:
    python -m app.scripts.seed                       # users only
    python -m app.scripts.seed --firebase            # also create Firebase Auth users
    python -m app.scripts.seed --history             # plus a verified past learning (needs Vertex AI)

Emails default to the four demo roles; override with DEMO_DOMAIN or flags.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import os
import secrets
import uuid

from sqlalchemy import select

from app import db, ledger
from app.models import Learning, Project, User

ROLES = [
    ("pm", "Priya (PM)"),
    ("director", "Anil (Director)"),
    ("developer", "Aman (Developer)"),
    ("lead", "Vikram (Lead)"),
]

HISTORY_LEARNING = (
    "Money must be computed with Decimal and rounded once per amount with ROUND_HALF_UP "
    "to the currency's minor unit; rounding intermediate values caused one-cent drift in totals."
)


def team_users() -> list[tuple[str, str, str]]:
    """Real team accounts from SEED_USERS="alice@gmail.com:pm,bob@gmail.com:director"."""
    out = []
    for item in filter(None, os.environ.get("SEED_USERS", "").split(",")):
        email, _, role = item.strip().partition(":")
        if role not in {r for r, _ in ROLES}:
            raise SystemExit(f"bad role in SEED_USERS: {item}")
        out.append((email.lower(), role, email.split("@")[0]))
    return out


async def seed(domain: str, firebase: bool, history: bool) -> None:
    async with db.sessionmaker()() as s:
        for email, role, name in team_users():
            u = await s.scalar(select(User).where(User.email == email))
            if u is None:
                s.add(User(id=uuid.uuid4(), email=email, display_name=name, role=role))
                print(f"team user {email} ({role})")
            elif u.role != role:
                u.role = role
                print(f"team user {email} role -> {role}")
        users = {}
        for role, name in ROLES:
            email = f"{role}@{domain}"
            u = await s.scalar(select(User).where(User.email == email))
            if u is None:
                u = User(id=uuid.uuid4(), email=email, display_name=name, role=role)
                s.add(u)
                print(f"user {email} ({role})")
            users[role] = u
        await s.flush()

        if history and not await s.scalar(
            select(Learning).where(Learning.text == HISTORY_LEARNING)
        ):
            from app.ai import llm

            p = Project(
                id=uuid.uuid4(),
                name="Ledgerline reconciliation (archived)",
                idea_text="Archived project used to seed project memory.",
                created_by=users["pm"].id,
                stage="feedback",
                stage_status="archived",
            )
            s.add(p)
            await s.flush()
            lr = Learning(
                project_id=p.id,
                text=HISTORY_LEARNING,
                status="verified",
                verified_by=users["lead"].id,
                verified_at=dt.datetime.now(dt.UTC),
                embedding=await llm.embed(HISTORY_LEARNING),
                embedding_model=llm.embed_model_name(),
                source={"note": "seeded from an archived project"},
            )
            s.add(lr)
            await s.flush()
            await ledger.append(
                s,
                actor=ledger.SYSTEM,
                action="learning.seeded",
                subject_type="learning",
                subject_id=lr.id,
                project_id=p.id,
                payload={"status": "verified"},
            )
            print("seeded verified learning")
        await s.commit()
    await db.dispose()

    if firebase:
        import firebase_admin
        from firebase_admin import auth

        firebase_admin.initialize_app()
        for role, name in ROLES:
            email = f"{role}@{domain}"
            password = os.environ.get("DEMO_PASSWORD") or secrets.token_urlsafe(12)
            try:
                auth.get_user_by_email(email)
                print(f"firebase user exists: {email}")
            except auth.UserNotFoundError:
                auth.create_user(
                    email=email,
                    password=password,
                    display_name=name,
                    email_verified=True,
                )
                print(f"firebase user {email} password: {password}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--domain", default=os.environ.get("DEMO_DOMAIN", "karkhana.dev")
    )
    parser.add_argument("--firebase", action="store_true")
    parser.add_argument("--history", action="store_true")
    a = parser.parse_args()
    asyncio.run(seed(a.domain, a.firebase, a.history))


if __name__ == "__main__":
    main()
