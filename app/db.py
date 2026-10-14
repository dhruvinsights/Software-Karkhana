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
"""Async database engine.

On Cloud Run the engine connects through the Cloud SQL Python Connector with
IAM database authentication, so there is no database password anywhere. The
app connects as a role that has no UPDATE or DELETE on the evidence ledger.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None
_connector = None


async def _cloud_sql_creator():
    """Opens one asyncpg connection through the Cloud SQL connector."""
    global _connector
    from google.cloud.sql.connector import IPTypes, create_async_connector

    settings = get_settings()
    if _connector is None:
        _connector = await create_async_connector()
    if settings.db_password:  # Migrate job: built-in owner user.
        return await _connector.connect_async(
            settings.cloud_sql_instance,
            "asyncpg",
            user=settings.db_user,
            password=settings.db_password,
            db=settings.db_name,
            ip_type=IPTypes.PUBLIC,
        )
    return await _connector.connect_async(  # Service: IAM auth, no password.
        settings.cloud_sql_instance,
        "asyncpg",
        user=settings.db_iam_user,
        db=settings.db_name,
        enable_iam_auth=True,
        ip_type=IPTypes.PUBLIC,
    )


def get_engine() -> AsyncEngine:
    """Returns the process-wide engine, creating it on first use."""
    global _engine, _sessionmaker
    if _engine is None:
        settings = get_settings()
        if settings.cloud_sql_instance:
            _engine = create_async_engine(
                "postgresql+asyncpg://",
                async_creator=_cloud_sql_creator,
                pool_size=5,
                max_overflow=5,
                pool_pre_ping=True,
            )
        else:
            _engine = create_async_engine(
                settings.database_url, pool_size=5, max_overflow=5, pool_pre_ping=True
            )
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Returns the session factory bound to the engine."""
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one transaction per request, committed on success."""
    async with sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose() -> None:
    """Closes pooled connections and the connector on shutdown."""
    global _engine, _sessionmaker, _connector
    if _engine is not None:
        await _engine.dispose()
    if _connector is not None:
        await _connector.close_async()
    _engine, _sessionmaker, _connector = None, None, None
