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

"""Which GitHub repository a project works in, and whose token writes to it.

Every product names its repository in Product Setup. GitHub writes (push, PR,
review, merge) use, in order: the product owner's connected token (the person
who connected the repository acts as the integration until a GitHub App is
installed), the acting user's token, then the server's ``GITHUB_TOKEN``.
Without a product repository the server-wide ``GITHUB_REPO`` is used.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.integrations import github, github_tokens
from app.models import Product, Project

_GITHUB_URL = re.compile(r"^(?:https://github\.com/|git@github\.com:)([\w.-]+/[\w.-]+?)(?:\.git)?/?$")


@dataclass(frozen=True)
class RepoTarget:
    """A GitHub repository and the branch work merges into."""

    slug: str  # "owner/name"
    base_branch: str

    @property
    def clone_url(self) -> str:
        """HTTPS clone URL (auth goes in a header, never in the URL)."""
        return f"https://github.com/{self.slug}.git"


def parse_slug(url: str) -> str | None:
    """``owner/name`` from a GitHub URL, or ``None`` if it is not one."""
    m = _GITHUB_URL.match(url.strip())
    return m.group(1) if m else None


def for_product(product: Product | None) -> RepoTarget | None:
    """The product's repository, else the server-wide one."""
    s = get_settings()
    settings = product.settings if product and isinstance(product.settings, dict) else {}
    slug = parse_slug(str(settings.get("repositoryUrl") or "")) or s.github_repo
    return RepoTarget(slug, s.github_base_branch) if slug else None


async def for_project(session: AsyncSession, project_id: uuid.UUID) -> RepoTarget | None:
    """The project's own repository (set at launch), else its product's."""
    project = await session.get(Project, project_id)
    own = parse_slug(str((project.settings or {}).get("repository_url") or "")) if project else None
    if own:
        return RepoTarget(own, get_settings().github_base_branch)
    product = await session.get(Product, project.product_id) if project and project.product_id else None
    return for_product(product)


async def write_token(
    session: AsyncSession, project_id: uuid.UUID, acting_user: uuid.UUID | None
) -> str | None:
    """The token GitHub writes for this project use (see module docstring)."""
    project = await session.get(Project, project_id)
    product = await session.get(Product, project.product_id) if project and project.product_id else None
    for user_id in (product.created_by if product else None, acting_user):
        if user_id and (token := await github_tokens.load_token(session, user_id)):
            return token
    return get_settings().github_token


async def client_for(
    session: AsyncSession, project_id: uuid.UUID, acting_user: uuid.UUID | None
) -> github.GitHub | None:
    """A GitHub client bound to the project's repository, or ``None`` if not configured."""
    target = await for_project(session, project_id)
    token = await write_token(session, project_id, acting_user)
    if target is None or token is None:
        return None
    return github.GitHub(token, target.slug, get_settings().github_api_url)
