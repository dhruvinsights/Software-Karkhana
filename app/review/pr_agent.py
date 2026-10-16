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

"""Adapter for The-PR-Agent/pr-agent (MIT), vendored in ``third_party/pr-agent``.

PR-Agent runs in its own virtualenv (``scripts/setup_pr_agent.sh``) as a
subprocess in plain-diff mode: no GitHub token is needed and the worker keeps
its no-credentials trust boundary. The model is the same provider the rest of
Karkhana uses (Ollama or Gemini).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from app.ai.errors import ModelError
from app.config import Settings, get_settings
from app.review.types import ReviewResult
from app.schemas import ReviewCommentDraft

_HIGH = re.compile(
    r"secur|inject|vulnerab|crash|data loss|corrupt|bug|incorrect|wrong|overflow|"
    r"auth|secret|credential|race condition|deadlock",
    re.I,
)
_MEDIUM = re.compile(
    r"error|exception|missing|validation|performance|edge case|null|none|"
    r"rounding|precision|concurren|test",
    re.I,
)


def _severity(header: str, content: str) -> str:
    """PR-Agent has no severity field; infer it from the issue text."""
    if _HIGH.search(header):
        return "high"
    if _MEDIUM.search(header) or _HIGH.search(content):
        return "medium"
    return "low"


def _model_env(settings: Settings) -> tuple[str, dict[str, str]]:
    """Environment that points PR-Agent at the configured model provider."""
    env = {"CONFIG__FALLBACK_MODELS": "[]"}
    if settings.llm_provider == "ollama":
        model = f"ollama/{settings.ollama_model}"
        env["OLLAMA__API_BASE"] = settings.ollama_base_url
        env["CONFIG__CUSTOM_MODEL_MAX_TOKENS"] = "32000"
    else:
        if not settings.gemini_api_key:
            raise ModelError(
                "PR-Agent needs GEMINI_API_KEY when LLM_PROVIDER=gemini "
                "(Vertex ADC is only supported by the ADK reviewer)."
            )
        model = f"gemini/{settings.gemini_model}"
        env["GOOGLE_AI_STUDIO__GEMINI_API_KEY"] = settings.gemini_api_key
    env["CONFIG__MODEL"] = model
    return model, env


def _python_path(settings: Settings) -> str:
    """The pr-agent virtualenv interpreter, or a clear setup error."""
    python = settings.pr_agent_python
    if not python or not Path(python).exists():
        raise ModelError(
            "PR_AGENT_PYTHON is not set or missing. Run scripts/setup_pr_agent.sh "
            "and set PR_AGENT_PYTHON to .venv-pr-agent/bin/python."
        )
    return python


def parse_review(data: dict[str, Any]) -> tuple[list[ReviewCommentDraft], str]:
    """Maps PR-Agent's JSON review to Karkhana comments and a one-line summary."""
    review = data.get("review") or {}
    comments: list[ReviewCommentDraft] = []
    for issue in review.get("key_issues_to_review") or []:
        header = str(issue.get("issue_header") or "").strip()
        content = str(issue.get("issue_content") or "").strip()
        body = f"{header}: {content}" if header and content else header or content
        if not body:
            continue
        line = issue.get("start_line")
        comments.append(
            ReviewCommentDraft(
                path=str(issue.get("relevant_file") or "(unknown)").strip(),
                line=int(line) if isinstance(line, int | float) and line > 0 else None,
                severity=_severity(header, content),
                body=body,
            )
        )
    security = str(review.get("security_concerns") or "").strip()
    if security and not security.lower().startswith(("no", "none", "n/a")):
        comments.append(
            ReviewCommentDraft(
                path="(security)", severity="high", body=f"Security concern: {security}"
            )
        )
    effort = review.get("estimated_effort_to_review_[1-5]")
    summary = f"Estimated review effort {effort}/5." if effort else ""
    if not comments:
        summary = (summary + " No key issues found.").strip()
    return comments, summary


# PR-Agent sees the change under review and the model credentials it needs,
# never the API's own secrets (session/run keys, DB, OAuth, encryption keys).
_PASSTHROUGH = frozenset({
    "PATH", "HOME", "USER", "LANG", "TZ", "TMPDIR", "TEMP", "TMP",
    "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "WINDIR", "USERPROFILE",
    "APPDATA", "LOCALAPPDATA", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT", "VIRTUAL_ENV",
})


def _passthrough_env() -> dict[str, str]:
    return {
        k: v
        for k, v in os.environ.items()
        if k in _PASSTHROUGH or k.startswith("LC_")
    }


async def review_diff(diff: str, *, title: str = "") -> ReviewResult:
    """Runs PR-Agent ``review`` on a unified diff and returns normalised comments."""
    settings = get_settings()
    python = await asyncio.to_thread(_python_path, settings)
    model, model_env = _model_env(settings)
    with tempfile.TemporaryDirectory(prefix="karkhana-review-") as tmp:
        diff_file, out_file = Path(tmp) / "change.diff", Path(tmp) / "review.json"
        diff_file.write_text(diff[:200_000])
        argv = [
            python, "-m", "pr_agent.cli",
            "--diff-file", str(diff_file),
            "--json-output", str(out_file),
            "review",
        ]  # fmt: skip
        env = {**_passthrough_env(), **model_env}
        proc = await asyncio.create_subprocess_exec(
            *argv,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            out, _ = await asyncio.wait_for(
                proc.communicate(), timeout=settings.review_timeout_s
            )
        except TimeoutError as exc:
            proc.kill()
            raise ModelError(
                f"PR-Agent timed out after {settings.review_timeout_s:.0f}s"
            ) from exc
        if proc.returncode != 0 or not out_file.exists():
            tail = out.decode(errors="replace")[-600:]
            raise ModelError(f"PR-Agent failed (exit {proc.returncode}): {tail}")
        comments, summary = parse_review(json.loads(out_file.read_text()))
    return ReviewResult(
        engine="pr-agent", model=model, comments=comments, summary=summary
    )
