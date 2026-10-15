# SOFTWARE KARKHANA
## Complete Product, Architecture, OSS Reuse & Execution Blueprint
**Version:** 1.0 · **Prepared:** 15 October 2026  
**Purpose:** Product source of truth for product, design, engineering, AI workflow, integrations, security and delivery.

> **Product thesis:** Software Karkhana is an executable software factory—not a chat wrapper, not a single coding agent, and not a dashboard full of disconnected mock screens. It coordinates intent, planning, people, agent workers, repository changes, verification, human decisions, release and learning through one evidence-backed lifecycle.

---

## 1. Executive summary

Karkhana should help a person or organization turn an idea into production software while retaining control over architecture, security, money, data and release decisions. It unifies the people and tools already used by a software team, and fills the gaps between them: shared project context, workflow state, delegated agent work, isolated execution, acceptance criteria, evidence, approvals and learning.

The product has three connected surfaces:

1. **Public experience** — a cinematic, editorial landing page that explains the factory and invites people to sign in or create a workspace.
2. **Workspace experience** — a progressive, Slack-like organization/workspace onboarding and role-aware home. New users see only what they have access to; empty states guide the next useful action.
3. **Factory experience** — project and role workspaces that coordinate the entire lifecycle from discovery to production feedback. Each module is connected to the same project graph and evidence ledger.

The system should be Google-first for its managed cloud, identity, model and productivity integrations, while remaining provider-agnostic at the worker/model interface. Ollama is a local testing provider, not the production default. GitHub and other external tools are adapters, not separate product islands.

**Completion means evidence exists.** An agent saying “done” is not sufficient. Each task needs acceptance criteria, execution record, verification result, linked artifact, and any required human approval.

## 2. Product principles and non-goals

### Principles
- **Progressive disclosure:** empty by default; reveal complexity when a workspace, product, project, team or workflow requires it.
- **One source of truth:** project state, permissions, tasks, artifacts, context and evidence are linked; no duplicated shadow status.
- **Humans own high-impact decisions:** architecture approval, security waivers, production deploys, destructive operations and policy exceptions require named authorized people.
- **AI is optional at every stage:** manual, AI-assisted, approval-required and automated modes are first-class.
- **Use OSS before reinventing:** adopt mature components where they fit, wrap them behind Karkhana contracts, and build only the factory-specific orchestration, domain model and algorithms.
- **Google-first, not Google-locked:** use Google Cloud/Gemini/Workspace by default; model, worker, Git and CI adapters must remain swappable.
- **Evidence-backed state:** every transition has explicit prerequisites, provenance, timestamps and actor identity.
- **Beautiful public surface, calm working surface:** marketing can be cinematic; engineering screens must optimize clarity, density, speed and trust.
- **No fake integrations:** demo adapters are visibly labelled; no green success state unless a real operation succeeded.
- **No AI slop:** use the Taste Skill during public-facing design work; inspect rendered screenshots and refine, rather than accepting first-pass generic layouts.

### Non-goals
- Rebuilding GitHub, Google Docs, Figma, a CI platform or every coding agent from scratch.
- Making every task autonomous by default.
- Copying Google logos, protected assets, exact proprietary page content or product branding. Use the supplied visual references as art direction and use real logos only where permitted and relevant (for example, a truthful integration list).
- Treating every repository in the research archive as production-ready or safe to embed.

## 3. Product hierarchy and entities

```text
User
 └─ Memberships / invitations
     └─ Organization (company)
         ├─ Policies, identity, billing, audit, integrations, knowledge
         ├─ Workspaces / Labs (optional grouping by division or program)
         │   ├─ Members, teams, role defaults, templates
         │   └─ Products
         │       ├─ Product profile and long-lived product context
         │       ├─ Ideas / opportunities
         │       │   ├─ Discovery research and evidence
         │       │   ├─ Multi-agent evaluation and metrics
         │       │   └─ Approval → optionally create a project
         │       └─ Projects
         │           ├─ Project brief, goals, constraints, stack, repos
         │           ├─ Team, roles, memberships, permissions
         │           ├─ Workflow graph and stage gates
         │           ├─ Epics → stories → tasks → runs
         │           ├─ Designs, architecture, ADRs and docs
         │           ├─ Branches, commits, PRs, reviews
         │           ├─ QA scenarios, executions, defects
         │           ├─ Security findings, waivers and evidence
         │           ├─ Dependencies, environments, pipelines
         │           ├─ Release, deployment, rollback and incidents
         │           ├─ Project context and learning records
         │           └─ Feedback, metrics and follow-up work
         └─ Portfolio views and cross-project approvals
```

### Core entities (minimum canonical data model)
- `User`, `Organization`, `Workspace`, `Membership`, `Invitation`, `Team`, `Role`, `PermissionPolicy`
- `Product`, `ProductContextVersion`, `Idea`, `IdeaEvidence`, `EvaluationRun`, `EvaluationMetric`, `ApprovalRequest`, `ApprovalDecision`
- `Project`, `ProjectBrief`, `ProjectGoal`, `ProjectConstraint`, `RepositoryConnection`, `ProjectMember`, `RoleAssignment`
- `WorkflowBlueprint`, `WorkflowInstance`, `WorkflowStage`, `StageTransition`, `Gate`, `GateDecision`
- `Epic`, `Story`, `Task`, `TaskDependency`, `AcceptanceCriterion`, `AgentRun`, `WorkerLease`, `RunEvent`, `RunArtifact`
- `DesignArtifact`, `ArchitectureDocument`, `ADR`, `APIContract`, `DependencyRecord`, `Environment`, `PipelineRun`
- `PullRequest`, `ReviewFinding`, `ReviewDisposition`, `TestPlan`, `TestScenario`, `TestExecution`, `Defect`
- `SecurityFinding`, `SecurityWaiver`, `ReleaseCandidate`, `Release`, `Deployment`, `RollbackPlan`, `Incident`
- `ContextItem`, `ContextLink`, `ContextShare`, `MemoryPromotion`, `FeedbackItem`, `AuditEvent`, `IntegrationConnection`, `SecretReference`

