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

"""Diff parsing and comment anchoring: what keeps GitHub from rejecting a review."""

from __future__ import annotations

from app.review.diff import (
    anchor,
    anchor_comments,
    diff_to_json,
    normalize_path,
    parse_unified_diff,
)
from app.schemas import ReviewCommentDraft

DIFF = """\
diff --git a/app/pay.py b/app/pay.py
index 111..222 100644
--- a/app/pay.py
+++ b/app/pay.py
@@ -10,5 +10,7 @@ def charge(amount):
     total = amount * 100
-    -- legacy marker
+    if amount < 0:
+        raise ValueError("negative")
     return total

 def refund(amount):
@@ -40,2 +42,3 @@ def helper():
     a = 1
+    b = 2
     return a
diff --git a/app/new_file.py b/app/new_file.py
new file mode 100644
--- /dev/null
+++ b/app/new_file.py
@@ -0,0 +1,2 @@
+x = 1
+y = 2
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-gone
"""


def test_parses_files_hunks_and_line_numbers():
    files = parse_unified_diff(DIFF)
    assert [f.path for f in files] == ["app/pay.py", "app/new_file.py", "old.txt"]
    pay = files[0]
    assert len(pay.hunks) == 2
    assert pay.additions == 3 and pay.deletions == 1
    first_new = next(ln for ln in pay.hunks[0].lines if ln.kind == "add")
    assert first_new.new == 11 and first_new.text == "    if amount < 0:"


def test_removed_line_starting_with_dashes_is_not_a_file_header():
    pay = parse_unified_diff(DIFF)[0]
    dels = [ln for ln in pay.hunks[0].lines if ln.kind == "del"]
    assert [d.text for d in dels] == ["    -- legacy marker"]
    assert [f.path for f in parse_unified_diff(DIFF)].count("legacy marker") == 0


def test_status_for_added_and_deleted_files():
    files = {f.path: f for f in parse_unified_diff(DIFF)}
    assert files["app/new_file.py"].status == "added"
    assert files["old.txt"].status == "deleted"
    assert files["old.txt"].commentable_lines() == set()


def test_commentable_lines_are_added_and_context_new_numbers():
    pay = parse_unified_diff(DIFF)[0]
    ok = pay.commentable_lines()
    assert ok == {10, 11, 12, 13, 14, 15, 42, 43, 44}


def test_plain_unified_diff_without_git_header():
    plain = "--- a/x.py\n+++ b/x.py\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n"
    files = parse_unified_diff(plain)
    assert [f.path for f in files] == ["x.py"]
    assert files[0].additions == 1 and files[0].deletions == 1


def test_malformed_input_never_raises():
    assert parse_unified_diff("") == []
    assert parse_unified_diff("not a diff at all") == []
    parse_unified_diff("diff --git a/x b/x\n@@ -1 +1 @@\n+only")


def test_anchor_keeps_a_valid_line():
    files = parse_unified_diff(DIFF)
    a = anchor(files, "app/pay.py", 12)
    assert (a.path, a.line, a.resolved, a.snapped) == ("app/pay.py", 12, True, False)


def test_anchor_snaps_a_nearby_line_into_the_diff():
    files = parse_unified_diff(DIFF)
    inside = anchor(files, "app/pay.py", 44)
    assert inside.line == 44 and inside.snapped is False
    near = anchor(files, "app/pay.py", 17)  # 15 is the closest line in the diff
    assert near.line == 15 and near.snapped is True
    edge = anchor(files, "app/pay.py", 47)  # exactly SNAP_WINDOW away from 44
    assert edge.line == 44 and edge.snapped is True
    assert anchor(files, "app/pay.py", 48).line is None  # one past the window


def test_anchor_drops_a_line_far_outside_the_diff():
    files = parse_unified_diff(DIFF)
    a = anchor(files, "app/pay.py", 500)
    assert a.line is None and a.resolved is True


def test_anchor_resolves_path_variants():
    files = parse_unified_diff(DIFF)
    for cited in ("a/app/pay.py", "b/app/pay.py", "./app/pay.py", "pay.py"):
        assert anchor(files, cited, 12).path == "app/pay.py", cited
    assert normalize_path('"b/src/x.py"') == "src/x.py"


def test_unknown_path_is_unresolved_file_level():
    files = parse_unified_diff(DIFF)
    a = anchor(files, "nope/missing.py", 3)
    assert a.resolved is False and a.line is None


def test_anchor_comments_returns_one_comment_per_input_with_valid_lines():
    drafts = [
        ReviewCommentDraft(path="b/app/pay.py", line=12, severity="high", body="x"),
        ReviewCommentDraft(path="app/pay.py", line=900, severity="low", body="y"),
        ReviewCommentDraft(path="ghost.py", line=1, severity="medium", body="z"),
    ]
    out = anchor_comments(DIFF, drafts)
    assert len(out) == 3
    assert (out[0].path, out[0].line) == ("app/pay.py", 12)
    assert out[1].line is None
    assert (out[2].path, out[2].line) == ("ghost.py", None)
    assert [c.body for c in out] == ["x", "y", "z"]  # content untouched


def test_anchor_comments_without_a_diff_is_a_noop():
    drafts = [ReviewCommentDraft(path="a.py", line=3, severity="low", body="x")]
    assert anchor_comments("", drafts) == drafts


def test_diff_to_json_shape():
    data = diff_to_json(parse_unified_diff(DIFF))
    assert data[0]["path"] == "app/pay.py"
    assert data[0]["hunks"][0]["lines"][0]["kind"] in {"ctx", "add", "del"}
    assert {"additions", "deletions", "status", "binary"} <= set(data[0])
