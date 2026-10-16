# 03. Multi-Agent Orchestration & Google AX Integration

## 🤖 In-Station Multi-Agent Coordinators

Software Karkhana structures AI assistance not as a generic chat prompt, but as specialized, role-bound **Autonomous Station Agents** coordinated by an overarching task scheduler.

---

## 🛠️ Google AX (Agent eXperience) & Sandcastle Foundations

### 1. Google AX Capabilities
- **Structured Tool Registry**: Standardized JSON schema interfaces for file reading, code generation, linting, test execution, and git operations.
- **Context Grounding**: Multi-tier context injection (Workspace rules + Product architecture guidelines + Story constraints).
- **Step-by-Step Chain-of-Thought with Verification**: Before any tool output is committed, the agent must pass internal invariant validation.

### 2. Sandcastle Isolated Execution Runtimes
- **Confined Execution**: Agents run commands inside containerized sandboxes with restricted network access, preventing unverified outbound calls or system tampering.
- **Resource Constraints**: Strict CPU, memory, and timeout bounds on test runners.
- **Cryptographic Result Ingestion**: Patch artifacts generated inside the sandbox are signed and verified against the control plane before PR creation.

---

## 👥 Specialized Station Agents

```
┌─────────────────────────────────────────────────────────────┐
│                   FACTORY CONTROL PLANE                     │
└──────────────────────────────┬──────────────────────────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│  Idea Scout  │        │ Architecture │        │  ADK Coder   │
│    Agent     │        │   Verifier   │        │    Worker    │
│  (PM Studio) │        │ (ADR Studio) │        │ (Dev Studio) │
└──────┬───────┘        └──────┬───────┘        └──────┬───────┘
       │                       │                       │
       └───────────────────────┼───────────────────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│ Test Matrix  │        │ AppSec Audit │        │   Release    │
│   Gen (QA)   │        │ Agent (Sec)  │        │ Marshal (Ops)│
└──────────────┘        └──────────────┘        └──────────────┘
```

1. **Idea Scout Agent (PM Studio)**: Researches competitor features, analyzes market fit, and drafts JTBD statements.
2. **Architecture Verifier Agent (Architecture Studio)**: Audits ADR drafts against system scalability rules and flags schema breaking changes.
3. **ADK Coder Worker (Developer Studio)**: Applies precise file diffs, executes test suites locally, and ensures clean linting.
4. **Test Matrix Generator (QA Studio)**: Generates combinatorial edge cases and verifies regression safety.
5. **AppSec Audit Agent (Security Studio)**: Analyzes dependencies for CVEs and scans PR diffs for secret leakage.
6. **Release Marshal (Operations Studio)**: Generates rollback plans, verifies Cloud Run health probes, and signs production gate tokens.
