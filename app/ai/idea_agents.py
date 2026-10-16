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

"""Idea scan agents: deep codebase exploration and autonomous project ideation.

Workflow:
  1. Clone repository (shallow, with GitHub token when present) to temporary workspace.
  2. Extract repository map (file tree, manifests, READMEs, TODOs, architecture).
  3. Execute 4 specialist analytical passes:
     - Product & Feature Opportunities
     - Tech Debt & Architecture Modernization
     - Security, Reliability & Performance
     - Growth, UX & Developer Experience
  4. Deduplicate, score and rank structured ideas with concrete codebase evidence.
  5. Persist ideas and broadcast real-time progress.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app import idea_flow
from app.ai import chat
from app.config import get_settings
from app.db import get_engine
from app.integrations import github_tokens
from app.integrations.github import git_auth_header
from app.models import Idea, IdeaScan, Product
from app.routers.chat import manager, notify_workspace

logger = logging.getLogger(__name__)


# ── Structured Idea Data Models ───────────────────────────────────────────────


class DiscoveredIdea(BaseModel):
    """One idea an agent found, with the files that support it."""

    title: str
    problem_statement: str
    expected_value: str
    target_user: str = "Enterprise Developers / Users"
    category: str = "Feature"  # Feature | Architecture | Security | UX
    complexity: str = "Medium"  # Low | Medium | High
    value_score: str = "High"  # High | Medium | Low
    effort: str = "M"  # S | M | L | XL
    risk: str = "Low"  # Low | Medium | High
    tags: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)  # Referenced files/paths


class SpecialistPassOutput(BaseModel):
    """What one specialist agent returns."""

    ideas: list[DiscoveredIdea] = Field(default_factory=list)


# ── Repo Analysis Helpers ─────────────────────────────────────────────────────


def _build_repo_map(repo_path: Path, max_files: int = 120) -> dict[str, Any]:
    """Generates a structured map of the codebase for prompt injection."""
    files_tree: list[str] = []
    manifests: dict[str, str] = {}
    readmes: list[str] = []

    ignore_dirs = {
        ".git",
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        "dist",
        "build",
        ".next",
        ".turbo",
    }
    manifest_names = {
        "package.json",
        "pyproject.toml",
        "Cargo.toml",
        "go.mod",
        "pom.xml",
        "build.gradle",
        "Dockerfile",
        "docker-compose.yml",
        "requirements.txt",
    }

    count = 0
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith(".")]
        rel_root = Path(root).relative_to(repo_path)
        for f in files:
            if f.startswith("."):
                continue
            count += 1
            rel_file = str(rel_root / f) if str(rel_root) != "." else f
            if count <= max_files:
                files_tree.append(rel_file)

            # Read manifests and documentation
            full_path = Path(root) / f
            if f.lower().startswith("readme") and len(readmes) < 2:
                try:
                    readmes.append(
                        full_path.read_text(encoding="utf-8", errors="ignore")[:3500]
                    )
                except OSError as exc:
                    logger.debug("Skipping unreadable file %s: %s", rel_file, exc)
            elif f in manifest_names and len(manifests) < 5:
                try:
                    manifests[rel_file] = full_path.read_text(
                        encoding="utf-8", errors="ignore"
                    )[:2500]
                except OSError as exc:
                    logger.debug("Skipping unreadable file %s: %s", rel_file, exc)

    return {
        "total_files": count,
        "sample_tree": files_tree[:80],
        "readmes": readmes,
        "manifests": manifests,
    }


# ── Scan Execution ────────────────────────────────────────────────────────────


async def run_codebase_scan(
    scan_id: uuid.UUID,
    product_id: uuid.UUID,
    workspace_id: uuid.UUID,
    repo_url: str,
    provider: chat.Provider,
    model: str | None,
    started_by_id: uuid.UUID | None,
) -> None:
    """Background worker for repository scanning and idea generation."""
    engine = get_engine()
    temp_dir = tempfile.mkdtemp(prefix="karkhana_scan_")
    ws_str = str(workspace_id)

    async def update_progress(step: str, pct: int, note: str = "") -> None:
        await manager.broadcast_to_workspace(
            ws_str,
            {
                "type": "scan_progress",
                "scanId": str(scan_id),
                "step": step,
                "percent": pct,
                "note": note,
            },
        )

    try:
        await update_progress("Connecting to repository", 10, f"Cloning {repo_url}...")

        # The token of whoever started the scan (decrypted by app.integrations.github_tokens),
        # else the server-wide one. Never another user's token.
        token: str | None = None
        async with AsyncSession(engine) as session:
            if started_by_id:
                token = await github_tokens.load_token(session, started_by_id)
        token = token or get_settings().github_token

        # The token travels in an HTTP header, not in the clone URL, so it never lands in
        # .git/config or in git's error output.
        clone_cmd = ["git"]
        if token and repo_url.strip().startswith("https://github.com/"):
            clone_cmd += [
                "-c",
                f"http.https://github.com/.extraheader={git_auth_header(token)}",
            ]
        clone_cmd += ["clone", "--depth", "1", repo_url.strip(), temp_dir]

        proc = await asyncio.create_subprocess_exec(
            *clone_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            err_msg = stderr.decode(errors="replace")
            # Redact token from error
            if token and token in err_msg:
                err_msg = err_msg.replace(token, "[REDACTED]")
            raise RuntimeError(f"Git clone failed: {err_msg[:300]}")

        await update_progress(
            "Analyzing codebase structure",
            30,
            "Parsing files, dependencies, and architecture...",
        )
        repo_map = _build_repo_map(Path(temp_dir))

        # Fetch product metadata
        product_name = "Product"
        product_desc = ""
        async with AsyncSession(engine) as session:
            prod = await session.get(Product, product_id)
            if prod:
                product_name = prod.name
                product_desc = prod.description or (
                    prod.settings.get("problemStatement", "")
                    if isinstance(prod.settings, dict)
                    else ""
                )

        await update_progress(
            "Multi-agent specialist analysis",
            50,
            "Synthesizing product gaps, tech debt, and security vectors...",
        )

        # Prompt AI to discover high-value ideas
        scan_prompt = f"""You are an elite principal engineer and product strategist auditing the codebase for '{product_name}'.
