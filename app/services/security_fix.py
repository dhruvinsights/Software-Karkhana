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

"""Fix suggestions for dependency findings.

The deterministic part ("upgrade X to Y") always comes from the scanner's own
data. The model only adds the part that needs reading: what the vulnerability
means for this project, what could break in the upgrade, and how to check it.
Without a model, or when it fails, the deterministic advice is returned and
says so; a suggestion is never invented and never applied automatically.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from app.ai import llm
from app.ai.errors import ModelError
from app.models import SecurityFinding

logger = logging.getLogger(__name__)

SYSTEM = (
    "You are an application security engineer helping a developer fix one "
    "vulnerable dependency. Use ONLY the facts given. Do not invent version "
    "numbers, CVE details or APIs: if a fixed version is not given, say a "
    "version must be chosen from the package's release notes. Answer in plain "
    "Markdown with exactly these sections: '### Why it matters' (2-3 sentences "
    "in terms of this package), '### Fix' (the exact manifest change or "
    "command), '### Watch for' (breaking changes to check, 2-4 bullets), "
    "'### Verify' (how to confirm the fix, 2-3 bullets). No preamble."
)


def facts(f: SecurityFinding) -> str:
    """The finding as the prompt sees it: only what the scanner reported."""
    lines = [
        f"Package: {f.package_name or f.affected_component} ({f.ecosystem or 'unknown ecosystem'})",
        f"Installed version: {f.package_version or 'unknown'}",
        f"Fixed version: {f.fixed_version or 'none published'}",
        f"Manifest: {f.manifest_path or 'unknown'}",
        f"Advisory: {f.osv_id or f.cve_id or 'unknown'} (aliases: {', '.join(f.aliases or []) or 'none'})",
        f"Severity: {f.severity} (CVSS {float(f.cvss_score or 0):.1f})",
        f"Title: {f.title}",
    ]
    if f.cwe_category:
        lines.append(f"Weakness: {f.cwe_category}")
    return "\n".join(lines)


def baseline(f: SecurityFinding) -> dict[str, Any]:
    """The suggestion without a model: the scanner's own upgrade advice."""
    return {
        "source": "scanner",
        "summary": f.remediation_advice,
        "markdown": f"### Fix\n\n{f.remediation_advice}\n",
        "model": None,
        "at": dt.datetime.now(dt.UTC).isoformat(),
        "label": "From the scanner's advisory data",
    }


async def suggest(f: SecurityFinding) -> dict[str, Any]:
    """Returns (and does not store) a fix suggestion for ``f``."""
    if not llm.text_configured():
        return {**baseline(f), "note": "No AI model is configured, so this is the plain upgrade advice."}
    try:
        text = await llm.generate_text(
            messages=[{"role": "user", "content": facts(f)}],
            system=SYSTEM,
            kind="security_fix",
            temperature=0.2,
            timeout_s=60,
        )
    except ModelError as exc:
        logger.warning("Fix suggestion for finding %s failed: %s", f.id, exc)
        return {**baseline(f), "note": "The AI model could not answer, so this is the plain upgrade advice."}
    return {
        "source": "ai",
        "summary": f.remediation_advice,
        "markdown": text.strip(),
        "model": llm.chat_model_name(),
        "at": dt.datetime.now(dt.UTC).isoformat(),
        "label": "AI-generated, unverified",
    }
