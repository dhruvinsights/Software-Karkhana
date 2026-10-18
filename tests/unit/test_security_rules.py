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

"""OSV-Scanner output parsing and the security gate rules."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app import security_rules as sr

FIXTURE = Path(__file__).parent.parent / "fixtures" / "osv_sample.json"
PID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def report() -> dict:
    return json.loads(FIXTURE.read_text())


def test_severity_bands():
    assert sr.severity_from_score(10) == "CRITICAL"
    assert sr.severity_from_score(9.0) == "CRITICAL"
    assert sr.severity_from_score(8.9) == "HIGH"
    assert sr.severity_from_score(7.0) == "HIGH"
    assert sr.severity_from_score(6.9) == "MEDIUM"
    assert sr.severity_from_score(4.0) == "MEDIUM"
    assert sr.severity_from_score(3.9) == "LOW"
    assert sr.severity_from_score(0) == "LOW"


def test_parse_real_report_groups_duplicates(report):
    findings, packages = sr.parse_report(report, PID)
    # 4 packages, 11 vulnerability groups; PYSEC and GHSA records of one issue
    # are one finding, not two.
    assert len(findings) == 11
    assert packages == 4
    assert len({f.fingerprint for f in findings}) == 11
    assert len({f.osv_id for f in findings if f.package_name == "jinja2"}) == 3
    top = findings[0]
    assert top.cvss_score >= findings[-1].cvss_score  # sorted worst first
    assert top.severity == "HIGH"
    assert top.cve_id and top.cve_id.startswith("CVE-")


def test_parse_extracts_fix_version_and_component(report):
    findings, _ = sr.parse_report(report, PID)
    jinja = [f for f in findings if f.package_name == "jinja2"]
    assert jinja and all(f.ecosystem == "PyPI" for f in jinja)
    first = next(f for f in jinja if f.cvss_score == 8.6)
    assert first.fixed_version == "2.10.1"
    assert first.component == f"jinja2@{first.package_version}"
    assert "2.10.1" in first.advice
    assert first.manifest_path == "requirements.txt"


def test_parse_is_deterministic_and_project_scoped(report):
    a, _ = sr.parse_report(report, PID)
    b, _ = sr.parse_report(report, PID)
    other, _ = sr.parse_report(report, "00000000-0000-0000-0000-000000000002")
    assert [f.fingerprint for f in a] == [f.fingerprint for f in b]
    assert not {f.fingerprint for f in a} & {f.fingerprint for f in other}


def test_empty_report_has_no_findings():
    assert sr.parse_report({"results": []}, PID) == ([], 0)
    assert sr.parse_report({}, PID) == ([], 0)


def test_rejects_non_report():
    with pytest.raises(ValueError):
        sr.parse_report([], PID)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        sr.parse_report({"results": "nope"}, PID)


def _vuln(vid, fixed=None, **extra):
    events = [{"introduced": "0"}] + ([{"fixed": f} for f in fixed] if fixed else [])
    return {
        "id": vid,
        "aliases": extra.pop("aliases", []),
        "affected": [
            {"package": {"name": "left-pad", "ecosystem": "npm"}, "ranges": [{"type": "SEMVER", "events": events}]}
        ],
        **extra,
    }


def _report(vulns, group):
    return {
        "results": [
            {
                "source": {"path": "package-lock.json"},
                "packages": [
                    {
                        "package": {"name": "left-pad", "version": "1.0.0", "ecosystem": "npm"},
                        "groups": [group],
                        "vulnerabilities": vulns,
                    }
                ],
            }
        ]
    }


def test_severity_falls_back_to_advisory_label():
    vuln = _vuln("GHSA-aaaa", ["1.1.0"], database_specific={"severity": "MODERATE"})
    found, _ = sr.parse_report(_report([vuln], {"ids": ["GHSA-aaaa"], "aliases": []}), PID)
    assert (found[0].severity, found[0].cvss_score) == ("MEDIUM", 5.5)


def test_unknown_severity_is_medium_not_low():
    found, _ = sr.parse_report(
        _report([_vuln("OSV-1", ["1.1.0"])], {"ids": ["OSV-1"], "aliases": []}), PID
    )
    assert found[0].severity == "MEDIUM"


def test_critical_from_cvss_score():
    group = {"ids": ["GHSA-bbbb"], "aliases": ["CVE-2024-1"], "max_severity": "9.8"}
    found, _ = sr.parse_report(_report([_vuln("GHSA-bbbb", ["2.0.0"], summary="RCE")], group), PID)
    assert found[0].severity == "CRITICAL"
    assert found[0].osv_id == "CVE-2024-1"
    assert found[0].title.startswith("RCE")


def test_commit_sha_fix_is_not_an_upgrade_target():
    sha = "a" * 40
    vuln = _vuln("OSV-2", [sha])
    found, _ = sr.parse_report(_report([vuln], {"ids": ["OSV-2"], "aliases": []}), PID)
    assert found[0].fixed_version is None
    assert "No fixed version" in found[0].advice


def test_fix_picks_branch_above_installed_and_highest_across_records():
    a = _vuln("A", ["0.9.0", "1.2.0", "2.0.1"])
    b = _vuln("B", ["1.3.0"])
    assert sr.fixed_version([a, b], "left-pad", "npm", "1.0.0") == "1.3.0"
    assert sr.fixed_version([a], "left-pad", "npm", "1.0.0") == "1.2.0"
    assert sr.fixed_version([], "left-pad", "npm", "1.0.0") is None


def test_count_by_severity_always_has_every_key():
    assert sr.count_by_severity(["HIGH", "HIGH", "bogus"]) == {
        "CRITICAL": 0,
        "HIGH": 2,
        "MEDIUM": 0,
        "LOW": 0,
    }


def test_policy_defaults_and_overrides():
    assert sr.read_policy(None) == sr.SecurityPolicy()
    assert sr.read_policy({"security": "junk"}) == sr.SecurityPolicy()
    custom = sr.read_policy(
        {"security": {"blockSeverities": ["HIGH", "CRITICAL", "nope"], "requireScan": True, "autoScan": False}}
    )
    assert custom.block_severities == frozenset({"HIGH", "CRITICAL"})
    assert custom.require_scan and not custom.auto_scan
    # An empty / all-invalid list must never silently disable blocking.
    assert sr.read_policy({"security": {"blockSeverities": ["x"]}}).block_severities == {"CRITICAL"}


def test_gate_blocks_only_open_findings_of_blocking_severity():
    policy = sr.SecurityPolicy()
    assert sr.gate_blockers([("CRITICAL", "open")], policy, "succeeded") == [
        "1 open CRITICAL security finding(s)"
    ]
    assert sr.gate_blockers([("CRITICAL", "in_remediation")], policy, "succeeded")
    assert not sr.gate_blockers(
        [("CRITICAL", "waived"), ("CRITICAL", "verified_fixed"), ("HIGH", "open")],
        policy,
        "succeeded",
    )


def test_gate_with_high_policy():
    policy = sr.SecurityPolicy(block_severities=frozenset({"CRITICAL", "HIGH"}))
    reasons = sr.gate_blockers([("HIGH", "open"), ("CRITICAL", "open")], policy, None)
    assert len(reasons) == 2


def test_gate_require_scan():
    policy = sr.SecurityPolicy(require_scan=True)
    assert sr.gate_blockers([], policy, None) == ["no dependency scan has run yet"]
    assert sr.gate_blockers([], policy, "failed") == ["the latest dependency scan failed"]
    assert sr.gate_blockers([], policy, "running") == ["a dependency scan is still running"]
    assert sr.gate_blockers([], policy, "succeeded") == []
    # Without the policy a missing scan is not a blocker (opt-in gate).
    assert sr.gate_blockers([], sr.SecurityPolicy(), None) == []
