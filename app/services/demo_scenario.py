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

"""The demo workspace: a health plan shipping its FHIR Prior Authorization API.

The scenario follows a real regulatory deadline. The CMS Interoperability and
Prior Authorization Final Rule (CMS-0057-F) requires Medicare Advantage,
Medicaid/CHIP and marketplace payers to answer expedited prior authorization
requests within 72 hours and standard ones within 7 days (since January 2026),
and to run a FHIR Prior Authorization API built on the HL7 Da Vinci CRD, DTR
and PAS guides by January 1, 2027.

"Arcwell Health" and every person in it are fictional. Everything is written
as real rows through the ORM, so every station of the platform shows and
acts on them exactly as it would for a real team: the guest can approve an
idea, triage AI review comments, approve and merge a pull request, run the
coding agent on a ready story, sign off QA and work security findings.

:func:`seed` is the only entry point. It is deterministic apart from ids and
timestamps, and it writes one sandbox at a time inside the caller's transaction.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import issue_rules, ledger
from app.models import (
    ActivityEvent,
    Adr,
    Approval,
    ChatChannel,
    ChatMessage,
    ContextEntry,
    Epic,
    Idea,
    IdeaApproval,
    Issue,
    Learning,
    Product,
    Project,
    ProjectMember,
    PullRequest,
    QaSuggestion,
    Release,
    ReviewComment,
    Run,
    SecurityFinding,
    SecurityScan,
    Task,
    TestScenario,
    User,
    Workspace,
    WorkspaceMember,
)

SCENARIO = "clearauth-prior-auth"
WORKSPACE_NAME = "Arcwell Health · Demo"
PRODUCT_NAME = "ClearAuth"
PROJECT_NAME = "Prior Auth API · CMS-0057-F Go-Live"

# Fictional teammates, shared by every sandbox. They can never sign in: they
# are inactive guests (see app.services.demo_sandbox).
PERSONA_DOMAIN = "personas.karkhana.invalid"


@dataclass(frozen=True)
class Persona:
    """A fictional teammate in the demo."""

    key: str
    name: str
    role: str
    title: str


PERSONAS: tuple[Persona, ...] = (
    Persona("asha", "Asha Raman", "director", "VP Engineering"),
    Persona("daniel", "Daniel Okafor", "pm", "Product Manager"),
    Persona("meilin", "Mei Lin Chen", "architect", "Solutions Architect"),
    Persona("rafael", "Rafael Souza", "developer", "Senior Backend Engineer"),
    Persona("priyanka", "Priyanka Iyer", "developer", "Frontend Engineer"),
    Persona("grace", "Grace Whitfield", "qa", "QA Lead"),
    Persona("omar", "Omar Haddad", "security", "AppSec Engineer"),
    Persona("lena", "Lena Fischer", "release_manager", "Release Manager"),
)


def persona_email(key: str) -> str:
    """The fixed address of a persona (an unroutable ``.invalid`` domain)."""
    return f"{key}@{PERSONA_DOMAIN}"


@dataclass
class Seeded:
    """Ids of the records the tour and the tests point at."""

    workspace_id: uuid.UUID
    product_id: uuid.UUID
    project_id: uuid.UUID
    open_pr_id: uuid.UUID
    ready_task_id: uuid.UUID
    pending_idea_id: uuid.UUID
    counts: dict[str, int] = field(default_factory=dict)


def _ago(now: dt.datetime, days: float = 0, hours: float = 0) -> dt.datetime:
    return now - dt.timedelta(days=days, hours=hours)


def new_file_diff(path: str, content: str) -> str:
    """A unified diff that adds ``path`` with ``content`` (counts always correct)."""
    lines = content.rstrip("\n").split("\n")
    body = "".join(f"+{line}\n" for line in lines)
    return (
        f"diff --git a/{path} b/{path}\n"
        "new file mode 100644\n"
        "--- /dev/null\n"
        f"+++ b/{path}\n"
        f"@@ -0,0 +1,{len(lines)} @@\n"
        f"{body}"
    )


# ── Code the agents "wrote" (shown in the PR diff viewer) ─────────────────────

SLA_PY = '''"""Decision due-by times for prior authorization requests (CMS-0057-F)."""

from __future__ import annotations

import datetime as dt
from enum import StrEnum

EXPEDITED_HOURS = 72
STANDARD_DAYS = 7


class Urgency(StrEnum):
    EXPEDITED = "expedited"
    STANDARD = "standard"


def due_by(received_complete_at: dt.datetime, urgency: Urgency, tz: str | None = None) -> dt.datetime:
    """When the payer must decide. The clock starts when the request is complete."""
    if received_complete_at.tzinfo is None:
        raise ValueError("received_complete_at must be timezone-aware")
    if urgency is Urgency.EXPEDITED:
        return received_complete_at + dt.timedelta(hours=EXPEDITED_HOURS)
    return received_complete_at + dt.timedelta(days=STANDARD_DAYS)


def breach_risk(now: dt.datetime, due: dt.datetime) -> str:
    """green until 50% of the window is used, amber until 85%, then red."""
    remaining = (due - now).total_seconds()
    if remaining <= 0:
        return "breached"
    window = EXPEDITED_HOURS * 3600
    used = 1 - remaining / window
    if used < 0.5:
        return "green"
    return "amber" if used < 0.85 else "red"
'''

SLA_TEST_PY = '''import datetime as dt

import pytest

from pas_gateway.sla import Urgency, breach_risk, due_by

T0 = dt.datetime(2026, 11, 2, 9, 0, tzinfo=dt.UTC)


def test_expedited_is_72_hours():
    assert due_by(T0, Urgency.EXPEDITED) == T0 + dt.timedelta(hours=72)


def test_standard_is_7_calendar_days():
    assert due_by(T0, Urgency.STANDARD) == T0 + dt.timedelta(days=7)


def test_naive_timestamps_are_rejected():
    with pytest.raises(ValueError):
        due_by(T0.replace(tzinfo=None), Urgency.STANDARD)


def test_breach_risk_bands():
    due = due_by(T0, Urgency.EXPEDITED)
    assert breach_risk(T0, due) == "green"
    assert breach_risk(due - dt.timedelta(hours=5), due) == "red"
    assert breach_risk(due + dt.timedelta(minutes=1), due) == "breached"
'''

SUBMIT_PY = '''"""POST /Claim/$submit: accept a Da Vinci PAS request bundle."""

from fastapi import APIRouter, HTTPException

from pas_gateway.fhir import validate_bundle

router = APIRouter()

PAS_PROFILE = "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-pas-request-bundle"


@router.post("/Claim/$submit")
async def submit(bundle: dict) -> dict:
    issues = validate_bundle(bundle, profile=PAS_PROFILE)
    if issues:
        raise HTTPException(422, {"resourceType": "OperationOutcome", "issue": issues})
    return {"resourceType": "Bundle", "type": "collection", "entry": []}
'''

RESPONSE_PY = '''"""ClaimResponse for a pended prior authorization request."""


def pended_response(claim_id: str, tracking: str) -> dict:
    return {
        "resourceType": "ClaimResponse",
        "status": "active",
        "outcome": "queued",
        "request": {"reference": f"Claim/{claim_id}"},
        "preAuthRef": tracking,
    }
'''

PATCH_SLA = new_file_diff("pas_gateway/sla.py", SLA_PY) + new_file_diff("tests/test_sla.py", SLA_TEST_PY)
PATCH_SUBMIT = new_file_diff("pas_gateway/routes/submit.py", SUBMIT_PY)
PATCH_RESPONSE = new_file_diff("pas_gateway/claim_response.py", RESPONSE_PY)


def _suites(unit: tuple[int, int], integration: tuple[int, int] | None = None) -> list[dict]:
    out = [
        {
            "suite": "unit",
            "status": "passed" if unit[1] == 0 else "failed",
            "passed": unit[0],
            "failed": unit[1],
            "total": unit[0] + unit[1],
            "command": "pytest tests/unit -q",
            "durationMs": 8400,
        }
    ]
    if integration:
        out.append(
            {
                "suite": "integration",
                "status": "passed" if integration[1] == 0 else "failed",
                "passed": integration[0],
                "failed": integration[1],
                "total": integration[0] + integration[1],
                "command": "pytest tests/integration -q",
                "durationMs": 31200,
            }
        )
    return out


# ── Seeding ───────────────────────────────────────────────────────────────────


async def ensure_personas(session: AsyncSession) -> dict[str, User]:
    """Creates the shared fictional teammates once; they can never sign in."""
    users: dict[str, User] = {}
    for p in PERSONAS:
        email = persona_email(p.key)
        u = await session.scalar(select(User).where(User.email == email))
        if u is None:
            u = User(
                id=uuid.uuid4(),
                email=email,
                display_name=p.name,
                role=p.role,
                hashed_password=None,
                is_active=False,
                is_verified=False,
                is_guest=True,
            )
            session.add(u)
        users[p.key] = u
    await session.flush()
    return users


async def seed(session: AsyncSession, *, workspace: Workspace, guest: User) -> Seeded:
    """Fills ``workspace`` (owned by ``guest``) with the ClearAuth scenario."""
    now = dt.datetime.now(dt.UTC)
    people = await ensure_personas(session)
    p = people  # short alias for the many references below
    ws = workspace.id

    # ── Team ──────────────────────────────────────────────────────────────
    session.add(
        WorkspaceMember(
            id=uuid.uuid4(), workspace_id=ws, user_id=guest.id, role="lead", is_owner=True, access="owner"
        )
    )
    for persona in PERSONAS:
        session.add(
            WorkspaceMember(
                id=uuid.uuid4(),
                workspace_id=ws,
                user_id=p[persona.key].id,
                role=persona.role,
                is_owner=False,
                access="reviewer" if persona.key == "asha" else "member",
                joined_at=_ago(now, days=60),
            )
        )

    # ── Product ───────────────────────────────────────────────────────────
    product = Product(
        id=uuid.uuid4(),
        workspace_id=ws,
        name=PRODUCT_NAME,
        code="CLRA",
        domain="Healthcare · Payer",
        description=(
            "Arcwell Health's prior authorization platform for its Medicare Advantage and "
            "Medicaid lines: intake, clinical review, decisions and the FHIR APIs providers call."
        ),
        status="active",
        created_by=p["daniel"].id,
        created_at=_ago(now, days=58),
        settings={
            "problemStatement": (
                "Providers wait days for prior authorization decisions sent by fax and portal. "
                "CMS-0057-F now requires 72-hour expedited and 7-day standard decisions, specific "
                "denial reasons, and a FHIR Prior Authorization API by January 1, 2027."
            ),
            "targetUsers": "Provider offices, Arcwell utilization-management nurses and medical directors",
            "techStack": ["Python 3.12 · FastAPI", "HAPI FHIR R4", "PostgreSQL 16", "Kafka", "React 18", "Cloud Run"],
            "repositoryUrl": "",
            "keyFeatures": [
                "Da Vinci PAS $submit and $inquire",
                "CRD hooks at order-sign",
                "DTR questionnaires",
                "72h / 7d decision SLA engine",
                "Public PA metrics reporting",
            ],
            "constraints": [
                "HIPAA: PHI encrypted at rest and never logged",
                "Go-live before 2027-01-01",
                "Every decision auditable with reviewer identity",
            ],
            "teamSpaces": ["product", "design", "architecture", "developer", "qa", "devops", "security", "release"],
            "reviewerIds": [str(guest.id), str(p["asha"].id)],
        },
    )
    session.add(product)
    await session.flush()

    # ── Ideas ─────────────────────────────────────────────────────────────
    def assessment(score: int, summary: str, risks: list[str], arch: str) -> dict:
        return {
            "overallScore": score,
            "scores": {
                "userValue": min(score + 6, 98),
                "strategicFit": min(score + 8, 99),
                "feasibility": score - 4,
                "technicalComplexity": 100 - score + 20,
                "costRoi": score - 2,
                "riskCompliance": min(score + 5, 97),
                "deliverySpeed": score - 10,
                "evidenceQuality": score - 6,
            },
            "executiveSummary": summary,
            "keyRisks": risks,
            "recommendedArchitecture": arch,
            "openQuestions": ["Which EHR vendors pilot CRD first?", "Who owns the gold-card list?"],
        }

    idea_pas = Idea(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=ws,
        title="FHIR Prior Authorization API (Da Vinci PAS)",
        problem_statement=(
            "Providers cannot submit prior authorization electronically. CMS-0057-F requires a FHIR "
            "Prior Authorization API on Da Vinci CRD, DTR and PAS by January 1, 2027."
        ),
        target_user="Provider offices and EHR vendors",
        expected_value="Regulatory compliance; 60% fewer fax submissions; decisions inside 72h / 7d.",
        author_id=p["daniel"].id,
        status="promoted",
        complexity="High",
        tags=["regulatory", "fhir", "cms-0057-f"],
        assessment=assessment(
            88,
            "Mandatory by 2027-01-01 and on the critical path for every downstream API. Build on HAPI FHIR.",
            ["EHR vendor readiness varies", "Clinical criteria licensing for DTR"],
            "HAPI FHIR facade → PAS gateway (FastAPI) → Kafka → UM workflow; PHI in Cloud SQL with KMS.",
        ),
        source="manual",
        scope="project",
        created_at=_ago(now, days=55),
    )
    idea_gold = Idea(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=ws,
        title="Real-time gold-carding for high-approval providers",
        problem_statement=(
            "Providers with >92% approval rates on a service still wait for review. Auto-approve "
            "their requests at submit time and re-evaluate the list quarterly."
        ),
        target_user="High-volume provider groups",
        expected_value="~18% of requests decided instantly; nurse reviewers focus on real risk.",
        author_id=p["daniel"].id,
        status="pending_approval",
        complexity="Medium",
        tags=["automation", "provider-experience"],
        assessment=assessment(
            81,
            "Strong ROI and provider goodwill. Needs a governance owner and a quarterly recalculation job.",
            ["Approval-rate gaming", "State-specific gold-card laws differ"],
            "Nightly Spark job computes eligibility; PAS gateway checks the list before queueing.",
        ),
        source="manual",
        scope="feature",
        parent_id=idea_pas.id,
        created_at=_ago(now, days=4),
    )
    idea_denial = Idea(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=ws,
        title="Denial reason explainer with cited clinical criteria",
        problem_statement="CMS-0057-F requires a specific reason for every denial. Reviewers write them by hand today.",
        target_user="Medical directors and provider offices",
        expected_value="Consistent, criteria-cited denial letters in seconds.",
        author_id=p["meilin"].id,
        status="approved",
        complexity="Medium",
        tags=["ai-assist", "compliance"],
        assessment=assessment(
            77,
            "Drafts reasons from the clinical criteria the reviewer used; a human always signs.",
            ["Hallucinated citations", "Criteria licensing"],
            "Retrieval over licensed criteria; draft-only; reviewer approves every letter.",
        ),
        source="manual",
        scope="feature",
        created_at=_ago(now, days=12),
    )
    idea_bulk = Idea(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=ws,
        title="Provider Access API: bulk export for attributed patients",
        problem_statement="Providers need claims and PA history for their attributed members via FHIR Bulk Data.",
        target_user="Value-based care provider groups",
        expected_value="Second CMS-0057-F API off the same FHIR foundation.",
        author_id=p["meilin"].id,
        status="draft",
        complexity="High",
        tags=["fhir", "bulk-data"],
        source="agent",
        evidence=["pas_gateway/fhir/capability.py", "docs/adr/0001-hapi-fhir-facade.md"],
        scope="feature",
        created_at=_ago(now, days=1),
    )
    idea_ocr = Idea(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=ws,
        title="Replace fax intake with an OCR pipeline",
        problem_statement="Digitize faxed requests with OCR to feed the same queue.",
        target_user="Intake coordinators",
        expected_value="Less manual keying.",
        author_id=p["rafael"].id,
        status="rejected",
        complexity="Medium",
        tags=["intake"],
        source="manual",
        scope="feature",
        created_at=_ago(now, days=30),
    )
    session.add_all([idea_pas, idea_gold, idea_denial, idea_bulk, idea_ocr])
    await session.flush()

    for idea, reviewer, status, reason, requested_days in (
        (idea_pas, p["asha"], "approved", "Mandatory. Fund it.", 54),
        (idea_denial, p["asha"], "approved", "Human signs every letter: approved.", 11),
        (idea_ocr, p["asha"], "rejected", "PAS makes fax a shrinking channel; do not invest.", 29),
        (idea_gold, p["asha"], "approved", "Good if Legal confirms state rules.", 3),
        # Waiting on the guest: the Reviewer space shows it.
        (idea_gold, guest, "pending", None, 3),
    ):
        session.add(
            IdeaApproval(
                idea_id=idea.id,
                reviewer_id=reviewer.id,
                requested_by=p["daniel"].id,
                status=status,
                note="Please review before Thursday's portfolio sync." if status == "pending" else None,
                reason=reason,
                requested_at=_ago(now, days=requested_days),
                decided_at=None if status == "pending" else _ago(now, days=requested_days - 1),
            )
        )

    # ── Project ───────────────────────────────────────────────────────────
    project = Project(
        id=uuid.uuid4(),
        product_id=product.id,
        workspace_id=ws,
        lead_id=p["meilin"].id,
        name=PROJECT_NAME,
        idea_text=idea_pas.problem_statement,
        created_by=p["daniel"].id,
        # Mid-flight: a PR is open and waiting for review triage.
        stage="review",
        stage_status="triage",
        idea_id=idea_pas.id,
        created_at=_ago(now, days=50),
        settings={
            "code": "PAAPI",
            "description": (
                "Ship the Da Vinci PAS, CRD and DTR APIs with a 72h / 7d decision SLA engine before "
                "the January 1, 2027 CMS-0057-F deadline."
            ),
            "target_release_date": "2026-12-15",
            "teams": ["Payer Platform", "Clinical Apps", "AppSec"],
            "access": "open",
        },
    )
    session.add(project)
    await session.flush()
    idea_pas.project_id = project.id

    session.add(ProjectMember(project_id=project.id, user_id=guest.id, role="lead", is_lead=True))
    for persona in PERSONAS:
        session.add(
            ProjectMember(
                project_id=project.id,
                user_id=p[persona.key].id,
                role=persona.role,
                is_lead=persona.key == "meilin",
                joined_at=_ago(now, days=49),
            )
        )

    # ── Epics and stories ─────────────────────────────────────────────────
    epic_specs = [
        ("PAS claim submission and response", "Accept $submit bundles and answer with ClaimResponse.", "a FHIR Prior Authorization API"),
        ("Coverage requirements discovery (CRD)", "CDS Hooks that tell the provider what is needed at order time.", "built on Da Vinci CRD, DTR and PAS"),
        ("Decision timeframes and SLA engine", "72-hour expedited and 7-day standard clocks, escalation and reporting.", "72 hours for expedited and 7 days for standard"),
        ("Security, audit and HIPAA controls", "PHI protection and a decision audit trail.", "every decision auditable with reviewer identity"),
    ]
    epics: list[Epic] = []
    epic_issues: list[Issue] = []
    number = 0

    def next_number() -> int:
        nonlocal number
        number += 1
        return number

    for pos, (title, desc, quote) in enumerate(epic_specs):
        e = Epic(id=uuid.uuid4(), project_id=project.id, title=title, description=desc, source_quote=quote, position=pos)
        session.add(e)
        epics.append(e)
    await session.flush()
    for e in epics:
        ei = Issue(
            id=uuid.uuid4(),
            project_id=project.id,
            number=next_number(),
            title=e.title,
            description=e.description,
            type="epic",
            priority="P1",
            status="in_progress",
            source="plan",
            labels=["plan"],
            reporter_id=p["daniel"].id,
            epic_id=e.id,
            source_quote=e.source_quote,
            created_at=_ago(now, days=48),
            updated_at=_ago(now, days=2),
        )
        session.add(ei)
        epic_issues.append(ei)
    await session.flush()

    # (epic idx, title, criteria, issue status, task status, assignee, priority, labels, estimate)
    story_specs = [
        (0, "Accept PAS Claim bundle at $submit and validate against PAS profiles",
         ["Valid PAS request bundles return 200 with a ClaimResponse", "Invalid bundles return 422 with an OperationOutcome", "Profile version is pinned"],
         "done", "done", "rafael", "P0", ["layer:backend"], 5),
        (0, "Return a pended ClaimResponse with a tracking number",
         ["Pended requests return outcome=queued", "preAuthRef carries the tracking number", "preAuthPeriod is present when known"],
         "ready_for_qa", "done", "rafael", "P0", ["layer:backend"], 3),
        (2, "Compute decision due-by from urgency (72h expedited / 7 days standard)",
         ["Expedited due-by is 72 hours after the request is complete", "Standard due-by is 7 calendar days", "Naive timestamps are rejected"],
         "in_review", "review", "rafael", "P0", ["layer:backend"], 3),
        (2, "Escalate requests nearing an SLA breach to clinical reviewers",
         ["Requests at 85% of their window page the on-call reviewer", "Escalations are idempotent", "Breaches are recorded for public reporting"],
         "ready", "ready", "rafael", "P1", ["layer:backend"], 5),
        (1, "CRD order-sign hook returns coverage cards for imaging orders",
         ["order-sign for CPT 72148 returns a card saying PA is required", "Cards link to the DTR questionnaire", "Responds in under 500 ms p95"],
         "ready", "ready", "guest", "P1", ["layer:backend"], 5),
        (1, "DTR questionnaire package for MRI lumbar spine",
         ["Questionnaire validates against the DTR profile", "Pre-populates from the patient's chart"],
         "backlog", "backlog", None, "P2", ["layer:backend"], 8),
        (3, "Field-level encryption for PHI in the request store",
         ["Member name, DOB and diagnosis codes are envelope-encrypted with Cloud KMS", "Key rotation is documented"],
         "ready", "ready", "omar", "P1", ["layer:backend"], 5),
        (3, "Immutable audit trail of every decision with reviewer identity",
         ["Each decision records reviewer, criteria and timestamps", "Audit records cannot be edited"],
         "backlog", "backlog", None, "P1", ["layer:backend"], 3),
        (0, "Provider portal: status timeline for submitted requests",
         ["Shows received, pended, decided with timestamps", "Displays the due-by countdown", "Accessible (WCAG 2.2 AA)"],
         "ready", "ready", "priyanka", "P2", ["layer:frontend"], 5),
        (2, "Public prior authorization metrics export (CY2026)",
         ["Approval, denial and average-time metrics per CMS template", "Published on the public site by March 31"],
         "backlog", "backlog", None, "P2", ["layer:backend"], 3),
    ]
    stories: list[tuple[Issue, Task]] = []
    for idx, (ep, title, criteria, istatus, tstatus, who, prio, labels, est) in enumerate(story_specs):
        assignee = guest if who == "guest" else (p[who] if who else None)
        n = next_number()
        t = Task(
            id=uuid.uuid4(),
            project_id=project.id,
            epic_id=epics[ep].id,
            key=issue_rules.key(n),
            title=title,
            description=f"{epic_specs[ep][1]} Story {idx + 1} of the go-live plan.",
            acceptance_criteria=criteria,
            status=tstatus,
            assignee_id=assignee.id if assignee else None,
            created_at=_ago(now, days=47),
        )
        session.add(t)
        await session.flush()
        i = Issue(
            id=uuid.uuid4(),
            project_id=project.id,
            number=n,
            title=title,
            description=t.description,
            type="story",
            priority=prio,
            status=istatus,
            source="plan",
            labels=["plan", *labels],
            reporter_id=p["daniel"].id,
            assignee_id=assignee.id if assignee else None,
            task_id=t.id,
            epic_id=epics[ep].id,
            parent_id=epic_issues[ep].id,
            acceptance_criteria=criteria,
            source_quote=epic_specs[ep][2],
            estimate=est,
            created_at=_ago(now, days=47),
            updated_at=_ago(now, days=max(0.2, 10 - idx)),
            closed_at=_ago(now, days=9) if istatus == "done" else None,
        )
        if istatus in ("done", "ready_for_qa"):
            i.dev_check = {
                "kind": "story",
                "by": str(p["rafael"].id),
                "byName": "Rafael Souza",
                "at": _ago(now, days=8).isoformat(),
                "criteria": [{"text": c, "ok": True} for c in criteria],
                "notes": "Ran the PAS conformance suite locally against the sandbox HAPI server.",
            }
        session.add(i)
        stories.append((i, t))
    await session.flush()

    (s_submit, t_submit), (s_resp, t_resp), (s_sla, t_sla), (_s_esc, t_esc), (_s_crd, t_crd) = stories[:5]

    # ── Agent runs and pull requests ──────────────────────────────────────
    def run(task: Task, *, status: str, phase: str, days: float, patch: str | None, suites: list[dict],
            exit_code: int | None, error: str | None = None, branch: str | None = None) -> Run:
        r = Run(
            id=uuid.uuid4(),
            task_id=task.id,
            project_id=project.id,
            backend="sandbox",
            requested_by=p["rafael"].id,
            status=status,
            phase=phase,
            branch=branch,
            patch=patch,
            test_command="pytest -q",
            test_exit_code=exit_code,
            test_output="\n".join(f"{s['suite']}: {s.get('passed', 0)} passed, {s.get('failed', 0)} failed" for s in suites),
            validation_status="passed" if exit_code == 0 else ("failed" if exit_code else "not_run"),
            test_suites=suites,
            error=error,
            created_at=_ago(now, days=days),
            started_at=_ago(now, days=days),
            heartbeat_at=_ago(now, days=days - 0.02),
            finished_at=_ago(now, days=days - 0.03),
        )
        session.add(r)
        return r

    r_submit = run(t_submit, status="succeeded", phase="done", days=12, patch=PATCH_SUBMIT,
                   suites=_suites((48, 0), (14, 0)), exit_code=0, branch="karkhana/iss-5-pas-submit")
    r_resp = run(t_resp, status="succeeded", phase="done", days=9, patch=PATCH_RESPONSE,
                 suites=_suites((53, 0), (16, 0)), exit_code=0, branch="karkhana/iss-6-pended-response")
    r_sla = run(t_sla, status="succeeded", phase="done", days=0.6, patch=PATCH_SLA,
                suites=_suites((61, 0), (18, 0)), exit_code=0, branch="karkhana/iss-7-sla-due-by")
    run(t_esc, status="failed", phase="testing", days=1.2, patch=None,
        suites=_suites((57, 0), (10, 2)), exit_code=1,
        error="2 integration tests failed: test_escalation_is_idempotent, test_breach_recorded_once")
    await session.flush()

    def pr(task: Task, r: Run, number: int, status: str, days: float, summary: str) -> PullRequest:
        x = PullRequest(
            id=uuid.uuid4(),
            task_id=task.id,
            run_id=r.id,
            number=number,
            url=f"local://{r.branch}",
            branch=r.branch or "",
            head_sha=uuid.uuid4().hex[:40],
            status=status,
            tests_passed=True,
            reviewed_at=_ago(now, days=days),
            review_engine="adk",
            review_model="gemini-2.5-pro",
            review_summary=summary,
            merged_by=p["meilin"].id if status == "merged" else None,
            merged_at=_ago(now, days=days - 0.5) if status == "merged" else None,
        )
        session.add(x)
        return x

    pr_submit = pr(t_submit, r_submit, 101, "merged", 11.5, "Validation is correct; one note on profile pinning (fixed).")
    pr_resp = pr(t_resp, r_resp, 104, "merged", 8.5, "Clean change. QA should confirm preAuthPeriod handling.")
    pr_sla = pr(t_sla, r_sla, 112, "open", 0.5,
                "Due-by logic matches CMS-0057-F windows. Three findings: the risk bands use the expedited "
                "window for standard requests, the tz argument is unused, and one test is missing.")
    pr_sla.requested_reviewers = [
        {"userId": str(guest.id), "name": guest.display_name, "by": "Rafael Souza", "at": _ago(now, days=0.5).isoformat()}
    ]
    await session.flush()

    session.add_all(
        [
            ReviewComment(pr_id=pr_submit.id, path="pas_gateway/routes/submit.py", line=9, severity="medium",
                          body="Pin the PAS profile version (e.g. |2.0.1) so a server upgrade cannot change validation silently.",
                          triage="valid", triaged_by=p["rafael"].id, triaged_at=_ago(now, days=11)),
            ReviewComment(pr_id=pr_submit.id, path="pas_gateway/routes/submit.py", line=15, severity="low",
                          body="Consider returning the persisted ClaimResponse instead of an empty Bundle.",
                          triage="dismissed", triage_reason="Covered by ISS-6, which builds the response.",
                          triaged_by=p["rafael"].id, triaged_at=_ago(now, days=11)),
            ReviewComment(pr_id=pr_sla.id, path="pas_gateway/sla.py", line=29, severity="high",
                          body="breach_risk() always uses the 72-hour expedited window. A standard request (7 days) "
                               "will show red after ~61 hours. Pass the urgency in and use its window."),
            ReviewComment(pr_id=pr_sla.id, path="pas_gateway/sla.py", line=17, severity="medium",
                          body="`tz` is accepted but never used. Remove it, or document that inputs must already be UTC."),
            ReviewComment(pr_id=pr_sla.id, path="tests/test_sla.py", line=25, severity="low",
                          body="Add a test for the amber band boundary (exactly 50% of the window used)."),
        ]
    )
    for merged in (pr_submit, pr_resp):
        session.add(Approval(project_id=project.id, gate=f"pr:{merged.id}", decision="approved",
                             reason="LGTM", decided_by=p["meilin"].id, decided_at=_ago(now, days=9)))
    s_submit.pr_id, s_resp.pr_id, s_sla.pr_id = pr_submit.id, pr_resp.id, pr_sla.id

    # ── Bugs ──────────────────────────────────────────────────────────────
    bug_qa = Issue(
        id=uuid.uuid4(), project_id=project.id, number=next_number(),
        title="Pended ClaimResponse omits preAuthPeriod when the service window is known",
        description="Found in QA scenario 'Pended response carries the authorization period'. Expected preAuthPeriod.start/end.",
        type="bug", priority="P1", status="todo", source="qa", labels=["qa", "fhir"],
        reporter_id=p["grace"].id, assignee_id=p["rafael"].id, parent_id=s_resp.id,
        created_at=_ago(now, days=2), updated_at=_ago(now, days=2),
    )
    bug_sec = Issue(
        id=uuid.uuid4(), project_id=project.id, number=next_number(),
        title="PHI written to application logs on bundle validation failure",
        description="Validation errors echo Patient.name and birthDate into structured logs.",
        type="bug", priority="P0", status="in_progress", source="security", labels=["security", "hipaa"],
        reporter_id=p["omar"].id, assignee_id=p["rafael"].id, parent_id=s_submit.id,
        created_at=_ago(now, days=3), updated_at=_ago(now, days=1),
    )
    session.add_all([bug_qa, bug_sec])
    await session.flush()

    # ── Architecture ──────────────────────────────────────────────────────
    for n, (title, status, context, decision, rationale, consequences, components) in enumerate(
        [
            ("Use HAPI FHIR JPA server as the PAS facade", "accepted",
             "We need conformant FHIR R4 validation, search and $submit without writing a FHIR server.",
             "Run HAPI FHIR JPA on Cloud Run in front of our PAS gateway.",
             "Mature, Da Vinci profiles load as packages, active community.",
             ["JVM service to operate", "Profile packages pinned per release"], ["hapi-fhir", "pas-gateway"]),
            ("Kafka for pended-request events", "accepted",
             "Clinical review is asynchronous and must never lose a pended request.",
             "Publish every state change to the pa.requests topic; UM workflow consumes it.",
             "Replayable, ordered per request, already run by the platform team.",
             ["Exactly-once handling needed in consumers"], ["pas-gateway", "um-workflow"]),
            ("Envelope-encrypt PHI with Cloud KMS", "proposed",
             "HIPAA requires PHI protection at rest; database-level encryption alone does not limit insiders.",
             "Encrypt member identifiers and diagnosis codes per field with data keys wrapped by Cloud KMS.",
             "Limits blast radius and supports crypto-shredding on member request.",
             ["Searchable fields need blind indexes", "Key rotation runbook"], ["request-store", "kms"]),
        ],
        start=1,
    ):
        session.add(
            Adr(project_id=project.id, workspace_id=ws, number=n, title=title, status=status, context=context,
                decision=decision, rationale=rationale, consequences=consequences, affected_components=components,
                created_by=p["meilin"].id, created_at=_ago(now, days=45 - n * 5))
        )

    # ── QA ────────────────────────────────────────────────────────────────
    for issue, title, steps, expected, status, actual in (
        (s_submit, "Valid PAS bundle is accepted", ["POST a conformant request bundle to /Claim/$submit"], "200 with ClaimResponse", "passed", "200 in 184 ms"),
        (s_submit, "Bundle missing Coverage is rejected", ["Remove the Coverage entry", "POST to $submit"], "422 OperationOutcome naming Coverage", "passed", "422 as expected"),
        (s_submit, "Profile version mismatch is rejected", ["Send a bundle declaring PAS 1.1.0"], "422 with a profile error", "passed", "422 as expected"),
        (s_resp, "Pended response has a tracking number", ["Submit a request that needs clinical review"], "outcome=queued and preAuthRef set", "passed", "preAuthRef=PA-2026-000418"),
        (s_resp, "Pended response carries the authorization period", ["Submit with a known service window"], "preAuthPeriod.start and .end present", "failed", "preAuthPeriod missing (filed ISS-15)"),
        (s_resp, "Expedited flag survives the round trip", ["Submit with priority=stat"], "ClaimResponse echoes priority", "not_run", None),
    ):
        session.add(
            TestScenario(project_id=project.id, workspace_id=ws, issue_id=issue.id, title=title, type="Functional",
                         priority="P1", steps=steps, expected_result=expected, status=status, actual_result=actual,
                         created_by=p["grace"].id, created_at=_ago(now, days=7))
        )
    session.add(
        QaSuggestion(
            project_id=project.id, issue_id=s_resp.id,
            title="ClaimResponse does not echo the request's X-Request-Id",
            description="Providers correlate async responses by X-Request-Id; the pended response drops it.",
            category="functional", severity="P2",
            steps=["Submit with header X-Request-Id: abc-123", "Inspect the response headers"],
            expected="X-Request-Id: abc-123 on the response",
            evidence=[{"path": "pas_gateway/claim_response.py", "line": 4, "note": "No header handling in pended_response()"}],
            status="open", model="qa-agent · gemini-2.5-pro", created_at=_ago(now, days=1),
        )
    )

    # ── Security ──────────────────────────────────────────────────────────
    base_scan = SecurityScan(
        project_id=project.id, workspace_id=ws, trigger="schedule", status="succeeded",
        created_at=_ago(now, days=2), started_at=_ago(now, days=2), finished_at=_ago(now, days=1.99),
        counts={"CRITICAL": 1, "HIGH": 1, "MEDIUM": 0, "LOW": 0}, packages_affected=2, new_findings=1,
        gate="blocked", scanner_version="osv-scanner 2.0 (demo)",
    )
    pr_scan = SecurityScan(
        project_id=project.id, workspace_id=ws, trigger="pr", status="succeeded", ref=r_sla.branch,
        pr_id=pr_sla.id, created_at=_ago(now, days=0.5), started_at=_ago(now, days=0.5),
        finished_at=_ago(now, days=0.49), counts={"CRITICAL": 0, "HIGH": 0, "MEDIUM": 1, "LOW": 0},
        packages_affected=0, new_findings=1, gate="passed", scanner_version="osv-scanner 2.0 (demo)",
    )
    session.add_all([base_scan, pr_scan])
    await session.flush()
    findings = [
        SecurityFinding(project_id=project.id, workspace_id=ws, title="Unsafe polymorphic deserialization in FHIR bundle parser",
                        cwe_category="CWE-502", severity="CRITICAL", cvss_score=9.1, status="open",
                        affected_component="pas_gateway/fhir/parser.py",
                        remediation_advice="Disable default typing; parse with the HAPI structure definitions only.",
                        sla_deadline=(now + dt.timedelta(days=2)).date(), source="manual", scan_id=base_scan.id,
                        assignee_id=p["omar"].id, created_by=p["omar"].id, created_at=_ago(now, days=2),
                        first_seen_at=_ago(now, days=2), last_seen_at=_ago(now, days=0.2)),
        SecurityFinding(project_id=project.id, workspace_id=ws, title="PHI written to application logs on validation failure",
                        cwe_category="CWE-532", severity="HIGH", cvss_score=7.5, status="in_remediation",
                        affected_component="pas_gateway/routes/submit.py",
                        remediation_advice="Log OperationOutcome codes only; redact Patient resources before logging.",
                        sla_deadline=(now + dt.timedelta(days=5)).date(), source="manual", scan_id=base_scan.id,
                        assignee_id=p["rafael"].id, issue_id=bug_sec.id, created_by=p["omar"].id,
                        created_at=_ago(now, days=3), first_seen_at=_ago(now, days=3), last_seen_at=_ago(now, days=0.2)),
        SecurityFinding(project_id=project.id, workspace_id=ws, title="Due-by computation trusts a client-supplied timezone",
                        cwe_category="CWE-20", severity="MEDIUM", cvss_score=5.3, status="open", ref=r_sla.branch,
                        affected_component="pas_gateway/sla.py",
                        remediation_advice="Compute in UTC from the server's receipt timestamp; ignore client tz.",
                        source="manual", scan_id=pr_scan.id, created_by=p["omar"].id,
                        created_at=_ago(now, days=0.5), first_seen_at=_ago(now, days=0.5), last_seen_at=_ago(now, days=0.5)),
        SecurityFinding(project_id=project.id, workspace_id=ws, title="Missing HSTS header on provider portal",
                        cwe_category="CWE-319", severity="LOW", cvss_score=3.1, status="verified_fixed",
                        affected_component="portal/nginx.conf", remediation_advice="Add Strict-Transport-Security.",
                        source="manual", created_by=p["omar"].id, created_at=_ago(now, days=20),
                        first_seen_at=_ago(now, days=20), last_seen_at=_ago(now, days=14)),
    ]
    session.add_all(findings)
    await session.flush()
    base_scan.finding_ids = [str(findings[0].id), str(findings[1].id)]
    pr_scan.finding_ids = [str(findings[2].id)]

    # ── Releases ──────────────────────────────────────────────────────────
    def manifest(prs: list[PullRequest], story_rows: list[Issue], sec: list[SecurityFinding]) -> dict:
        return {
            "pullRequests": [{"number": x.number, "url": x.url, "title": f"PR #{x.number}"} for x in prs],
            "stories": [
                {"key": issue_rules.key(s.number), "title": s.title, "status": s.status, "qaPassed": 3 if s.status == "done" else 1, "qaTotal": 3}
                for s in story_rows
            ],
            "security": [{"title": f.title, "severity": f.severity, "status": f.status} for f in sec],
            "commit": uuid.uuid4().hex[:40],
            "ci": [],
        }

    session.add_all(
        [
            Release(project_id=project.id, version="v0.9.0", status="published",
                    manifest=manifest([pr_submit], [s_submit], [findings[3]]), blockers=[],
                    notes="Sandbox pilot: $submit accepted from two EHR vendors' test harnesses.",
                    commit_sha=uuid.uuid4().hex[:40], created_by=p["lena"].id, approved_by=p["asha"].id,
                    approved_at=_ago(now, days=8), created_at=_ago(now, days=9)),
            Release(project_id=project.id, version="v1.0.0", status="draft",
                    manifest=manifest([pr_submit, pr_resp], [s_submit, s_resp, s_sla], findings[:2]),
                    blockers=[
                        f"{issue_rules.key(s_resp.number)} is not signed off by QA",
                        f"{issue_rules.key(s_sla.number)} is still in review",
                        "Security gate closed: 1 CRITICAL finding open",
                    ],
                    notes="Production go-live candidate for CMS-0057-F (target 2026-12-15).",
                    commit_sha=uuid.uuid4().hex[:40], created_by=p["lena"].id, created_at=_ago(now, days=1)),
        ]
    )

    # ── Shared context, learnings, chat, activity ─────────────────────────
    session.add_all(
        [
            ContextEntry(project_id=project.id, kind="decision", title="Clock starts when the request is complete",
                         body="Per CMS-0057-F the 72h / 7d window starts when a complete request is received, not at first contact.",
                         author_label="Daniel Okafor", author_kind="human", created_at=_ago(now, days=20)),
            ContextEntry(project_id=project.id, kind="handoff", title=f"{t_sla.key}: due-by engine",
                         body="Implemented due_by() and breach_risk() with tests. Did not wire escalation; see ISS-8.",
                         author_label="coder-agent", author_kind="ai", run_id=r_sla.id, created_at=_ago(now, days=0.6)),
        ]
    )
    session.add(
        Learning(project_id=project.id, pr_id=pr_submit.id, status="verified",
                 text="Pin FHIR profile versions in validation calls; an unpinned PAS profile changed behaviour on a HAPI upgrade.",
                 source={"pr_number": pr_submit.number, "task_key": t_submit.key},
                 verified_by=p["meilin"].id, verified_at=_ago(now, days=10), created_at=_ago(now, days=11))
    )

    general = ChatChannel(workspace_id=ws, name="general", type="channel", description="Arcwell payer platform",
                          created_by=p["daniel"].id, created_at=_ago(now, days=58))
    golive = ChatChannel(workspace_id=ws, name="pa-api-golive", type="channel", project_id=project.id,
                         description="CMS-0057-F go-live war room", created_by=p["meilin"].id, created_at=_ago(now, days=50))
    session.add_all([general, golive])
    await session.flush()
    for ch, who, body, hours in (
        (general, "daniel", "Welcome to ClearAuth. Go-live target is Dec 15, two weeks ahead of the CMS deadline.", 300),
        (golive, "grace", "ISS-6 scenario 'authorization period' failed, filed ISS-15 for Rafael.", 48),
        (golive, "omar", "Heads up: CRITICAL deserialization finding in the FHIR parser blocks v1.0.0 until fixed.", 40),
        (golive, "rafael", "SLA due-by PR #112 is up, the AI review flagged the risk-band window. Can someone review?", 12),
        (golive, "meilin", "I'm out today. @guest could you triage the review comments and approve if it looks right?", 10),
    ):
        session.add(ChatMessage(channel_id=ch.id, sender_id=p[who].id, body=body,
                                mentions=[str(guest.id)] if "@guest" in body else [],
                                created_at=_ago(now, hours=hours)))

    for summary, typ, hours in (
        ("Rafael Souza asked you to review PR #112 for ISS-7", "review", 12),
        ("Daniel Okafor asked you to approve 'Real-time gold-carding for high-approval providers'", "approval", 72),
        ("Mei Lin Chen mentioned you in #pa-api-golive", "mention", 10),
    ):
        session.add(ActivityEvent(workspace_id=ws, actor_id=p["rafael"].id, recipient_id=guest.id, type=typ,
                                  summary=summary, project_id=project.id, read=False, created_at=_ago(now, hours=hours)))

    await session.flush()

    # ── Evidence ledger (the sandbox's own chain) ─────────────────────────
    for actor, action, stype, sid, payload in (
        (ledger.Actor.human(p["daniel"]), "idea.submitted", "idea", idea_pas.id, {"title": idea_pas.title}),
        (ledger.Actor.human(p["asha"]), "idea.approved", "idea", idea_pas.id, {"score": 88}),
        (ledger.Actor.human(p["daniel"]), "project.created", "project", project.id, {"from_idea": str(idea_pas.id)}),
        (ledger.Actor.human(p["meilin"]), "plan.approved", "project", project.id, {"stories": len(stories)}),
        (ledger.Actor.ai("coder-agent"), "run.completed", "run", r_submit.id, {"task": t_submit.key, "test_exit_code": 0}),
        (ledger.Actor.human(p["meilin"]), "pr.merged", "pull_request", pr_submit.id, {"number": 101}),
        (ledger.Actor.human(p["asha"]), "release.approved", "project", project.id, {"version": "v0.9.0"}),
        (ledger.Actor.ai("coder-agent"), "run.completed", "run", r_sla.id, {"task": t_sla.key, "test_exit_code": 0}),
        (ledger.SYSTEM, "pr.opened", "pull_request", pr_sla.id, {"number": 112, "tests_passed": True}),
    ):
        await ledger.append(session, actor=actor, action=action, subject_type=stype, subject_id=sid,
                            project_id=project.id, payload=payload, workspace_id=ws)

    return Seeded(
        workspace_id=ws,
        product_id=product.id,
        project_id=project.id,
        open_pr_id=pr_sla.id,
        ready_task_id=t_crd.id,
        pending_idea_id=idea_gold.id,
        counts={"ideas": 5, "stories": len(stories), "epics": len(epics), "prs": 3, "findings": len(findings)},
    )
