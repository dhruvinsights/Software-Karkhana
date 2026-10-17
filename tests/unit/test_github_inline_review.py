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

"""Inline PR reviews: comments are anchored to the diff before GitHub sees them."""

from __future__ import annotations

import json

import httpx

from app.integrations.github import GitHub

DIFF = """\
diff --git a/app/pay.py b/app/pay.py
--- a/app/pay.py
+++ b/app/pay.py
@@ -10,2 +10,3 @@ def charge(amount):
     total = amount * 100
+    assert amount >= 0
     return total
"""


def _client(handler) -> GitHub:
    gh = GitHub("token", "org/repo")
    gh._http = httpx.AsyncClient(
        base_url="https://api.github.test/repos/org/repo",
        transport=httpx.MockTransport(handler),
    )
    return gh


def _comment(path: str, line: int | None, body: str = "x") -> dict:
    return {"path": path, "line": line, "severity": "high", "body": body}


async def test_comments_are_anchored_to_diff_lines_before_posting():
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.read()))
        return httpx.Response(200, json={"id": 7})

    gh = _client(handler)
    review_id = await gh.post_inline_review(
        number=3,
        head_sha="abc",
        comments=[
            _comment(
                "b/app/pay.py", 12, "snapped"
            ),  # path form + line 12 -> 11 (nearest)
            _comment("app/pay.py", None, "file level"),
            _comment("app/pay.py", 400, "far away"),
        ],
        diff=DIFF,
    )
    await gh.aclose()

    assert review_id == 7 and len(sent) == 1
    inline = sent[0]["comments"]
    assert [(c["path"], c["line"]) for c in inline] == [("app/pay.py", 12)]
    assert all(c["side"] == "RIGHT" for c in inline)
    body = sent[0]["body"]
    assert "file level" in body and "far away" in body  # kept as file-level findings


async def test_rejected_inline_review_keeps_every_finding_in_the_body():
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.read()))
        if len(calls) == 1:
            return httpx.Response(422, json={"message": "Unprocessable"})
        return httpx.Response(200, json={"id": 9})

    gh = _client(handler)
    review_id = await gh.post_inline_review(
        number=3,
        head_sha="abc",
        comments=[_comment("app/pay.py", 11, "guard the amount")],
    )
    await gh.aclose()

    assert review_id == 9 and len(calls) == 2
    assert "comments" in calls[0] and "comments" not in calls[1]
    assert "guard the amount" in calls[1]["body"]  # retry no longer drops the finding


async def test_without_a_diff_lines_are_posted_as_given():
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.read()))
        return httpx.Response(200, json={"id": 1})

    gh = _client(handler)
    await gh.post_inline_review(
        number=1, head_sha="abc", comments=[_comment("a.py", 5)]
    )
    await gh.aclose()
    assert sent[0]["comments"][0]["line"] == 5


async def test_request_reviewers_strips_at_and_skips_empty():
    sent: list[tuple[str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append((request.url.path, json.loads(request.read())))
        return httpx.Response(201, json={})

    gh = _client(handler)
    await gh.request_reviewers(number=3, reviewers=["@alice", " bob ", ""])
    await gh.request_reviewers(number=3, reviewers=["", " "])
    await gh.aclose()
    assert sent == [
        ("/repos/org/repo/pulls/3/requested_reviewers", {"reviewers": ["alice", "bob"]})
    ]


def test_number_diff_prefixes_new_file_line_numbers():
    from app.review.diff import number_diff

    shown = number_diff(DIFF)
    assert "=== app/pay.py (modified) ===" in shown
    assert "   11 +    assert amount >= 0" in shown
    assert "   10      total = amount * 100" in shown