Every entity has tenant/org scope, stable ID, created/updated timestamps, actor/source, version, and lifecycle status. Mutable objects use optimistic concurrency/version checks. Hard deletion is limited by retention and audit policy.

## 4. User journeys and onboarding

### 4.1 Public landing page is a separate application surface
Build a dedicated public route/site; do not place the factory sidebar over the landing page. Design direction from the supplied reference:
- Near-black canvas with a broad ocean-blue/indigo glow, subtle grain and luminous horizon/smoke.
- Strong editorial typography, oversized headline, asymmetric split composition, large product preview, compact navigation, restrained rounded buttons.
- Scrolling sequence: hero and dashboard reveal → proof/integrations → “how the factory works” → capability cards → outcomes/case-study placeholders → testimonial placeholder → final CTA.
- GSAP ScrollTrigger for choreographed scroll transitions; Three.js only where it adds a real spatial effect, with a static poster fallback.
- Smooth smoke/wave transitions between dark and light sections; do not animate every element.
- Reserve clearly labelled slots for future product GIFs; do not invent customer logos, usage stats or testimonials.
- Respect reduced-motion preferences and mobile performance. Load 3D and video assets lazily.

Suggested hero copy: **“From ideas to software that ships.”** Supporting line: “One factory for people, AI agents and engineering workflows—from discovery through production.” CTA: “Create a workspace”; secondary CTA: “Explore how it works”.

**Taste Skill:** evaluate and install the current upstream skill after reviewing its license, source and scripts. Candidate upstream: https://github.com/Leonxlnx/taste-skill (the skill describes itself as `design-taste-frontend`). Use it for public landing pages and visual redesign; it explicitly is not a substitute for product-dashboard UX. Capture browser screenshots at desktop/tablet/mobile, critique composition, typography, spacing, contrast, motion and image choice, then run a look-and-fix pass.

### 4.2 First visit: two clear choices
First screen after landing:
- **Create a workspace** — for a new organization or team.
- **Join an existing workspace** — accept invitation, sign in, or request access.
- **Sign in** — existing account; after authentication route to the last accessible workspace or a workspace picker.
Avoid a large blank dashboard before identity and workspace selection are resolved.

### 4.3 New workspace setup (Slack-like progression, not a long form)
1. Sign in with Google; support enterprise OIDC/SAML later through a provider abstraction.
2. Ask for workspace/company name and optional avatar.
3. Ask the user’s role and intended outcome (founder, product, engineering, QA, security, DevOps, executive, other). This personalizes guidance, not authorization.
4. Ask whether to start with an empty workspace or one of 3–4 templates. **Default is empty.** Templates are opt-in:
   - Product discovery → delivery
   - Web application delivery
   - API/service delivery
   - Security-sensitive/regulated delivery
5. Offer invitations now or later; invitations are scoped to workspace and optionally product/project.
6. Show a short checklist: add product context, connect repository, invite team, configure workflow. Allow skip and resume.
7. Land on a useful empty state with one primary next action, not seeded fake data.

### 4.4 Existing workspace / invitation
- Invitation link resolves the organization, inviter, scope and role; user signs in then accepts/declines.
- If already authenticated, show the exact workspace and scope being joined.
- Before acceptance, show only invitation metadata, not project content.
- After acceptance, show only resources permitted by the granted membership.
- Expired/revoked invites offer a clear request-new-invite path.
- Never grant org-wide access simply because a person was invited to one project.

### 4.5 First product and project
A workspace can have zero products and zero projects. The UI should explain what to do next:
1. Create product: name, short description, target users, problem, desired outcomes, domain, current stage.
2. Optional context upload: existing docs, architecture, repository, roadmap, customer feedback, constraints, tech stack, links.
3. Context summary is generated with sources and uncertainty; owner edits and approves it.
4. Product page starts with product overview, context completeness, ideas and activity—not a wall of metrics.
5. Idea discovery is optional; create an idea manually or ask Gemini to brainstorm.
6. An idea becomes a project only after an explicit action/approval. The project wizard collects project goal, success criteria, scope, risks, repository, stack, environment constraints, security/compliance needs and team.
7. Choose a workflow template or start from a blank workflow. Stages can be configured later.
8. Invite/assign roles and connect integrations. The project opens with only the modules relevant to its current stage.

### 4.6 Empty-state rules
- No products: “Create your first product” + short explanation + optional template.
- Product but no ideas: “Describe an opportunity or brainstorm with Gemini.”
- Idea but no project: show evaluation, evidence and approval state.
- Project with no repository: offer connect repo, start a new repo, or manual-only mode.
- No assigned tasks: show project plan/next step, not an empty board with dummy cards.
- No tests/security scans/deployments: show “not configured” distinctly from “passed”.
- No permission: show a request-access state without exposing resource titles or counts.
- All demo data is clearly labelled and can be reset.

## 5. Information architecture and complete screen inventory

### Public and account
1. Landing page (separate from app shell)
2. Product lifecycle / capabilities page
3. Security, privacy and data handling page
4. Integrations page with real status
5. Sign in / sign out / account recovery
6. Create workspace / join workspace
7. Invitation acceptance and expired invite
8. Workspace picker / account profile

### Workspace and portfolio
9. Workspace home (empty-first, personalized)
10. Workspace members, teams and invitations
11. Workspace settings and policies
12. Product catalog
13. Product creation wizard
14. Product profile / overview
15. Product context and source library
16. Idea discovery and brainstorm
17. Idea detail / validation studio
18. Evaluation report and metric evidence
19. Approval inbox / decision detail
20. Project hub / project creation
21. Executive portfolio / manager rollup
22. Global search / command palette
23. Notifications and activity center

### Project and planning
24. Project overview / next-best-action
25. Project brief and goals
26. Project context hub
27. Team, role assignment and access
28. Workflow designer / workflow run history
29. Roadmap and dependency timeline
30. Epics, stories and tasks
31. Kanban board / backlog
32. Task detail drawer with acceptance criteria, context, activity and evidence
33. Requirements and acceptance ledger
34. Design studio / prototype gallery / comments / version history
35. Architecture workspace / system diagrams / ADRs / API contracts
36. Documentation editor and artifact library

