# Software Karkhana — Engineering Wiki & Knowledge Base

This repository houses the living technical documentation, architectural specifications, module audits, and task roadmaps for **Software Karkhana**.

---

## 🗂️ Wiki Structure

```
wiki/
├── README.md                                          ← Root Index & Navigation
├── 01_architecture/
│   ├── 01_system_overview_and_stack.md                ← High-level architecture, data plane & auth
│   └── 02_scalability_and_backend_evaluation.md       ← FastAPI vs Go analysis, Headroom & Fabro patterns
├── 02_modules_and_stations/
│   ├── 01_backend_modules.md                          ← Detailed audit of app/, db/migrations/, ledger & AI
│   ├── 02_frontend_components.md                      ← Detailed audit of web/src, state store & UI panels
│   └── 03_software_factory_lifecycle.md               ← End-to-end lifecycle: PM -> Ideas -> Gates -> Projects
├── 03_features_and_specifications/
│   ├── 01_sharing_invites_and_role_visibility.md      ← Workspace, Project & Interface level RBAC & links
│   ├── 02_pr_reviewer_and_code_intelligence.md       ← CodeRabbit / IBM Dexter PR Reviewer integration
│   └── 03_multiagent_orchestration_and_google_ax.md   ← Multi-agent orchestrator, Google AX & Sandcastle
└── 04_roadmap_and_tasks/
    ├── 01_task_matrix_and_assignees.md                ← Responsibilities & deliverables (Eshitha & Dhruv)
    └── 02_current_status_and_what_is_left.md          ← Comprehensive completed vs pending checklist
```

---

## 🧭 Quick Links

- [System Overview & Tech Stack](01_architecture/01_system_overview_and_stack.md)
- [Scalability & Architecture Evaluation (FastAPI vs Go)](01_architecture/02_scalability_and_backend_evaluation.md)
- [Backend Modules Breakdown](02_modules_and_stations/01_backend_modules.md)
- [Frontend Components Breakdown](02_modules_and_stations/02_frontend_components.md)
- [Software Factory Lifecycle & Multi-Window Workflow](02_modules_and_stations/03_software_factory_lifecycle.md)
- [Sharing, Invites & Role-Level Visibility Controls](03_features_and_specifications/01_sharing_invites_and_role_visibility.md)
- [PR Reviewer (CodeRabbit / IBM Dexter Parity)](03_features_and_specifications/02_pr_reviewer_and_code_intelligence.md)
- [Multi-Agent Orchestrator & Google AX](03_features_and_specifications/03_multiagent_orchestration_and_google_ax.md)
- [Task Matrix & Assignees](04_roadmap_and_tasks/01_task_matrix_and_assignees.md)
- [Current Status & What Is Left](04_roadmap_and_tasks/02_current_status_and_what_is_left.md)
