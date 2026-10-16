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

"""Test fixtures.

Unit tests need nothing external. Integration tests need a local Postgres 16
with pgvector (``make db-local``); they create a fresh ``karkhana_test``
database, apply the real migrations as the owner, and connect as the
least-privilege app role, exactly like production.
"""

from __future__ import annotations

import asyncio
import os

import pytest

OWNER_DSN = os.environ.get(
    "TEST_OWNER_DSN",
    "postgresql://karkhana_owner:karkhana_owner@localhost:5432/postgres",
)
TEST_DB = os.environ.get("KARKHANA_TEST_DB", "karkhana_test")

os.environ.update(
    {
        "AUTH_MODE": "dev",
        "DATABASE_URL": f"postgresql+asyncpg://karkhana_app:karkhana_app@localhost:5432/{TEST_DB}",
        "RUNNER_BACKEND": "local",
        "RUN_HMAC_SECRET": "test-secret",
        "STATIC_DIR": "/nonexistent",
        "GOOGLE_CLOUD_PROJECT": "test-project",
        "MAX_ACTIVE_RUNS_PER_PROJECT": "3",  # Exercise the concurrent-run paths.
    }
)
os.environ.pop("GITHUB_REPO", None)
os.environ.pop("GITHUB_TOKEN", None)


def _db_available() -> bool:
    try:
        import asyncpg

        async def ping():
            conn = await asyncpg.connect(OWNER_DSN, timeout=3)
            await conn.close()

        asyncio.run(ping())
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def database():
    """Creates and migrates the test database once per session."""
    if not _db_available():
        pytest.skip("local Postgres not available (run `make db-local`)")
    import asyncpg

    async def setup():
        conn = await asyncpg.connect(OWNER_DSN)
        await conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        await conn.execute(f"CREATE DATABASE {TEST_DB}")
        await conn.close()

    asyncio.run(setup())
    owner_url = OWNER_DSN.replace("/postgres", f"/{TEST_DB}").replace(
        "postgresql://", "postgresql+asyncpg://"
    )
    from app.config import get_settings

    os.environ["DATABASE_URL"] = owner_url
    get_settings.cache_clear()
    from app.scripts.migrate import migrate

    asyncio.run(migrate("karkhana_app"))
    os.environ["DATABASE_URL"] = (
        f"postgresql+asyncpg://karkhana_app:karkhana_app@localhost:5432/{TEST_DB}"
    )
    get_settings.cache_clear()
    yield owner_url