### Engineering
37. Repository explorer / connection health
38. Developer home / assigned work
39. Task-to-agent run setup
40. Agent run live view (logs, tool calls, checkpoints, cost, stop/pause)
41. Diff and changed-file review
42. Branch/worktree manager
43. Pull request list and PR detail
44. AI review findings with triage and inline comments
45. Dependency inventory / licenses / versions / update policy
46. CI checks and validation evidence
47. Skills and instruction pack viewer
48. Agent/provider settings and run policies

### QA, security and delivery
49. QA board / feature readiness
50. Test plan and scenario editor
51. Manual test execution
52. Automation suite / run results / flaky test tracking
53. Defect detail / retest
54. Security posture / findings
55. Security guidelines and threat model
56. Pen-test evidence and waiver approval
57. DevOps dashboard / environment catalog
58. Pipeline editor / YAML review
59. Pipeline runs / artifacts / deployment logs
60. Release readiness checklist
61. Release notes / version / change log
62. Deployment approval / execution
63. Rollback plan / rollback execution
64. Production health / incidents / postmortem
65. Feedback triage / support signals

### Context, governance and platform operations
66. Shared Context timeline / live activity
67. Context explorer (decisions, learnings, evidence, sources)
68. Context sharing permissions and scopes
69. Memory promotion review (project → team → org)
70. Audit log / security events
71. Integration catalog / connection wizard / sync health
72. API key and secret-reference management (masked; never reveal stored secret)
73. Usage / model cost / budgets / quotas
74. Evaluation and agent quality dashboard
75. Workflow template library
76. Organization policy and autonomy controls
77. Admin health / queues / failed jobs / replay
78. Accessibility, profile and personal preferences

Each screen must specify: target role, allowed actions, empty/loading/error/permission states, source-of-truth entities, events emitted, API endpoints, audit events, responsive behavior and acceptance tests.

## 6. Role workspaces and access

Roles are configurable, not hard-coded. Suggested presets:
- Workspace owner/admin
- Executive/director
- Product manager/product owner
- Designer/design lead
- Architect
- Engineering lead
- Senior/junior developer
- Reviewer
- QA/QC manual tester
- Test automation engineer
- Security/AppSec/penetration tester
- DevOps/platform engineer
- Release manager
- SRE/operations/support
- Observer/guest
- Custom role

Users can hold multiple roles across projects. Navigation adapts to permission and assignment; it must not imply that a role alone grants access. Use RBAC plus attributes (organization, project membership, team, resource sensitivity, environment, action, approval policy). Enforce authorization server-side for every request and tool call. Use least privilege, explicit project grants, invitation scope, access reviews and audit history.

A project workspace has shared records and role-specific entry points. A QA user sees the test board and assigned features; a developer sees assigned tasks and PRs; a director sees permitted portfolio and approvals. All of them read the same underlying project state.

## 7. Lifecycle workflow

```text
Intent / idea
  → discover and validate
  → human approval (if policy requires)
  → product context + project brief
  → team onboarding and workflow selection
  → design and requirements
  → architecture and ADR approval
  → epics / stories / acceptance criteria
  → task scheduling and context assembly
  → isolated worker execution OR manual work
  → validation + evidence
  → PR and AI-assisted review
  → human review and merge
  → QA manual + automation
  → security review / waivers
  → CI/CD readiness
  → release readiness and approval
  → deploy / observe / rollback if needed
  → feedback / incident review
  → verified learning and memory promotion
```

Every stage is a configurable workflow node with prerequisites, inputs, outputs, owner, deadline/SLA, autonomy mode, retry policy, escalation route, evidence requirements and events. The project state machine is authoritative; role dashboards are views over it. A stage can be skipped only if the workflow policy permits it and the skip is recorded with actor, reason and impact.

### Autonomy modes (configurable at organization, workspace, project, team and task)
- **Manual:** people perform the work; Karkhana stores context and evidence.
- **AI-assisted:** AI drafts or analyzes; a person accepts or edits.
- **Approval-required:** AI prepares a consequential action; an authorized person approves the exact action.
- **Automated:** pre-authorized actions run within budgets, scopes and verification rules.
- **Disabled:** stage not used for this project, with rationale where policy requires.

Lower-level policy may tighten but cannot silently loosen a higher-level security policy. Destructive operations, secret access, merges to protected branches, production deployments, security waivers and policy changes default to human approval.

## 8. Shared Context: core differentiator

Context sharing is not “give every agent the entire chat history.” It is a governed, permission-filtered context service that lets a person, coding agent, QA agent, architect and later teammate inherit the right project truth without reconstructing it.

### 8.1 Context scopes
1. **Run context:** task, acceptance criteria, selected files, relevant instructions, budget; short-lived.
2. **Task thread:** attempts, comments, test outcomes and decisions for one task.
3. **Project context:** product brief, architecture, ADRs, constraints, dependencies, terminology, current status and project learnings.
4. **Team context:** standards, reusable review patterns, team conventions and runbooks.
5. **Organization context:** approved security policies, architecture patterns, legal rules and reusable lessons.
6. **Repository context:** Git-tracked Markdown and source links close to code.
7. **Live collaboration context:** messages, tasks, artifacts and session state shared among concurrently running agents and people.