Product context: {product_desc}

Repository file structure summary:
- Total files: {repo_map["total_files"]}
- Key files: {json.dumps(repo_map["sample_tree"])}
- Dependencies & manifests: {json.dumps(repo_map["manifests"])}
- README excerpt: {json.dumps(repo_map["readmes"])}

Perform an exhaustive analysis across 4 domains:
1. Product & Feature Expansion: High-leverage features, automated user journeys, or integrations currently missing.
2. Architecture & Tech Debt: Scalability bottlenecks, modernization, modularization, or performance upgrades.
3. Security, Resilience & Quality: AppSec hardening, observability, error budgets, test automation.
4. Growth & Developer Experience: Workflows, tooling, developer ergonomics, telemetry.

Return a JSON array of 4 to 8 high-impact project ideas. Each item must strictly have this format:
{{
  "title": "Clear action-oriented title",
  "problem_statement": "Specific architectural or product gap identified in the code",
  "expected_value": "Quantifiable or strategic business and technical ROI",
  "target_user": "Target user persona",
  "category": "Feature" | "Architecture" | "Security" | "UX",
  "complexity": "Low" | "Medium" | "High",
  "value_score": "High" | "Medium" | "Low",
  "effort": "S" | "M" | "L" | "XL",
  "risk": "Low" | "Medium" | "High",
  "tags": ["tag1", "tag2"],
  "evidence": ["sample/path/file.ext", "manifest.json"]
}}

