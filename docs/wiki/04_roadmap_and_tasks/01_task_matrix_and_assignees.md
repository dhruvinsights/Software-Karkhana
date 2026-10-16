# 01. Task Matrix & Team Assignees

## 👥 Ownership & Core Responsibilities

```
┌─────────────────────────────────────────────────────────────┐
│                    SOFTWARE KARKHANA                        │
├──────────────────────────────┬──────────────────────────────┤
│         ESHITHA              │            DHRUV             │
│   (Infrastructure, Scale,    │   (Station Interfaces, AI    │
│    Realtime Sync, Invites)   │   Factory, Multi-Agent, PRs) │
└──────────────────────────────┴──────────────────────────────┘
```

---

## 👩‍💻 Eshitha's Ownership Scope

### 1. Workspace Scalability & Realtime Synchronization
- **Realtime Chat & Activity Feed**: Implement WebSocket / Server-Sent Events (SSE) with Redis pub/sub backend for instantaneous synchronization across multi-user sessions.
- **Backend Concurrency Profiling**: Continuous load testing of FastAPI async endpoints; evaluate microservice boundaries vs Go standalone services for high-load event channels.
- **Session Persistence & Security**:
  - Secure long-lived session storage with automatic JWT token refresh.
  - Implement 60-second OTP resend cooldown timer and IP-based rate limiting on auth endpoints.

### 2. Invites & Email Lifecycle
- **Invite Link Routing & Deep Linking**:
  - Ensure workspace and project invite links open smoothly into the target onboarding / project view upon login.
  - Deliver rich, branded transactional emails via Resend (`app/email.py`) for all invite requests.
- **Reference Architecture Studies**:
  - Synthesize best practices from **Headroom** ([github.com/headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom)) for session memory & real-time context streaming.
  - Synthesize best practices from **Fabro** ([github.com/fabro-sh/fabro](https://github.com/fabro-sh/fabro)) for immutable artifact state machines.

---

## 👨‍💻 Dhruv's Ownership Scope

### 1. Software Factory Stations & Multi-Role Interfaces
- **Role-Specific Station Interfaces**:
  - Complete station UI views for **Design**, **Developer**, **QA**, **DevOps**, **Pentesting / Security**, and **Release**.
  - Enforce interface-level visibility: configure which station components are visible or hidden depending on user role and project assignment.
- **Design Studio & Mock System**:
  - Implement the interactive mock design canvas, visual component specifications, and design token exporter.

### 2. Multi-Agent Orchestration & PR Reviewer Parity
- **PR Reviewer Parity (CodeRabbit / IBM Dexter)**:
  - Deepen integration based on [IBM_Dexter](https://github.com/dhruvinsights/IBM_Dexter) ([ibm-dexter.vercel.app](https://ibm-dexter.vercel.app/app/dashboard)).
  - End-to-end testing of unified diff rendering, AST security vulnerability flagging, automated review comments, and GitHub review posting.
- **Google AX & Sandcastle Agent Worker**:
  - Integrate multi-agent coordinator inside each station utilizing Google AX schemas and isolated Sandcastle execution environments.
- **Issue & Bug Triage Workflow**:
  - Connect PM issue creation with Developer assignment, QA verification, and bidirectional GitHub issue sync.
