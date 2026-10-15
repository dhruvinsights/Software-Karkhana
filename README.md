# Software Karkhana

**Software Karkhana** is an end-to-end Autonomous Software Delivery Factory and Control Plane. It unifies every phase of software development—from initial idea validation and architecture design to automated coding, invariant verification, QA, and security signoff—connected through an immutable SHA-256 hash-chained evidence ledger.

---

## 🏛️ Architecture Overview

```
                                      SOFTWARE KARKHANA
                            Unified Autonomous Software Factory

   ┌──────────────────────────────────────────────────────────────────────────────┐
   │                          PUBLIC MARKETING & DISCOVERY                        │
   │  • Clean Minimalist Branding ("Software Karkhana")  • Interactive Demos      │
   │  • React Bits Pro Visual Suite                      • Step-by-Step Onboarding│
   └───────────────────────────────────────┬──────────────────────────────────────┘
                                           │
                                           ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │                           AUTHENTICATED CONTROL PLANE                        │
   │  • Multi-Role Shell (Executive, PM, Architect, Lead, Dev, QA, SecOps, DevOps)│
   │  • Command Palette (Ctrl+K)       • AI Companion Copilot                     │
   └───────────────────────────────────────┬──────────────────────────────────────┘
                                           │
            ┌──────────────────────────────┼──────────────────────────────┐
            ▼                              ▼                              ▼
   ┌───────────────────┐         ┌────────────────────┐         ┌────────────────────┐
   │  IDEA VALIDATION  │         │  PORTFOLIO & GATES │         │  DESIGN & ARCH     │
   │  • Persona Fit    │         │  • Phase Gates     │         │  • Wireframe Flow  │
   │  • Value / Viability         │  • Risk Matrices   │         │  • ADR Registry    │
   │  • AI Evidence    │         │  • Health Metrics  │         │  • API Contracts   │
   └────────┬──────────┘         └─────────┬──────────┘         └─────────┬──────────┘
            │                              │                              │
            └──────────────────────────────┼──────────────────────────────┘
                                           │
            ┌──────────────────────────────┼──────────────────────────────┐
            ▼                              ▼                              ▼
   ┌───────────────────┐         ┌────────────────────┐         ┌────────────────────┐
   │ DEVELOPER WORKSPACE│        │  QA & VERIFICATION │         │ SECURITY & SEC-OPS │
   │  • Agent Run logs │         │  • Automated Suites│         │  • SBOM Compliance │
   │  • Patch Inspector│         │  • Test Generation │         │  • SAST / DAST     │
   │  • Pull Requests  │         │  • Deterministic   │         │  • CVE Remediation │
   └────────┬──────────┘         └─────────┬──────────┘         └─────────┬──────────┘
            │                              │                              │
            └──────────────────────────────┼──────────────────────────────┘
                                           │
                                           ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │                     IMMUTABLE SHA-256 EVIDENCE LEDGER                        │
   │  • Cryptographic Chain • Invariant Checkers • Advisory Locked Appends        │
   └──────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Modules & Capabilities

1. **Idea & Opportunity Assessment**: Automated value, usability, feasibility, and viability scoring with grounded citations.
2. **Executive Portfolio & Governance**: Multi-stage gate verifications with strict role-based access control.
3. **Product Hub & Project Workspace**: Project setup, team assignments, and delivery tracking.
4. **Planning & Roadmap**: Epic breakdown, milestone management, and decision logs.
5. **Design & Architecture Studio**: System flow mapping, design token integration, and Architecture Decision Records (ADRs).
6. **Developer Workspace & AI Autonomous Agents**: Workspace-confined tool execution, code generation, diff inspection, and GitHub PR creation.
7. **QA Verification & Test Generation**: Automated test suites, edge case verification, and deterministic signoffs.
8. **Security & AppSec Studio**: Dependency vulnerability audits, Cosign signature verification, and compliance validation.
9. **DevOps, CI/CD & Release Management**: Multi-environment deployment workflows and rollbacks.
10. **Knowledge & Learning Engine**: pgvector-based retrieval of verified organizational learnings and post-mortems.
11. **Immutable Evidence Ledger**: Hash-chained ledger ensuring cryptographic traceability for every lifecycle event.

---

## 🛠️ Quick Start

### 1. Frontend Development

```bash
cd web
npm install
npm run dev
```

Visit `http://localhost:5173` to explore the complete Software Karkhana web experience.

### 2. Backend Control Plane

```bash
# Set up Python environment
python -m venv .venv
source .venv/bin/activate
pip install -e .

# Run development server
uvicorn app.fast_api_app:app --reload --port 8080
```

---

## 📜 Documentation

- [Complete Project Blueprint](docs/Software_Karkhana_Complete_Project_Blueprint.md)
- [Architecture & Build Decisions](docs/BUILD_LOG.md)
- [Deployment & Go-Live Guide](docs/GO_LIVE.md)
- [Learning Guide & Principles](docs/LEARNING_GUIDE.md)
- [Local Windows/WSL2 Setup](docs/LOCAL_WINDOWS.md)