### 8.2 Proposed design
- **Canonical store:** Karkhana database for access control, metadata, versioning, links, ACLs and provenance.
- **Portable repository layer:** optionally sync selected context to a repository as reviewable Markdown (`NOW.md`, `DECISIONS.md`, `LEARNINGS.md`, `CONSTRAINTS.md`, `GLOSSARY.md`, scoped detail records). Repo is a collaboration surface, not a bypass around Karkhana ACLs.
- **Live event channel:** publish context changes to active sessions over an event bus/WebSocket; subscribers re-fetch authorized deltas. Avoid using a simple local JSON file as the production multi-tenant source of truth.
- **Retrieval:** hybrid keyword + semantic search, filters by tenant/project/team/role/classification, recency and source quality; rank by relevance, authority, freshness and token cost.
- **Context pack builder:** creates a bounded task-specific packet with links, excerpts, constraints, acceptance criteria, changed files and relevant history. Include source and confidence, never just a blob of prose.
- **Lineage:** connect context item → source artifact/commit/comment → decision → task/run → verification result.
- **Promotion:** agents can propose learnings; only authorized humans promote team/org-wide. Keep scope, owner, review date, expiry and source evidence.
- **Conflict handling:** mark conflicting claims, prefer canonical artifacts and latest approved decisions, never silently overwrite an approved ADR. Ask a human when material ambiguity remains.
- **Privacy:** secrets never enter memory; redact tokens, credentials, personal data and tenant-specific information according to policy. Cross-project retrieval is denied by default, even within the same organization, unless policy explicitly allows it.
- **Staleness:** attach `valid_from`, `review_by`, `supersedes`, `source_version` and freshness signals. Stale context is visibly labelled.
- **Feedback:** consumers can mark useful/wrong/stale; measure retrieval precision and outcomes, not only number of memories.

### 8.3 OSS options and recommended usage
- **Project Context — https://github.com/monomind-ai-lab/project-context**: strongest candidate for repo-local, human-readable context pipeline. Pilot it in one repository and adopt its portable Markdown workflow where compatible.
- **shared-context-mcp — https://github.com/xfajarr/shared-context-mcp**: candidate for live cross-session messages/tasks/artifacts via MCP/WebSocket. Treat as a prototype or adapter until persistence, auth, tenant isolation, concurrency and security are audited.
- **TeamContext — https://github.com/hzhou9/TeamContext**: candidate for Git-native team context and branch/tool synchronization. New/small project and license/security review required.
- **shared-brain — https://github.com/Noble-Shiva/shared-brain**: useful minimal file-based coordination pattern for local or single-project workers, not a multi-tenant production database.
- **Google ADK sessions/state** and Karkhana’s own canonical event model should manage workflow state; do not confuse agent session state with durable product memory.
- Expose all context sources behind one Karkhana Context API and MCP adapter. Do not make users manage four branded memory products.

### 8.4 Context pack example
```yaml
task_id: TASK-482
purpose: "Implement SSO callback"
authority_order:
  - approved ADRs and security policy
  - current acceptance criteria
  - repository source and tests
  - project learnings
included:
  - project/constraints/auth.md#oidc
  - ADR-021#callback-flow
  - security/policy/oidc-pkce-v3
  - src/auth/callback.ts
  - TASK-482 acceptance criteria
excluded:
  - unrelated product discussions
  - other-project private context
  - secrets and raw credentials
budget:
  max_tokens: configurable
  source_links_required: true
```

## 9. Agent execution and orchestration

Karkhana owns the factory lifecycle even when it delegates execution to an OSS runner or external coding agent.

### Control plane
- Workflow definitions, state transitions, policy evaluation and gate enforcement
- Job queue, scheduling, leases, retries, cancellation and idempotency
- Agent/provider registry and capability matching
- Context assembly and scoped credential issuance
- Approval requests and evidence ledger
- Cost budgets, usage metering, audit, observability and evaluation
- Integration health and reconciliation

### Execution plane
- Short-lived isolated workers, containers, microVMs or customer-hosted runners
- Repository checkout/worktree/branch preparation
- Agent harness (Gemini CLI, ADK agent, Claude Code, Codex, etc.)
- Tool and MCP connections limited to the task
- Build/test/security commands and artifacts
- Logs, diffs, exit status, provenance and cleanup

### Worker contract
Every worker supports: `prepare → run → stream events → checkpoint → pause/resume where supported → cancel → collect artifacts → verify → teardown`. Each run gets a unique ID, idempotency key, time/resource limits, tenant/project/task scope, allowed tools, credential lease, network policy and output manifest.

A worker result includes exit code, changed files, commit/branch/PR links, tool-call trace, logs, tests and checks, model/provider metadata, cost, context pack version, acceptance-criterion mapping, verification status and human-review requirement. An agent response alone is never success.

### Agent graph
Use deterministic workflow nodes for predictable steps; use model-driven agents only where reasoning is needed. Support fan-out/fan-in for independent tasks, bounded retries, compensation, human gates, deadlines, and escalation. Persist state so process restarts do not lose workflow progress. Avoid unconstrained agent swarms.

### Algorithms Karkhana should own
- **Next-best-action ranking:** compute eligible actions from project state, gates, role/permission, dependencies, deadlines and risk; rank by blocker removal, user intent, impact and cost. Never show inaccessible actions.
- **Context pack selection:** combine authority tier, semantic/lexical relevance, recency, file/task linkage, token budget and permission filtering.
- **Evidence completeness score:** measure acceptance criteria mapped to tests/reviews/artifacts, not a vague AI confidence score.
- **Dependency impact graph:** link package/API/service/config to tasks, environments, vulnerabilities and releases; propagate change impact.
- **Workflow readiness evaluator:** deterministic policy rules plus AI explanations; policy decides, model explains.
- **Agent routing:** choose provider/worker based on capability, tool access, latency, cost, data residency and success rate.
- **Learning quality score:** source evidence, repeatability, freshness, usefulness feedback and privacy class determine promotion eligibility.
- **Portfolio risk aggregation:** combine overdue dependencies, failing evidence, security findings, blocked gates and stale approvals with explainable weights.
- **Cost/quality controller:** stop or request approval when run budgets, retry thresholds or risk thresholds are exceeded.

## 10. OSS reuse and integration strategy

Do not clone repositories wholesale into a monolith. For every candidate, record upstream URL, license, maintenance/activity, security posture, data model, API maturity, deployment footprint, tenancy model, upgrade path, extension points, threat model and exit strategy. Prefer upstream integration, pinned versions, adapter boundaries and reproducible builds over permanent forks.

