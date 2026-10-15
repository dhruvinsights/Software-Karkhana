# Software Karkhana

<div align="center">

<h3>Creating an Enterprise Platform that Connects Teams from Idea to Product</h3>

<p align="center">
  <b>Bringing ideas to solution with the current systems enterprises follow, powered by a customized, evidence-backed AI control plane.</b>
</p>

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![FastAPI](https://img.shields.io/badge/Control%20Plane-FastAPI%20%7C%20Python%203.11-009688.svg)](https://fastapi.tiangolo.com)
[![React 18 + Vite](https://img.shields.io/badge/Web%20Client-React%2018%20%7C%20Vite%20%7C%20Tailwind%20v4-61DAFB.svg)](web/)
[![PostgreSQL 16 + pgvector](https://img.shields.io/badge/Storage-Postgres%2016%20%2B%20pgvector-336791.svg)](db/)
[![Ledger Verification](https://img.shields.io/badge/Ledger-SHA--256%20Hash%20Chained-success.svg)](app/ledger.py)
[![Architecture: Google Cloud Run](https://img.shields.io/badge/Cloud-Google%20Cloud%20Run%20%7C%20Jobs-4285F4.svg)](cloudbuild.yaml)

<br/>

[**🚀 Launch Workspace**](http://localhost:5173) &nbsp;&bull;&nbsp;
[**📖 Architecture Blueprint**](docs/Software_Karkhana_Complete_Project_Blueprint.md) &nbsp;&bull;&nbsp;
[**🛠️ Local Quickstart**](#-quick-start--local-development) &nbsp;&bull;&nbsp;
[**🏛️ Role Matrix**](#-role-based-matrix--governance) &nbsp;&bull;&nbsp;
[**📜 Build Decisions**](docs/BUILD_LOG.md)

</div>

---

## 🌟 Executive Overview

**Software Karkhana** is an enterprise-grade autonomous software delivery factory and control plane. It bridges the critical divide between business intent, system architecture, human expertise, and autonomous AI agents. 

Rather than acting as a disjointed chat wrapper or a standalone coding bot, Software Karkhana coordinates the **complete engineering lifecycle**—from opportunity discovery and architectural review to deterministic code generation, invariant verification, automated QA, security signoff, and post-release learning loops.

Every stage of development produces tamper-evident, cryptographically chained records in an immutable **SHA-256 Evidence Ledger**, ensuring zero hallucination, full auditability, and absolute governance at enterprise scale.

---

## 🛑 The Enterprise Problem vs. The Karkhana Solution

| Dimension | The Disconnected Enterprise Silo (Today) | The Software Karkhana Factory Model |
|:---|:---|:---|
| **Context Fragmentation** | PMs in Jira, Designers in Figma, Architects in Confluence, Developers in IDEs, QA in TestRail, Security in SonarQube. Context is lost at every handoff. | **Single Unified Project Graph**: Shared workspace context, architectural rules, and acceptance criteria travel with every ticket, story, and agent task. |
| **AI Verification** | Agents write code blindly and claim "done" with no deterministic proof or invariant checks. | **Evidence-Backed Verification**: Completion requires automated test executions, diff reviews, and cryptographic ledger proofs. |
| **Governance & Gates** | High-impact approvals (architecture, security waivers, production deployments) happen in unstructured email/chat threads. | **Strict Phase-Gate Verification**: Role-enforced gates backed by cryptographic signatures. Directors, Architects, and AppSec leads hold explicit authority. |
| **Knowledge Retention** | Post-mortems and architectural lessons fade into forgotten wikis; mistakes are repeated on subsequent projects. | **pgvector Knowledge Loops**: Verified learnings and architectural patterns are automatically retrieved and fed into agent prompts and design reviews. |
| **Audit & Compliance** | Reconstructing who approved a feature or modified a sensitive dependency requires days of manual log aggregation. | **SHA-256 Hash-Chained Evidence Ledger**: Every transition, approval, tool execution, and diff is immutably recorded with advisory-locked integrity. |

---

## 🔄 End-to-End Enterprise Flow & Parallel Execution

Software Karkhana orchestrates software delivery across parallel, interconnected studios, ensuring continuous alignment between business stakeholders, technical specialists, and automated workers:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             1. IDEA DISCOVERY & ASSESSMENT                                   │
│  Product Manager captures opportunity ──► Multi-agent JTBD & Viability Scoring ──► Evidence Citing Dossier   │
└──────────────────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             2. EXECUTIVE PHASE-GATE REVIEW                                  │
│  Director/Executive reviews score & risks ──► Budget & ROI Validation ──► Cryptographic Gate Signoff         │
└──────────────────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             3. PLANNING & BACKLOG DECOMPOSITION                              │
│  Epics, User Stories, and Milestones created ──► Invariant Rules Defined ──► Task Dependency Graph Set       │
└───────────────────────┬──────────────────────────────────────────────────────────────┬──────────────────────┘
                        │                                                              │
                        ▼ (Parallel Track A)                                           ▼ (Parallel Track B)
┌─────────────────────────────────────────────────┐           ┌───────────────────────────────────────────────┐
│              4A. DESIGN STUDIO                  │           │           4B. ARCHITECTURE STUDIO             │
│  • Visual Flow Mapping & Responsive Canvas      │           │  • Architecture Decision Records (ADRs)       │
│  • Design Token Extraction & Component Specs    │           │  • API Contracts (OpenAPI/gRPC), Threat Model │
└───────────────────────┬─────────────────────────┘           └───────────────────────┬───────────────────────┘
                        │                                                             │
                        └──────────────────────────────┬──────────────────────────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             5. AUTONOMOUS DEVELOPER WORKSPACE                               │
│  Confined Agent Workers (ADK Coder) ──► Tool Execution & Patch Generation ──► Real Pytest Verification       │
│  HMAC Callback to Control Plane ──► Pull Request Opened with Diff Inspector & Automated Review Triage        │
└──────────────────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                       │
                        ┌──────────────────────────────┴──────────────────────────────┐
                        ▼ (Parallel Track C)                                          ▼ (Parallel Track D)
┌─────────────────────────────────────────────────┐           ┌───────────────────────────────────────────────┐
│           6A. QA & DETERMINISTIC VERIFICATION   │           │           6B. APPSEC & SECURITY STUDIO        │
│  • Automated Test Plan Generation               │           │  • SAST / DAST Vulnerability Scans            │
│  • Scenario Matrix Execution (E2E, API, Unit)   │           │  • SBOM Compliance & Cosign Key Verification  │
│  • Defect Triage & Deterministic Signoff        │           │  • Security Waivers & Threat Remediation      │
└───────────────────────┬─────────────────────────┘           └───────────────────────┬───────────────────────┘
                        │                                                             │
                        └──────────────────────────────┬──────────────────────────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             7. DEVOPS & MULTI-CLOUD RELEASE                                 │
│  Staging Deployment ──► Production Gate Signoff ──► Blue/Green Rollout ──► Automated Rollback Plans         │
└──────────────────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             8. TELEMETRY, FEEDBACK & KNOWLEDGE LOOPS                        │
│  Incident Capture & RCA ──► Verified Lessons Promoted ──► pgvector Semantic Memory for Future Projects      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 👥 Role-Based Matrix & Governance

Software Karkhana provides personalized, role-aware workspaces with strict authorization boundaries (`app/auth.py`):

```
                                      ROLE-BASED GOVERNANCE MATRIX
   ┌───────────────────┬──────────────────────────────────────────────────────┬──────────────────────────────┐
   │ Enterprise Role   │ Primary Responsibilities                             │ Enforced Authority / Gates   │
   ├───────────────────┼──────────────────────────────────────────────────────┼──────────────────────────────┤
   │ 👔 Executive      │ Portfolio health, capital allocation, risk review    │ Phase-gate approval (Stage 3)│
   │ 📋 Product Mgr    │ Opportunity sizing, PRDs, backlog prioritization     │ Stage transition requests    │
   │ 🏛️ Sys Architect  │ ADR authoring, API contracts, boundary enforcement   │ Architecture Signoff         │
   │ 🎨 Design Lead    │ Component tokens, user flow mapping, UX review       │ Design Ready Signoff         │
   │ 💻 Staff/Sr Dev   │ Agent oversight, diff inspection, PR merge triage    │ Code Review & Merge Gate     │
   │ 🧪 QA Lead        │ Test matrix generation, defect signoff, E2E suites   │ QA Signoff Gate              │
   │ 🛡️ AppSec Eng     │ SBOM validation, CVE triage, Cosign verification     │ Security Waiver & Release    │
   │ 🚀 DevOps / SRE   │ Pipeline orchestration, canary rollouts, rollbacks   │ Production Deployment Gate   │
   └───────────────────┴──────────────────────────────────────────────────────┴──────────────────────────────┘
```

---

## 🧩 Complete Feature Catalog (15 Core Studios)

### 1. Public Marketing & Discovery Experience
- Minimalist text-only **Software Karkhana** identity following the Google DeepMind dark aesthetic.
- Luminous React Bits Pro visual suite (Shader Cards, Bento Grids, Aurora Bloom, Contact Sheets).
- Progressive, Slack-style onboarding wizard with zero-mock-noise defaults.

### 2. Idea & Opportunity Validation Studio (`IdeaValidationView.tsx`)
- Structured opportunity scoring across **Value**, **Usability**, **Feasibility**, and **Viability** dimensions.
- Grounded citations and verbatim quote verification from customer transcripts and market data.
- Comparison matrix against existing product capabilities.

### 3. Executive Portfolio & Governance Center (`ExecutivePortfolioView.tsx`)
- Enterprise portfolio health dashboard with real-time risk indicators and budget burn rates.
- Multi-project phase-gate approval queues with audit-trail inspection.
- Policy enforcement engine ensuring non-bypassable compliance criteria.

### 4. Product Workspace & Project Hub (`ProjectHubView.tsx`)
- Long-lived product context store with automated versioning.
- Cross-functional team provisioning and RBAC permission assignment.
- Repository and tool adapter management (GitHub, Google Cloud, Issue Trackers).

### 5. Planning, Roadmap & Backlog Studio (`PlanningRoadmapView.tsx`)
- Hierarchical breakdown: Epics → User Stories → Tasks → Agent Runs.
- Milestone tracking, dependency graph visualization, and critical-path alerts.
- Immutable decision logs linked directly to project execution graphs.

### 6. Design & Prototyping Studio (`DesignStudioView.tsx`)
- Interactive responsive canvas for user journey and flow mapping.
- Design token extraction and shared CSS token contracts.
- UX review gates preventing developer handoff before visual alignment.

### 7. Architecture & System Design Studio (`ArchitectureStudioView.tsx`)
- Formal Architecture Decision Record (ADR) registry with versioned signoffs.
- OpenAPI & gRPC contract registry with breaking-change validation.
- Architectural threat maps and cross-service boundary definitions.

### 8. Developer Workspace & Agent Control Plane (`DeveloperWorkspaceView.tsx`)
- Workspace-confined autonomous agent workers executing tool chains in isolated sandboxes.
- Side-by-side patch inspector with syntax highlighting and real test suite logs.
- Pull request publisher with HMAC authentication and commit status reporting.

### 9. QA & Deterministic Verification Studio (`QAVerificationView.tsx`)
- AI-assisted test plan generator creating comprehensive positive, negative, and edge-case suites.
- Automated test execution engine reporting exact exit codes and stack traces.
- Defect tracker with automatic repro step synthesis and QA signoff locks.

### 10. Security & AppSec Studio (`SecurityAppSecView.tsx`)
- Real-time Dependency vulnerability audit and CVE severity triage.
- Software Bill of Materials (SBOM) verification and Cosign cryptographic signature checks.
- Formally signed security waivers with expiry deadlines and named accountability.

### 11. DevOps & CI/CD Pipelines (`DevOpsPipelinesView.tsx`)
- Visual multi-stage deployment pipeline monitoring.
- Environment drift detection between Staging, Pre-Prod, and Multi-Cloud Production.
- Health telemetry and canary release validation.

### 12. Release Management Studio (`ReleaseManagementView.tsx`)
- Release candidate bundling with automated changelog and artifact provenance.
- One-click rollback automation with predefined safety procedures.
- Production readiness gate checklists ensuring 100% prerequisite closure.

### 13. Feedback & Incident Command (`FeedbackIncidentsView.tsx`)
- Production incident triage, root-cause analysis (RCA), and timeline reconstruction.
- Customer sentiment and telemetry trend aggregation.
- Direct conversion of incident learnings into prevention tasks.

### 14. Knowledge & Learning Engine (`KnowledgeLearningView.tsx`)
- `pgvector`-powered semantic memory storing verified engineering lessons.
- Automated citation enrichment from the production database.
- Proactive warning prompts injected into agent runs when similar historical pitfalls are detected.

### 15. Workflow Administration & Invariant Rules (`WorkflowAdminView.tsx`)
- Configurable stage transition graphs with custom prerequisites.
- Audit event explorer with cryptographic chain verification tools.
- Team capacity, worker lease monitoring, and quota management.

---

## 🏛️ Technical Architecture

```
Browser Client (React 18, Vite, Tailwind v4, Zustand Store)
   │  HTTPS / Firebase Auth Token
   ▼
Cloud Run: Karkhana Control Plane (FastAPI / Python 3.11)
   ├─ app/auth.py        IAM Token Verification → Role Mapping (Cloud SQL Postgres)
   ├─ app/process.py     15 Stages + Strict Transition State Machine
   ├─ app/ledger.py      SHA-256 Hash Chain & Advisory-Locked Appends
   ├─ app/ai/evaluator   Gemini / Ollama Structured Schema & Verbatim Quote Checks
   ├─ app/memory.py      pgvector Semantic Search over Verified Learnings
   └─ app/runner/        ADR-001 Runner Contract: Local Subprocess / Cloud Run Jobs
           │ start(run) with RUN_ID + Per-Run HMAC Token
           ▼
Cloud Run Job: Karkhana Worker Sandbox
   ├─ Read-only Git Clone
   ├─ ADK Coder Agent (5 Workspace-Confined Tools: list, read, edit, write, test)
   ├─ Real Test Execution (pytest / npm test in isolated container)
   ├─ ADK Reviewer (Typed Output & Review Findings)
   └─ HMAC Callback to Control Plane with Patch & Verified Exit Code
           ▼
Control Plane Actions: Git Branch Creation, Pull Request, Commit Status, Ledger Commit
```

---

## 🔒 The Cryptographic Evidence Ledger

At the heart of Software Karkhana is the **Immutable Evidence Ledger** (`app/ledger.py`). Every significant lifecycle action produces a cryptographically signed block containing:

- **Sequence ID**: Monotonically increasing entry counter.
- **Timestamp & Actor**: ISO 8601 UTC timestamp and authenticated user/agent ID.
- **Event Type & Payload**: Structured event metadata and task outputs.
- **Previous Hash**: SHA-256 digest of the preceding ledger block.
- **Current Hash**: `SHA256(seq_id + timestamp + actor + payload + prev_hash)`.

This guarantees tamper-evidence: any modification to past records invalidates the entire subsequent hash chain. Database role permissions explicitly prohibit `UPDATE` and `DELETE` operations on ledger tables.

---

## 💻 Quick Start & Local Development

### Prerequisites
- Node.js 18+ and npm
- Python 3.11+
- PostgreSQL 16 with `pgvector` extension

### 1. Web Client (Frontend)

```bash
# Navigate to web directory
cd web

# Install dependencies
npm install

# Start Vite development server
npm run dev

# Build for production
npm run build
```

The frontend will be available at **`http://localhost:5173`**.

### 2. Control Plane (Backend API)

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install package dependencies
pip install -e .

# Run database migrations
python -m app.scripts.migrate

# Seed demo enterprise workspace
python -m app.scripts.seed

# Start FastAPI server
uvicorn app.fast_api_app:app --reload --port 8080
```

The API will be available at **`http://localhost:8080`** with OpenAPI docs at **`http://localhost:8080/docs`**.

### 3. Running Automated Tests

```bash
# Run backend test suite
pytest -v

# Run frontend build checks
cd web && npx tsc -b
```

---

## 📚 Complete Documentation Suite

- [📄 Software Karkhana Complete Project Blueprint](docs/Software_Karkhana_Complete_Project_Blueprint.md)
- [🏗️ Architectural Decisions & Build Log](docs/BUILD_LOG.md)
- [🚢 Enterprise Deployment & Go-Live Guide](docs/GO_LIVE.md)
- [🎓 Factory Engineering Principles & Learning Guide](docs/LEARNING_GUIDE.md)
- [🪟 Windows & WSL2 Local Setup Guide](docs/LOCAL_WINDOWS.md)
- [👥 Team Work Breakdown Plan](docs/TEAM_PLAN.md)
- [🎬 Golden Path Demo Script](docs/DEMO_SCRIPT.md)

---

## 📄 License & Attribution

Copyright &copy; 2026 Software Karkhana Contributors. Licensed under the [Apache License, Version 2.0](LICENSE).  
Third-party notices and open-source attributions are documented in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
