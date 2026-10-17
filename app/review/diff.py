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

"""Unified-diff parsing and review-comment anchoring.

GitHub only accepts an inline review comment on a line that appears in the PR
diff (the RIGHT side: added or context lines). If a single comment points at a
line outside the diff, GitHub rejects the *entire* review with HTTP 422. Models
regularly cite whole-file line numbers or the wrong path form, so every AI
comment is anchored to a real diff line here before it is stored or posted.

Everything in this module is pure and deterministic: no model, no network.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from app.schemas import ReviewCommentDraft

LineKind = Literal["add", "del", "ctx"]

# How far a cited line may be from a real diff line and still be snapped to it.
SNAP_WINDOW = 3
# Parsing guards: a review never needs more than this.
MAX_FILES = 300
MAX_DIFF_CHARS = 1_000_000

_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$")
_DEV_NULL = "/dev/null"


@dataclass
class DiffLine:
    """One rendered line of a hunk."""

    kind: LineKind
    old: int | None
    new: int | None
    text: str


@dataclass
class Hunk:
    """A contiguous changed region."""

    header: str
    old_start: int
    new_start: int
    lines: list[DiffLine] = field(default_factory=list)


@dataclass
class FileDiff:
    """All hunks for one file."""

    path: str
    old_path: str | None = None
    status: Literal["added", "deleted", "modified", "renamed"] = "modified"
    binary: bool = False
    hunks: list[Hunk] = field(default_factory=list)

    @property
    def additions(self) -> int:
        """Number of added lines."""
        return sum(1 for h in self.hunks for ln in h.lines if ln.kind == "add")

    @property
    def deletions(self) -> int:
        """Number of removed lines."""
        return sum(1 for h in self.hunks for ln in h.lines if ln.kind == "del")

    def commentable_lines(self) -> set[int]:
        """New-file line numbers GitHub accepts an inline comment on."""
        return {
            ln.new
            for h in self.hunks
            for ln in h.lines
            if ln.new is not None and ln.kind in ("add", "ctx")
        }


def number_diff(text: str) -> str:
    """Re-renders a diff with the new-file line number on every added/context line.

    Models cannot count lines in a raw hunk, so they cite none. With the number
    printed next to the line they can cite it, and ``anchor`` then checks it.
    """
    out: list[str] = []
    for f in parse_unified_diff(text):
        out.append(f"=== {f.path} ({f.status}) ===")
        for h in f.hunks:
            out.append(h.header)
            for ln in h.lines:
                mark = {"add": "+", "del": "-", "ctx": " "}[ln.kind]
                num = f"{ln.new:>5}" if ln.new is not None else "     "
                out.append(f"{num} {mark}{ln.text}")
    return "\n".join(out)


def normalize_path(path: str) -> str:
    """Strips ``a/``, ``b/`` and ``./`` prefixes and surrounding quotes/space."""
    p = path.strip().strip('"').strip()
    for prefix in ("a/", "b/", "./"):
        if p.startswith(prefix):
            p = p[len(prefix) :]
    return p


def parse_unified_diff(text: str) -> list[FileDiff]:
    """Parses ``git diff`` / unified-diff output into files, hunks and lines.

    Hunk bodies are consumed by the line counts in their ``@@`` header, so a
    removed line whose content starts with ``-- `` is never mistaken for a new
    file header. Malformed input yields as much structure as could be read.
    """
    files: list[FileDiff] = []
    current: FileDiff | None = None
    hunk: Hunk | None = None
    old_left = new_left = 0
    old_no = new_no = 0
    pending_old: str | None = None

    for raw in text[:MAX_DIFF_CHARS].splitlines():
        # --- inside a hunk body: consume exactly the advertised line counts ---
        if hunk is not None and (old_left > 0 or new_left > 0):
            if raw.startswith("\\"):  # "\ No newline at end of file"
                continue
            tag, body = (raw[:1], raw[1:]) if raw else (" ", "")
            if tag == "+" and new_left > 0:
                hunk.lines.append(DiffLine("add", None, new_no, body))
                new_no += 1
                new_left -= 1
                continue
            if tag == "-" and old_left > 0:
                hunk.lines.append(DiffLine("del", old_no, None, body))
                old_no += 1
                old_left -= 1
                continue
            if tag == " " and old_left > 0 and new_left > 0:
                hunk.lines.append(DiffLine("ctx", old_no, new_no, body))
                old_no += 1
                new_no += 1
                old_left -= 1
                new_left -= 1
                continue
            # Counts and content disagree: abandon this hunk and re-read the line.
            old_left = new_left = 0

        if raw.startswith("diff --git "):
            current, hunk, pending_old = None, None, None
            parts = raw.split(" b/", 1)
            path = normalize_path(parts[1]) if len(parts) == 2 else ""
            if len(files) < MAX_FILES:
                current = FileDiff(path=path)
                files.append(current)
            continue
        if raw.startswith("Binary files ") or raw.startswith("GIT binary patch"):
            if current is not None:
                current.binary = True
            continue
        if raw.startswith("rename from "):
            if current is not None:
                current.old_path = normalize_path(raw[len("rename from ") :])
                current.status = "renamed"
            continue
        if raw.startswith("new file mode"):
            if current is not None:
                current.status = "added"
            continue
        if raw.startswith("deleted file mode"):
            if current is not None:
                current.status = "deleted"
            continue
        if raw.startswith("--- "):
            pending_old = raw[4:].split("\t")[0]
            if current is None and len(files) < MAX_FILES:
                # Plain unified diff without a "diff --git" line.
                current = FileDiff(path=normalize_path(pending_old))
                files.append(current)
            hunk = None
            continue
        if raw.startswith("+++ ") and current is not None:
            new_path = raw[4:].split("\t")[0]
            if new_path.strip() == _DEV_NULL:
                current.status = "deleted"
                if pending_old and pending_old.strip() != _DEV_NULL:
                    current.path = normalize_path(pending_old)
            else:
                current.path = normalize_path(new_path)
                if pending_old and pending_old.strip() == _DEV_NULL:
                    current.status = "added"
            pending_old = None
            continue
        m = _HUNK.match(raw)
        if m and current is not None:
            old_start, old_len = int(m[1]), int(m[2]) if m[2] is not None else 1
            new_start, new_len = int(m[3]), int(m[4]) if m[4] is not None else 1
            hunk = Hunk(header=raw, old_start=old_start, new_start=new_start)
            current.hunks.append(hunk)
            old_no, new_no = old_start, new_start
            old_left, new_left = old_len, new_len
    return files


@dataclass(frozen=True)
class Anchor:
    """Where a comment lands in the diff."""

    path: str
    line: int | None
    resolved: bool  # the cited path matched a file in the diff
    snapped: bool  # the cited line was moved to a nearby diff line


def _find_file(files: list[FileDiff], path: str) -> FileDiff | None:
    want = normalize_path(path)
    if not want:
        return None
    for f in files:
        if f.path == want:
            return f
    by_suffix = [
        f for f in files if f.path.endswith("/" + want) or want.endswith("/" + f.path)
    ]
    if len(by_suffix) == 1:
        return by_suffix[0]
    base = want.rsplit("/", 1)[-1]
    by_base = [f for f in files if f.path.rsplit("/", 1)[-1] == base]
    return by_base[0] if len(by_base) == 1 else None


def anchor(files: list[FileDiff], path: str, line: int | None) -> Anchor:
    """Resolves a cited ``path``/``line`` to a line GitHub will accept.

    The line is kept when it is in the diff, snapped to the nearest diff line
    within :data:`SNAP_WINDOW`, and otherwise dropped so the comment becomes a
    file-level finding instead of invalidating the whole review.
    """
    f = _find_file(files, path)
    if f is None:
        return Anchor(path=path, line=None, resolved=False, snapped=False)
    if not isinstance(line, int) or line <= 0:
        return Anchor(path=f.path, line=None, resolved=True, snapped=False)
    ok = f.commentable_lines()
    if line in ok:
        return Anchor(path=f.path, line=line, resolved=True, snapped=False)
    near = min(ok, key=lambda n: (abs(n - line), n), default=None)
    if near is not None and abs(near - line) <= SNAP_WINDOW:
        return Anchor(path=f.path, line=near, resolved=True, snapped=True)
    return Anchor(path=f.path, line=None, resolved=True, snapped=False)


def anchor_comments(
    diff_text: str, comments: list[ReviewCommentDraft]
) -> list[ReviewCommentDraft]:
    """Returns copies of ``comments`` with path/line anchored to the diff.

    An empty or unparseable diff leaves the comments untouched.
    """
    files = parse_unified_diff(diff_text or "")
    if not files:
        return list(comments)
    out: list[ReviewCommentDraft] = []
    for c in comments:
        a = anchor(files, c.path, c.line)
        out.append(c.model_copy(update={"path": a.path, "line": a.line}))
    return out


def anchor_dicts(
    diff_text: str, comments: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Like :func:`anchor_comments` for plain dicts with ``path`` and ``line``."""
    files = parse_unified_diff(diff_text or "")
    if not files:
        return list(comments)
    out: list[dict[str, Any]] = []
    for c in comments:
        a = anchor(files, str(c.get("path") or ""), c.get("line"))
        out.append({**c, "path": a.path, "line": a.line})
    return out


def diff_to_json(files: list[FileDiff]) -> list[dict[str, Any]]:
    """Serialises parsed files for the API / UI."""
    return [
        {
            "path": f.path,
            "oldPath": f.old_path,
            "status": f.status,
            "binary": f.binary,
            "additions": f.additions,
            "deletions": f.deletions,
            "hunks": [
                {
                    "header": h.header,
                    "oldStart": h.old_start,
                    "newStart": h.new_start,
                    "lines": [
                        {"kind": ln.kind, "old": ln.old, "new": ln.new, "text": ln.text}
                        for ln in h.lines
                    ],
                }
                for h in f.hunks
            ],
        }
        for f in files
    ]