### 10.1 Priority candidates
| Candidate | Potential use | Decision / guardrail |
|---|---|---|
| Google ADK Python — https://github.com/google/adk-python | Agent definitions, graph workflows, tools, state, human confirmation, evaluation | **Pilot as primary agent framework**; keep Karkhana workflow state and domain logic outside ADK-specific objects. |
| Google AX — https://github.com/google/ax | Task/sandbox orchestration concepts for high-scale execution | **Research prototype**; verify maturity, APIs and dependency on Agent Substrate before production adoption. |
| Google Cloud Scion — https://github.com/GoogleCloudPlatform/scion | Human + AI agent collaboration, harness lifecycle, parallel workspaces/worktrees | **Pilot as execution adapter**; validate current repo maturity, auth, multi-tenancy and operational fit. |
| Agent Substrate — https://github.com/agent-substrate/substrate | Stateful isolated worker runtime at scale | **Future scale option**, not required for initial deployment; upstream currently describes itself as pre-1.0. |
| Gemini CLI — https://github.com/google-gemini/gemini-cli | Coding agent, MCP, headless automation, extension and skill interfaces | **Supported worker adapter**, not the entire product architecture. |
| Genkit — https://github.com/genkit-ai/genkit | Application-level generative AI flows and provider integrations | Use selectively for app features where it reduces work; avoid duplicating ADK orchestration without a clear boundary. |
| MCP Toolbox — https://github.com/googleapis/mcp-toolbox | Governed database access tools for agents | **Use for approved database-tool patterns**; configure restricted queries, IAM, allowlists and read/write separation. |
| Google MCP samples — https://github.com/google/mcp | Deployment and integration examples for MCP on Google Cloud | Reference patterns only; samples are not a managed production service. |
| Project Context | Portable repo-bound project memory | Pilot for Git-tracked context artifacts. |
| shared-context-mcp | Real-time shared agent context | Prototype/adapter after security review. |
| TeamContext | Git-native team context | Evaluate alongside Project Context; avoid adopting two canonical context systems. |
| shared-brain | Simple shared files for agent coordination | Use for local prototype or simple worker collaboration only. |
| Taste Skill — https://github.com/Leonxlnx/taste-skill | Art direction and anti-generic frontend iteration | Use after license and script review for public-facing design. |

### 10.2 Google-first production baseline
- **Identity:** Google Identity / Cloud Identity and Workspace OAuth; add enterprise federation via standards.
- **Primary model:** Gemini through Vertex AI for production; explicit model/version configuration, quotas and regional policy.
- **Local test model:** Ollama via a provider adapter for offline smoke tests and inexpensive development. Do not treat Ollama output as equivalent to production model quality.
- **App hosting:** Cloud Run for web/API and worker jobs; evaluate GKE only when workload isolation or scale justifies it.
- **Data:** Cloud SQL for PostgreSQL as system of record; Cloud Storage for artifacts; Pub/Sub for domain events; BigQuery for analytics.
- **Secrets and encryption:** Secret Manager + Cloud KMS; secrets are server-side secret references, never client-readable values.
- **Build/deploy:** Cloud Build and Cloud Deploy, with GitHub Actions/GitLab/Jenkins adapters where customers already use them.
- **Agent tools:** MCP with explicit tool registry, per-tool schemas, user confirmation for sensitive actions, and per-run tool allowlists.
- **Productivity:** Google Docs/Drive/Chat/Gmail integration only with explicit scopes and user consent.
- **Design/prototype:** Google Stitch/Gemini where access and API terms support the required flow; retain Figma/Penpot/link/upload fallback. Never imply an integration works until credentials and contract tests pass.
- **Observability:** Cloud Logging, Monitoring and Trace; propagate correlation IDs from workflow to agent run to tool call.
- **Analytics:** BigQuery + Looker Studio or product-native reports.

### 10.3 Integration maturity labels
Each integration shows one of: `Not configured`, `Configured`, `Healthy`, `Degraded`, `Re-authentication required`, `Sync paused`, `Failed`. Demo mode must be visually obvious. Every adapter needs contract tests, retry/backoff, idempotency, webhook signature validation, replay tooling and a clear owner.

## 11. UI/UX direction and motion

### Public landing page
Use the reference’s asymmetric editorial layout, near-black backgrounds and ocean-blue lighting, not a generic template. Hero can occupy a large viewport; use real project UI screenshots or clearly marked future GIF slots. Use original Karkhana iconography and licensed assets. If showing Google/GitHub logos, show them only to communicate genuine compatibility and follow trademark rules.

### Product application
The app should not be a clone of the landing page. Use a calm, premium workspace:
- Left navigation adapts to workspace/product/project and user permissions.
- Top context bar: organization → workspace → product → project, global search, command palette, notifications, profile.
- Main canvas: current task or stage, meaningful summary and next actions.
- Optional AI companion panel, collapsible and context-aware; it must not consume the whole screen by default.
- Right drawers for details, evidence, approval and activity.
- Dense boards/tables when useful; rich editorial imagery only for product overview, design/prototype and empty states.
- Avoid dashboard KPI cards everywhere. Show metrics only when they answer a user question.
- Each screen has a distinct purpose, content hierarchy, real empty state, skeleton, error state, access-denied state and responsive layout.
- Keyboard navigation, visible focus, accessible contrast, reduced motion and screen-reader labels are mandatory.

### Motion
- GSAP + ScrollTrigger for landing-page storytelling and selected page transitions.
- Three.js for one or two meaningful hero scenes (ocean current / luminous factory network); keep geometry lightweight and provide a static fallback.
- CSS transitions for normal app feedback; avoid expensive 3D in task tables and editor screens.
- Use scroll-linked transforms carefully; no hijacking normal scroll, no motion that blocks reading.
- Respect `prefers-reduced-motion`; pause offscreen animation; lazy-load video, GIF and 3D assets.
- Benchmark Core Web Vitals and low-end mobile performance.

### Design quality process
1. Read the Taste Skill instructions and verify provenance/license.
2. Define a page-specific art direction; do not force the same hero pattern on every page.
3. Create one high-quality reference frame per major surface.
4. Implement semantic layout and real states before decorative animation.
5. Render screenshots at 1440px, 1024px, 768px and 390px widths.
6. Critique typography, composition, whitespace, contrast, image quality, alignment, interaction and accessibility.
7. Run a visual refinement pass; remove generic gradients, excessive cards, random glassmorphism, placeholder metrics and repeated icons.
8. Test motion, reduced motion, loading, empty, error and permission states.

