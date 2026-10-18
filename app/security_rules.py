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

"""Turning OSV-Scanner output into findings, and deciding when they block work.

Pure functions, unit-tested; no database, subprocess or network. The scan
service (``app.services.osv_scan``) runs the scanner and persists what this
module returns.

OSV-Scanner reports one *group* per real vulnerability (the PYSEC/GHSA/CVE
records that describe the same issue are merged), so a group becomes one
finding. Its ``max_severity`` is a CVSS base score and is the primary severity;
records without one fall back to the advisory's own label.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW")
OPEN_STATUSES = ("open", "in_remediation")
# Days a finding may stay open before it breaches its SLA.
SLA_DAYS = {"CRITICAL": 7, "HIGH": 30, "MEDIUM": 90, "LOW": 180}

# GitHub advisories label severity in words; MODERATE is GitHub's MEDIUM.
_LABEL_SCORE = {"CRITICAL": 9.5, "HIGH": 7.5, "MODERATE": 5.5, "MEDIUM": 5.5, "LOW": 2.5}
_UNKNOWN_SCORE = 5.0  # No score and no label: treat as MEDIUM, never silently LOW.
_SHA = re.compile(r"^[0-9a-f]{40}$")


@dataclass(frozen=True)
class ParsedFinding:
    """One vulnerability in one package, ready to be stored as a finding."""

    fingerprint: str
    osv_id: str
    cve_id: str | None
    aliases: list[str]
    title: str
    details: str
    severity: str
    cvss_score: float
    cwe_category: str
    package_name: str
    package_version: str
    ecosystem: str
    manifest_path: str
    fixed_version: str | None
    references: list[str] = field(default_factory=list)

    @property
    def component(self) -> str:
        """``name@version``: what the register shows as the affected component."""
        return f"{self.package_name}@{self.package_version}"

    @property
    def advice(self) -> str:
        """Deterministic remediation text, used until (or without) an AI fix."""
        return default_advice(self.package_name, self.package_version, self.fixed_version)


@dataclass(frozen=True)
class SecurityPolicy:
    """Per-project gate settings, read from ``Project.settings["security"]``."""

    block_severities: frozenset[str] = frozenset({"CRITICAL"})
    require_scan: bool = False
    auto_scan: bool = True


def severity_from_score(score: float) -> str:
    """Maps a CVSS base score to a severity label (CVSS v3/v4 qualitative bands)."""
    if score >= 9.0:
        return "CRITICAL"
    if score >= 7.0:
        return "HIGH"
    if score >= 4.0:
        return "MEDIUM"
    return "LOW"


def default_advice(name: str, version: str, fixed: str | None) -> str:
    """The plain upgrade instruction for a vulnerable package."""
    if fixed:
        return f"Upgrade {name} from {version} to {fixed} or later."
    return (
        f"No fixed version of {name} is published for {version}. "
        "Replace the dependency, pin a patched fork, or waive with a reason."
    )


def _version_key(version: str) -> tuple[int, ...]:
    return tuple(int(n) for n in re.findall(r"\d+", version))


def _fixed_candidates(vuln: dict[str, Any], name: str, ecosystem: str) -> list[str]:
    out: list[str] = []
    for affected in vuln.get("affected") or []:
        pkg = affected.get("package") or {}
        if pkg.get("name", name).lower() != name.lower():
            continue
        if pkg.get("ecosystem", ecosystem) != ecosystem:
            continue
        for rng in affected.get("ranges") or []:
            for event in rng.get("events") or []:
                fixed = event.get("fixed")
                # Git ranges are fixed by commit; those are not upgrade targets.
                if fixed and not _SHA.match(fixed) and _version_key(fixed):
                    out.append(fixed)
    return out


def fixed_version(
    vulns: Iterable[dict[str, Any]], name: str, ecosystem: str, installed: str
) -> str | None:
    """The lowest version that fixes every record in the group, if one exists.

    Per record, the smallest fix above the installed version (a record may list
    fixes on several release branches); across the group, the largest of those,
    because upgrading has to satisfy all of them at once.
    """
    have = _version_key(installed)
    per_record: list[str] = []
    for vuln in vulns:
        cands = _fixed_candidates(vuln, name, ecosystem)
        if not cands:
            continue
        above = [c for c in cands if _version_key(c) > have] or cands
        per_record.append(min(above, key=_version_key))
    return max(per_record, key=_version_key) if per_record else None


def _score_for(group: dict[str, Any], vulns: list[dict[str, Any]]) -> float:
    try:
        score = float(group.get("max_severity") or 0)
    except (TypeError, ValueError):
        score = 0.0
    if score > 0:
        return round(min(score, 10.0), 1)
    for vuln in vulns:
        label = str((vuln.get("database_specific") or {}).get("severity", "")).upper()
        if label in _LABEL_SCORE:
            return _LABEL_SCORE[label]
    return _UNKNOWN_SCORE


def _canonical_id(ids: list[str], aliases: list[str]) -> str:
    """A stable id for the group: its CVE if it has one, else the first id."""
    cves = sorted(a for a in [*ids, *aliases] if a.startswith("CVE-"))
    return cves[0] if cves else sorted(ids)[0]


def fingerprint(
    project_id: str, canonical_id: str, ecosystem: str, name: str, manifest: str
) -> str:
    """Identity of a finding across scans: same vuln, same package, same manifest.

    The installed version is left out on purpose, so upgrading to a version that
    is still vulnerable updates the finding instead of opening a second one.
    """
    raw = "|".join((project_id, canonical_id, ecosystem, name.lower(), manifest))
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _title(vulns: list[dict[str, Any]], osv_id: str, name: str) -> str:
    for vuln in vulns:
        if vuln.get("summary"):
            return f"{vuln['summary']} ({name})"[:300]
    for vuln in vulns:
        first = str(vuln.get("details") or "").strip().splitlines()
        if first and first[0]:
            return f"{first[0]} ({name})"[:300]
    return f"{osv_id} in {name}"


def _cwe(vulns: list[dict[str, Any]]) -> str:
    for vuln in vulns:
        ids = (vuln.get("database_specific") or {}).get("cwe_ids") or []
        if ids:
            return str(ids[0])
    return ""


def _references(vulns: list[dict[str, Any]]) -> list[str]:
    urls: list[str] = []
    for vuln in vulns:
        for ref in vuln.get("references") or []:
            url = ref.get("url")
            if url and url not in urls and url.startswith("https://"):
                urls.append(url)
    return urls[:8]


def parse_report(report: dict[str, Any], project_id: str) -> tuple[list[ParsedFinding], int]:
    """Parses ``osv-scanner --format json`` output.

    Returns the findings (one per vulnerability group per package per manifest)
    and the number of distinct vulnerable packages. Raises ``ValueError`` when
    the document is not scanner output at all.
    """
    if not isinstance(report, dict) or not isinstance(report.get("results", []), list):
        raise ValueError("not an osv-scanner report")
    found: dict[str, ParsedFinding] = {}
    packages: set[tuple[str, str, str]] = set()
    for result in report.get("results", []):
        manifest = str((result.get("source") or {}).get("path", ""))
        for entry in result.get("packages") or []:
            pkg = entry.get("package") or {}
            name = str(pkg.get("name", ""))
            version = str(pkg.get("version", ""))
            ecosystem = str(pkg.get("ecosystem", ""))
            if not name:
                continue
            by_id = {v.get("id"): v for v in entry.get("vulnerabilities") or []}
            groups = entry.get("groups") or [
                {"ids": [vid], "aliases": v.get("aliases", [])} for vid, v in by_id.items()
            ]
            for group in groups:
                ids = [i for i in group.get("ids", []) if i]
                vulns = [by_id[i] for i in ids if i in by_id]
                if not vulns:
                    continue
                aliases = sorted({*group.get("aliases", []), *ids})
                canon = _canonical_id(ids, aliases)
                score = _score_for(group, vulns)
                finding = ParsedFinding(
                    fingerprint=fingerprint(project_id, canon, ecosystem, name, manifest),
                    osv_id=canon,
                    cve_id=next((a for a in aliases if a.startswith("CVE-")), None),
                    aliases=aliases,
                    title=_title(vulns, canon, name),
                    details=str(vulns[0].get("details") or "")[:4000],
                    severity=severity_from_score(score),
                    cvss_score=score,
                    cwe_category=_cwe(vulns),
                    package_name=name,
                    package_version=version,
                    ecosystem=ecosystem,
                    manifest_path=manifest,
                    fixed_version=fixed_version(vulns, name, ecosystem, version),
                    references=_references(vulns),
                )
                found[finding.fingerprint] = finding
                packages.add((ecosystem, name, version))
    ordered = sorted(found.values(), key=lambda f: (-f.cvss_score, f.package_name, f.osv_id))
    return ordered, len(packages)


def count_by_severity(severities: Iterable[str]) -> dict[str, int]:
    """``{"CRITICAL": n, ...}`` with every severity present, even at zero."""
    counts = dict.fromkeys(SEVERITIES, 0)
    for sev in severities:
        if sev in counts:
            counts[sev] += 1
    return counts


def read_policy(project_settings: dict[str, Any] | None) -> SecurityPolicy:
    """Reads the gate policy from ``Project.settings["security"]``; bad values use defaults."""
    raw = (project_settings or {}).get("security")
    if not isinstance(raw, dict):
        return SecurityPolicy()
    sev = raw.get("blockSeverities")
    block = frozenset(s for s in sev if s in SEVERITIES) if isinstance(sev, list) else None
    return SecurityPolicy(
        block_severities=block or SecurityPolicy().block_severities,
        require_scan=bool(raw.get("requireScan", False)),
        auto_scan=bool(raw.get("autoScan", True)),
    )


def gate_blockers(
    findings: Iterable[tuple[str, str]],
    policy: SecurityPolicy,
    last_scan_status: str | None,
) -> list[str]:
    """Reasons the security gate is closed; an empty list means it is open.

    ``findings`` is ``(severity, status)`` for every finding on the project.
    Waived and verified-fixed findings never block. When the policy requires a
    scan, a project that was never scanned, or whose latest scan failed, is
    closed too: "no result" is not a pass.
    """
    reasons: list[str] = []
    open_counts = count_by_severity(
        sev
        for sev, status in findings
        if status in OPEN_STATUSES and sev in policy.block_severities
    )
    for sev in SEVERITIES:
        if open_counts[sev]:
            reasons.append(f"{open_counts[sev]} open {sev} security finding(s)")
    if policy.require_scan:
        if last_scan_status is None:
            reasons.append("no dependency scan has run yet")
        elif last_scan_status == "failed":
            reasons.append("the latest dependency scan failed")
        elif last_scan_status in ("queued", "running"):
            reasons.append("a dependency scan is still running")
    return reasons
