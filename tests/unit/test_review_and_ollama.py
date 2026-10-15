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

"""PR-Agent output parsing and the Ollama provider, against a stubbed HTTP transport."""

from __future__ import annotations

import httpx
import pytest

from app.ai.errors import ModelError
from app.ai.providers import ollama
from app.config import get_settings
from app.review.pr_agent import parse_review


def test_clean_review_is_valid_with_zero_comments():
    comments, summary = parse_review({"review": {"key_issues_to_review": []}})
    assert comments == [] and "No key issues found" in summary


def test_issues_become_comments_with_inferred_severity():
    comments, _ = parse_review(
        {
            "review": {
                "key_issues_to_review": [
                    {
                        "relevant_file": "app/pay.py",
                        "issue_header": "SQL injection risk",
                        "issue_content": "User input is concatenated into a query.",
                        "start_line": 12,
                    },
                    {
                        "relevant_file": "app/x.py",
                        "issue_header": "Naming",
                        "issue_content": "Rename it.",
                    },
                ],
                "security_concerns": "No security concerns identified",
                "estimated_effort_to_review_[1-5]": 2,
            }
        }
    )
    assert [c.severity for c in comments] == ["high", "low"]
    assert comments[0].line == 12 and comments[1].line is None


def test_real_security_concern_is_added_as_high():
    comments, _ = parse_review(
        {"review": {"security_concerns": "Token logged in plain text"}}
    )
    assert comments[0].severity == "high" and comments[0].path == "(security)"


def _stub(monkeypatch, handler):
    monkeypatch.setattr(
        ollama,
        "_http",
        lambda timeout: httpx.AsyncClient(
            base_url="http://ollama.test", transport=httpx.MockTransport(handler)
        ),
    )


async def test_embed_uses_nomic_prefix_and_checks_dimension(monkeypatch):
    dim = get_settings().embedding_dim
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.read().decode()
        return httpx.Response(200, json={"embeddings": [[0.1] * dim]})

    _stub(monkeypatch, handler)
    vector = await ollama.embed("hello", task_type="RETRIEVAL_QUERY")
    assert len(vector) == dim and "search_query: hello" in seen["body"]


async def test_embed_rejects_wrong_dimension(monkeypatch):
    _stub(monkeypatch, lambda r: httpx.Response(200, json={"embeddings": [[0.1, 0.2]]}))
    with pytest.raises(ModelError, match="dimensional"):
        await ollama.embed("hello")


async def test_unreachable_ollama_is_reported_by_health(monkeypatch):
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    _stub(monkeypatch, boom)
    info = await ollama.health()
    assert info["ok"] is False and info["models"] == []