## 12. Functional module requirements

### Product and idea discovery
Product context holds problem, users, business goals, constraints, stack, repositories, domain glossary, existing systems, feedback, decisions and source links. Context has versions and owners.
Idea generation supports multiple ideas, clustering, duplicates, assumptions, source-backed evidence, feasibility, strategic fit, ROI assumptions, cost, risk, dependencies, compliance, time-to-value and evidence quality. Every score includes rationale, inputs, confidence/uncertainty and links; do not fabricate precise financial projections.
Validation studio supports multi-agent critique and debate, counterarguments, unanswered questions, human edits, report export to HTML/PDF and approval routing. One idea can become one project, but only through explicit creation and permission checks.

### Project planning
Create epics, stories, tasks and subtasks with acceptance criteria, dependencies, owner, estimate, priority, risk, labels, milestone and links to designs/ADRs. Support board, list, timeline, backlog, filters, saved views, bulk edits, keyboard actions and audit history. GitHub Issues/Projects, Jira and Linear are adapters; the native tracker remains usable without them.

### Design and architecture
Design workspace stores prototype URLs/assets, version history, comments, decisions and approvals. Architecture workspace supports editable diagrams (Mermaid and/or structured graph), service boundaries, API contracts, data flows, threat model, ADRs, dependencies, operational characteristics and human sign-off. Generated documents remain editable, versioned and linked to source evidence.

### Developer and agent work
Developer dashboard prioritizes assigned tasks, blocked work, run history, PR reviews, validation failures and context updates. Agent runs support plan-before-write, diff previews, checkpoints, pause/cancel, tool-call visibility, resource budgets, isolated worktrees, scoped credentials, retry with changed strategy and cleanup. Manual coding is first-class.

### AI code review
Review agent annotates diff lines with severity, evidence and suggested fixes. Reviewers triage findings as valid, invalid, duplicate or accepted risk. Track false-positive rate, finding resolution and recurrence. AI never approves its own changes or bypasses branch protection.

### QA/QC
QA sees developer-ready features through events and the shared state model. Test plans map to acceptance criteria, requirements, risk and changes. Support manual execution, automation scripts, environment/build selection, evidence attachments, defects, retests, flaky tests, coverage gaps and sign-off. “Not run” is never “passed.”

### Security
Threat models, dependency/license inventory, SAST/DAST/secrets scanning, SBOM, vulnerability findings, owner, due date, fix PR, retest, exception expiry and risk acceptance. Pen-test results can be imported from external tools. Security policies can block release; waivers require named authority, scope, expiry and audit.

### DevOps and release
Environment registry (dev/stage/prod), secrets by reference, deployment configuration, editable YAML, pipeline runs, artifacts, provenance, approvals, rollback plan and health checks. Release readiness aggregates required QA/security/architecture/approval evidence. Production actions use least-privilege service accounts and explicit approval policy. Post-deploy monitoring and rollback are part of the workflow.

### Feedback and operations
Feedback can originate from manual submissions, issues, GitHub, support tools, incidents, telemetry and marketplace reviews. Preserve source links and privacy rules. Cluster themes, link to products/projects, let PMs accept/reject backlog suggestions, and promote only verified learnings.

## 13. Data and service architecture

### Logical service boundaries
- Identity and tenant directory
- Organization/workspace and policy service
- Product and idea service
- Project and team service
- Workflow/process engine
- Work item service
- Artifact/document service
- Integration/adapters service
- Agent orchestration service
- Worker gateway and sandbox manager
- Context and memory service
- Evidence/acceptance ledger
- QA/security/release domain services
- Notification service
- Audit and compliance service
- Usage/cost/evaluation analytics

Start with a **modular monolith** for domain APIs where that lowers operational complexity, with separate worker execution and event consumers. Define service boundaries and APIs early; split high-load or high-risk domains when evidence requires it. Do not begin with dozens of independently deployed microservices.

### Google Cloud reference architecture
- Web: Next.js/TypeScript on Cloud Run.
- API: typed REST/OpenAPI or RPC; Python for ADK/orchestration services, TypeScript where web/product logic benefits.
- Database: Cloud SQL PostgreSQL with tenant scoping and migrations.
- Events/jobs: Pub/Sub + Cloud Tasks; outbox pattern for reliable state-change events.
- Artifacts: Cloud Storage with signed URLs and retention controls.
- Secrets: Secret Manager + KMS.
- Model: Gemini/Vertex AI gateway; Ollama local adapter.
- Agent framework: ADK behind a Karkhana workflow/worker abstraction.
- Execution: Cloud Run Jobs initially; sandbox adapter for Scion/AX/Agent Substrate evaluation; customer-hosted runner later.
- Analytics: BigQuery.
- Observability: Cloud Logging/Monitoring/Trace with OpenTelemetry.
- IaC: Terraform or Google Cloud-native deployment configuration; dev/stage/prod isolation.

### Core event envelope
```json
{
  "event_id": "uuid",
  "event_type": "qa.signoff.recorded",
  "occurred_at": "ISO-8601",
  "tenant_id": "tenant",
  "workspace_id": "workspace",
  "product_id": "product",
  "project_id": "project",
  "actor": {"type": "user|agent|system", "id": "id"},
  "correlation_id": "workflow-or-run-id",
  "entity": {"type": "task", "id": "task-id", "version": 7},
  "payload": {},
  "schema_version": 1
}
```
Events are versioned, idempotent and permission-filtered. Consumers must tolerate duplicates and out-of-order delivery. Use a transactional outbox or equivalent to avoid database/event divergence.

## 14. Evidence and acceptance ledger

Each task contains:
- intent and acceptance criteria;
- planned approach and relevant context version;
- source branch/commit/worktree and changed-file list;
- commands/tools executed and exit statuses;
- tests and validation results;
- screenshots/logs/reports/artifacts;
- code review findings and dispositions;
- security/license/dependency results where applicable;
- QA evidence and sign-off;
- required approvals and their actor/policy;
- final status plus any residual risks.