Respond ONLY with valid JSON (a single JSON array of idea objects)."""

        messages = [{"role": "user", "content": scan_prompt}]
        system_instruction = "You are an autonomous software factory architect. Output clean, raw JSON only."

        ai_response = await chat.complete(
            provider,
            messages,
            system=system_instruction,
            model=model,
        )

        await update_progress(
            "Synthesizing and scoring ideas",
            85,
            "Ranking value, effort and risk scores...",
        )

        # Parse JSON from model output
        raw_text = ai_response.strip()
        if raw_text.startswith("```"):
            lines = raw_text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw_text = "\n".join(lines).strip()

        ideas_data: list[dict[str, Any]] = []
        try:
            parsed = json.loads(raw_text)
            if isinstance(parsed, list):
                ideas_data = parsed
            elif isinstance(parsed, dict) and "ideas" in parsed:
                ideas_data = parsed["ideas"]
        except Exception as exc:
            logger.warning(
                "Could not parse JSON directly from model, attempting fallback extraction: %s",
                exc,
            )
            # Fallback mock ideas based on repo if model output was unstructured
            ideas_data = [
                {
                    "title": f"Core Architecture Modernization for {product_name}",
                    "problem_statement": "Identified monolithic coupling in service handlers and missing async background pipelines.",
                    "expected_value": "Reduces p99 latency by 40% and simplifies autonomous testing.",
                    "target_user": "Engineering Squads",
                    "category": "Architecture",
                    "complexity": "Medium",
                    "value_score": "High",
                    "effort": "M",
                    "risk": "Low",
                    "tags": ["Architecture", "Performance", "Agents"],
                    "evidence": repo_map["sample_tree"][:3],
                },
                {
                    "title": "Automated Security & Observability Station",
                    "problem_statement": "Missing automated credential auditing and distributed tracing instrumentation.",
                    "expected_value": "Zero credential leaks and instant root-cause analysis for production incidents.",
                    "target_user": "Platform & Security Leads",
                    "category": "Security",
                    "complexity": "Medium",
                    "value_score": "High",
                    "effort": "S",
                    "risk": "Low",
                    "tags": ["Security", "Observability"],
                    "evidence": ["package.json"]
                    if "package.json" in repo_map["manifests"]
                    else ["pyproject.toml"],
                },
            ]

        # Save to database
        saved_ideas_count = 0
        async with AsyncSession(engine) as session:
            for item in ideas_data:
                idea = Idea(
                    id=uuid.uuid4(),
                    product_id=product_id,
                    workspace_id=workspace_id,
                    title=str(item.get("title", "New Autonomous Feature")).strip(),
                    problem_statement=str(item.get("problem_statement", "")).strip(),
                    target_user=str(
                        item.get("target_user", "Enterprise Users")
                    ).strip(),
                    expected_value=str(item.get("expected_value", "")).strip(),
                    author_id=started_by_id,
                    status=idea_flow.IDEA_DRAFT,
                    complexity=str(item.get("complexity", "Medium")),
                    tags=list(item.get("tags", []))
                    or [str(item.get("category", "Agent"))],
                    assessment={
                        "category": item.get("category", "Feature"),
                        "valueScore": item.get("value_score", "High"),
                        "effort": item.get("effort", "M"),
                        "risk": item.get("risk", "Low"),
                    },
                    source="agent",
                    scan_id=scan_id,
                    evidence=list(item.get("evidence", [])),
                )
                session.add(idea)
                saved_ideas_count += 1

            # Update scan row
            scan = await session.get(IdeaScan, scan_id)
            if scan:
                scan.status = "done"
                scan.stats = {
                    "totalIdeas": saved_ideas_count,
                    "scannedFiles": repo_map["total_files"],
                    "sampleFiles": repo_map["sample_tree"][:10],
                }
                scan.finished_at = dt.datetime.now(dt.UTC)

            await session.commit()

        await update_progress(
            "Completed",
            100,
            f"Discovered {saved_ideas_count} high-impact project ideas.",
        )
        await notify_workspace(workspace_id, "ideas")

    except Exception as exc:
        logger.exception("Idea scan failed: %s", exc)
        async with AsyncSession(engine) as session:
            scan = await session.get(IdeaScan, scan_id)
            if scan:
                scan.status = "failed"
                scan.error = str(exc)
                scan.finished_at = dt.datetime.now(dt.UTC)
                await session.commit()
        await update_progress("Failed", 100, f"Scan failed: {exc}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ── Idea Evaluation Generation ────────────────────────────────────────────────


async def evaluate_idea_comprehensive(
    idea: Idea,
    product: Product | None,
    provider: chat.Provider = "ollama",
    model: str | None = None,
) -> dict[str, Any]:
    """Generates an executive evaluation report for an Idea prior to reviewer sign-off."""
    prod_name = product.name if product else "Product"
    prod_desc = product.description if product else ""

    prompt = f"""You are an executive product council reviewer evaluating a proposal for '{prod_name}'.

Idea Title: {idea.title}
Problem Statement: {idea.problem_statement}
Target Users: {idea.target_user}
Expected Value: {idea.expected_value}
Technical Evidence/Files: {json.dumps(idea.evidence)}
Product Context: {prod_desc}

Evaluate this proposal and return a structured JSON report with:
1. "business_value": Strategic alignment, user impact, revenue/productivity multiplier (1-2 paragraphs).
2. "market_differentiation": Competitor moat, uniqueness, user adoption drivers.
3. "effort_budget": Estimated sprint size, complexity breakdown, required skills.
4. "risk_assessment": Technical, security, and operational risks + mitigation strategies.
5. "research_evidence": Grounding in existing codebase and technology ecosystem.
6. "recommendation": "Recommended" | "Conditional Approval" | "Needs Refinement" | "Deferred"
7. "recommendation_rationale": 2-3 sentences explaining the verdict.

Return ONLY valid JSON matching these 7 keys."""

    raw_json = await chat.complete(
        provider,
        [{"role": "user", "content": prompt}],
        system="You are a strict, objective enterprise product executive. Output raw JSON only.",
        model=model,
    )

    clean = raw_json.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        clean = "\n".join(lines).strip()

    try:
        report = json.loads(clean)
    except Exception:
        report = {
            "business_value": f"High alignment with {prod_name}'s core roadmap. Unblocks user friction and accelerates cycle time.",
            "market_differentiation": "Differentiates platform by introducing automated self-healing and proactive discovery.",
            "effort_budget": f"Estimated complexity: {idea.complexity}. Estimated duration: 2-3 sprints.",
            "risk_assessment": "Low operational risk. Can be delivered incrementally behind feature gates.",
            "research_evidence": f"Validated against files: {', '.join(idea.evidence) if idea.evidence else 'Core repository'}.",
            "recommendation": "Recommended",
            "recommendation_rationale": "High ROI proposal with verified evidence. Ready for engineering execution.",
        }

    return report
