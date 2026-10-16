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
"""The X-Dev-User header must only sign anyone in when AUTH_MODE=dev."""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app import auth


@pytest.mark.asyncio
async def test_dev_header_is_ignored_outside_dev_mode(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(auth_mode="firebase"))
    session = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await auth.current_user(
            session=session, authorization=None, x_dev_user="victim@example.com"
        )
    assert exc.value.status_code == 401
    session.scalar.assert_not_called()


@pytest.mark.asyncio
async def test_dev_header_signs_in_only_in_dev_mode(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(auth_mode="dev"))
    user = SimpleNamespace(id=uuid.uuid4(), email="dev@example.com")
    session = AsyncMock()
    session.scalar.return_value = user
    got = await auth.current_user(
        session=session, authorization=None, x_dev_user="dev@example.com"
    )
    assert got is user