Statuses distinguish `not started`, `ready`, `running`, `blocked`, `needs review`, `failed`, `verified`, `accepted with exception`, `cancelled`. “Completed” is a derived state requiring all configured criteria and gates. An exception never masquerades as a pass.

## 15. Security, privacy and governance

- Tenant isolation in database queries, object storage, vector retrieval, events, cache keys and worker namespaces.
- RBAC + ABAC, deny-by-default, server-side authorization, short-lived credentials and least privilege.
- No long-lived secrets in browser, prompt, repo memory, task output, logs or screenshots.
- Prompt-injection defenses: treat repository content, issue text and external pages as untrusted data; tool policies live outside retrieved content.
- Network egress controls, allowed-host policies and safe handling of package install scripts.
- Isolated execution with CPU/memory/time limits, filesystem boundaries, process limits, no privileged containers, cleanup and artifact scanning.
- Human approval for production deploy, branch protection bypass, destructive changes, credential rotation, data export and security waivers.
- Audit every consequential action with before/after state, actor, policy, evidence and correlation ID.
- Retention, export and deletion policies; data residency; configurable telemetry opt-out.
- Dependency license review, SBOM, pinned versions, signature/provenance verification and vulnerability monitoring.
- AI data handling: define whether prompts/results may be retained by providers, use enterprise controls and avoid sending unrelated tenant data.
- Rate limiting, quotas, cost ceilings, abuse detection and incident response.
- Regular threat modelling, penetration testing, backup/restore tests and disaster recovery exercises.

## 16. Observability, evaluation and product metrics

### Runtime
Workflow success/failure, stage duration, queue wait, worker start time, sandbox utilization, retry count, tool failures, adapter sync lag, event lag, DB latency, deployment health and cost per run/project.

### AI quality
Acceptance-criterion pass rate, tests added/passing, review precision/false positives, successful task completion after verification, human override rate, context retrieval relevance, stale-context incidence, escalation rate and cost per verified task. Measure by task class and provider; do not optimize only for tokens or agent self-reported success.

### Product outcomes
Time from idea approval to first verified change, lead time, blocked time, release frequency, change failure rate, reopened defects, security findings by age, adoption by role, onboarding completion, integration health and user satisfaction.

### Evaluation harness
- Golden task suites by language/framework/task type
- Regression evaluations for prompts, skills, tools and model upgrades
- Sandbox integration tests
- Workflow replay tests from recorded sanitized events
- Permission leakage tests across tenants/projects
- Prompt-injection and malicious repository tests
- Visual regression for major screens
- Human review sampling and incident postmortems

## 17. API and integration contracts

Expose stable versioned APIs for projects, context, work items, workflow actions, evidence, approvals and agent runs. Use OpenAPI/JSON Schema for request/response contracts. Webhooks are signed, replay-protected and idempotent. Integration adapters translate external events into canonical Karkhana events and reconcile remote/local state with visible conflict resolution.

Required adapter contract:
- connect / authorize / revoke;
- health check and capabilities;
- fetch/import;
- create/update where authorized;
- webhook validation;
- retry and dead-letter handling;
- sync cursor and replay;
- mapping configuration;
- audit trail;
- rate-limit handling;
- contract tests and test fixtures.

Never make product UI depend directly on one vendor’s SDK types. Map vendor-specific concepts into Karkhana domain objects and preserve external IDs.

## 18. Delivery roadmap (complete vision, incremental implementation)

This is sequencing, not a reduction of product scope.

### Track A — Foundation
- Repository, CI, environments, database migrations, tenant model, identity, authorization, audit.
- Public landing and separate app shell.
- Workspace onboarding/invitations, product/project hierarchy, empty states.
- Native work items, artifact storage, workflow engine, evidence ledger.
- Real integration health and demo-mode labels.

### Track B — Discovery to approved project
- Product context, sources and versioning.
- Idea generation, multi-agent evaluation, evidence-backed scoring, approvals.
- Project creation, team/role configuration, workflow templates.
- Context pack builder and first project memory.

### Track C — Design and plan
- Design/prototype adapters, architecture workspace, ADRs and diagrams.
- Epic/story/task planning, dependency graph, readiness gates.
- Role workspaces and event-driven updates.

### Track D — Build and review
- GitHub adapter, repo indexing, branch/worktree worker, ADK/Gemini CLI adapter.
- Isolated worker lifecycle, live logs, diff artifacts, budgets and cancellation.
- Validation pipeline, dependency inventory, PR sync and AI review triage.

### Track E — QA, security and ship
- Test plan/scenario editor, manual and automated execution, defects.
- Security findings, policy checks, waiver flow and audit.
- Cloud Build/Deploy adapters, release readiness, approval, rollback and deployment evidence.

### Track F — Context and scale
- Live shared context, Git sync, MCP tools, curated memory promotion.
- Portfolio read models, BigQuery analytics, cost/evaluation dashboards.
- Scion/AX/Agent Substrate experiments behind worker interfaces.
- Customer-hosted runner, cell isolation and residency controls as justified.

### Exit criteria for every track
- No critical authorization or tenant-isolation defects.
- End-to-end integration test on real services, plus a clear test adapter.
- Migrations, rollback and operational runbook.
- Logs/traces/metrics and audit events.
- Accessibility and responsive checks for user-facing changes.
- No fake success state; failure, retry and recovery are tested.
- Documentation, license inventory and owner are recorded.

## 19. Testing strategy and definition of done

### Test layers
1. Unit tests for domain rules, policies, scoring and transitions.
2. Contract tests for every provider/integration adapter.
3. Database integration tests with migrations and tenant isolation.
4. Workflow tests for success, failure, retry, timeout, cancellation and manual bypass.
5. End-to-end tests across idea → approval → project → task → run → verification → release evidence.
6. Security tests for cross-tenant access, prompt injection, secret leakage, SSRF, command injection and malicious repository content.
7. Visual tests for landing and key workspace screens at common breakpoints.
8. Load tests for portfolio queries, event processing, context retrieval and worker concurrency.
9. Restore and disaster recovery tests.

