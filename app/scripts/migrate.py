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

"""Applies db/migrations/*.sql in order, once each, as the schema owner.

Runs as the ``karkhana-migrate`` Cloud Run Job during deploy (Cloud SQL IAM
user of the migrate service account) or locally against ``DATABASE_URL``.

Usage:
    python -m app.scripts.migrate --app-role karkhana_app
"""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path

from sqlalchemy import text

from app import db

MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "migrations"


async def migrate(app_role: str) -> None:
    engine = db.get_engine()
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())"
            )
        )
        done = {
            r[0]
            for r in (
                await conn.execute(text("SELECT name FROM schema_migrations"))
            ).all()
        }
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name in done and "grants" not in path.name:
                continue
            sql = path.read_text().replace("{{APP_ROLE}}", app_role)
            # asyncpg runs multi-statement scripts via the raw driver connection.
            raw = await conn.get_raw_connection()
            await raw.driver_connection.execute(sql)
            await conn.execute(
                text(
                    "INSERT INTO schema_migrations (name) VALUES (:n) ON CONFLICT DO NOTHING"
                ),
                {"n": path.name},
            )
            print(f"applied {path.name}")
    await db.dispose()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--app-role", default=os.environ.get("APP_DB_ROLE", "karkhana_app")
    )
    parser.add_argument("--seed", action="store_true", help="Also upsert demo users.")
    args = parser.parse_args()
    asyncio.run(migrate(args.app_role))
    if args.seed:
        from app.scripts.seed import seed

        domain = os.environ.get("DEMO_DOMAIN", "karkhana.dev")
        asyncio.run(seed(domain, firebase=False, history=False))


if __name__ == "__main__":
    main()