### Definition of done
- Acceptance criteria mapped to tests or explicit human evidence.
- No unexplained failing checks.
- Required review and approvals complete.
- Security/license/dependency checks recorded.
- Audit and trace correlation works end-to-end.
- Permission boundaries verified.
- Loading, empty, error, retry and reduced-motion states implemented.
- Responsive and keyboard-accessible.
- Docs, runbook, metrics and owner updated.
- Integration status accurately reflects real configuration and health.

## 20. Risks and mitigations

| Risk | Mitigation |
|---|---|
| OSS project is immature, changes rapidly or has unclear license | License/security/maturity review, pin versions, isolate behind adapter, define exit strategy |
| Too many frameworks create duplicate orchestration | ADK is the primary agent framework candidate; one Karkhana-owned workflow state machine; other tools are adapters |
| Context becomes noisy or leaks data | Scoped retrieval, provenance, redaction, human promotion, expiry, cross-project denial by default |
| Dashboard becomes crowded | Empty-first progressive disclosure, role-aware navigation, contextual next action, hide unconfigured modules |
| AI output is trusted without proof | Evidence ledger, deterministic checks, human gates, acceptance mapping |
| Google dependency becomes lock-in | Provider abstractions, portable artifacts, standard protocols, data export and tested fallback |
| Visual design becomes generic AI slop | Taste Skill, deliberate art direction, real references, screenshot review and iterative correction |
| Integration says healthy when broken | Heartbeats, contract tests, visible sync lag/errors, no optimistic success state |
| Agent execution exposes credentials/code | Isolated workers, scoped short-lived credentials, egress rules, artifact scanning |
| Cost explodes at scale | Per-tenant budgets, routing, caching, run caps, stop thresholds and cost dashboard |

## 21. Open decisions to resolve before production

1. Tenant isolation model: pooled first with strict RLS and storage namespaces, or cell-based from the first deployment?
2. Initial auth: Google sign-in only for first release, with enterprise federation interface prepared?
3. First coding worker: Gemini CLI, ADK-managed tools, Scion adapter, or a small owned runner?
4. Which repository host is the first fully supported adapter?
5. Is native work tracking canonical, or is an external tracker allowed to own tasks for selected projects?
6. Context retention and org-memory approval roles.
7. Data residency and provider data-retention requirements.
8. Production deployment policy and required sign-off quorum.
9. Supported initial language/framework matrix.
10. Which design tool integrations have usable APIs and approved credentials at implementation time?

Record decisions as ADRs with alternatives, evidence, trade-offs, owner and review date.

## 22. Immediate next actions

1. Audit the uploaded HTML as a reference implementation: extract its screens, data model, workflow concepts and useful interaction patterns; explicitly mark assumptions that need revision.
2. Inventory the research archive into a repository matrix: project, purpose, language, license, maintenance, security, overlap, integration path, adoption decision.
3. Establish the Karkhana canonical domain model and event envelope before wiring agents.
4. Implement onboarding and empty states with real tenant/project permissions.
5. Define the worker contract and acceptance/evidence ledger.
6. Pilot ADK + Gemini on Vertex AI; add Ollama as a local provider adapter.
7. Pilot Project Context for repository-local memory; evaluate shared-context-mcp for live coordination behind the Context API.
8. Test Scion/AX/Agent Substrate as replaceable execution backends, not hard dependencies.
9. Build the landing page with the ocean-flow art direction and Taste Skill; keep it separate from the product shell.
10. Deliver one true end-to-end vertical slice with real integrations and failure handling before expanding the remaining modules.

## 23. Reference links

### User-supplied candidates
- Google AX: https://github.com/google/ax
- Google ADK Python: https://github.com/google/adk-python
- Google Cloud Scion: https://github.com/GoogleCloudPlatform/scion
- Agent Substrate: https://github.com/agent-substrate/substrate
- Project Context: https://github.com/monomind-ai-lab/project-context
- Shared Context MCP: https://github.com/xfajarr/shared-context-mcp
- TeamContext: https://github.com/hzhou9/TeamContext
- shared-brain: https://github.com/Noble-Shiva/shared-brain

### Additional researched Google ecosystem
- Gemini CLI: https://github.com/google-gemini/gemini-cli
- Genkit: https://github.com/genkit-ai/genkit
- MCP Toolbox for Databases: https://github.com/googleapis/mcp-toolbox
- Google MCP examples: https://github.com/google/mcp
- Taste Skill: https://github.com/Leonxlnx/taste-skill

### Evidence notes
- ADK describes a code-first, modular agent framework with graph workflows, tool integrations, human confirmation and evaluation: https://github.com/google/adk-python
- Scion describes agent collaboration with multiple harnesses, workspaces/worktrees and local-to-cloud operation: https://github.com/GoogleCloudPlatform/scion
- Agent Substrate describes a framework-agnostic runtime for isolated, stateful agent sandboxes and currently labels itself pre-1.0: https://github.com/agent-substrate/substrate
- AX documentation describes a task execution control plane and Redis-backed reconciliation with Agent Substrate; verify maturity before adoption: https://github.com/google/ax
- Project Context describes repo-local, Git-tracked Markdown context and a human approval step: https://github.com/monomind-ai-lab/project-context
- shared-context-mcp describes real-time agent messages, tasks, artifacts and session context: https://github.com/xfajarr/shared-context-mcp
- TeamContext describes Git-native context synchronization across teammates and coding tools: https://github.com/hzhou9/TeamContext
- MCP Toolbox describes governed database tools with integrated auth and observability: https://github.com/googleapis/mcp-toolbox
- Gemini CLI describes MCP integration, custom extensions, headless operation and sandboxing: https://github.com/google-gemini/gemini-cli
- Genkit provides application-oriented AI flows and provider integrations; use only where it complements the ADK boundary: https://github.com/genkit-ai/genkit
- Taste Skill is an external community project; review current upstream instructions, license and scripts before installing: https://github.com/Leonxlnx/taste-skill

**Final principle:** Build the factory mechanisms that make work coherent—workflow state, permissions, context, evidence, policy, integration contracts and learning. Reuse engines and tools where they are mature. Keep people in control of consequential decisions. Make the product visually distinctive without sacrificing usability or trust.
