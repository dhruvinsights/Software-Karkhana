# UI plan

> **Blueprint alignment:** this plan implements Blueprint §4 (user journeys and onboarding), §5 (information architecture and complete screen inventory), §6 (role workspaces), §11 (UI/UX direction and motion) and §12 (functional module requirements). All 78 screens from the Blueprint are inventoried; v2.0 builds the subset required for Track A + D.

Location: `web/` rebuilt in place. Stack: React, Vite, Tailwind v4, `motion/react`, Phosphor icons, react-query. No UI data is hardcoded; everything comes from `/api/*`.

## Design direction (Blueprint §11)

A dark, spacious software-factory studio: navy-to-blue gradient hero, big bold sans headline with one italic emphasis word, calm tonal surfaces, one blue accent.

**Public landing page** (Blueprint §11): asymmetric editorial layout, near-black backgrounds and ocean-blue lighting — not a generic template. Hero occupies a large viewport; use real project UI screenshots or clearly marked GIF slots. Use original Karkhana iconography. Google/GitHub logos only where genuine compatibility is communicated and trademark rules are followed.

**Product application** (Blueprint §11): calm, premium workspace — not a clone of the landing page. Left navigation adapts to workspace/product/project and user permissions. Top context bar: organization → workspace → product → project, global search, command palette, notifications, profile. Main canvas: current task or stage, meaningful summary and next actions. Optional AI companion panel, collapsible. Right drawers for details, evidence, approval and activity.

## One locked theme

- Single palette in `web/src/styles.css` as CSS variables and Tailwind `@theme` tokens. Landing, sign-in, onboarding and the app shell all use these tokens; no per-page colors.
- Surfaces follow Material 3 tonal steps (`design.md`): background → surface → surface-container → surface-container-high. Large rounded shapes (16-28 px), 8 px spacing grid, generous padding.
- Accent: one blue. No purple gradients, no pure black or white. Text uses off-white and muted grey.
- Font: a sans display face (Geist or Roboto Flex), not Inter. Italic serif-like accent word in the headline only.
- Dark only. No light sections mixed in.
- `prefers-reduced-motion` turns animations off.

## Design quality process (Blueprint §11)

1. Read the Taste Skill instructions and verify provenance/license (upstream: https://github.com/Leonxlnx/taste-skill).
2. Define a page-specific art direction; do not force the same hero pattern on every page.
3. Create one high-quality reference frame per major surface.
4. Implement semantic layout and real states before decorative animation.
5. Render screenshots at 1440px, 1024px, 768px and 390px widths.
6. Critique typography, composition, whitespace, contrast, image quality, alignment, interaction and accessibility.
7. Run a visual refinement pass; remove generic gradients, excessive cards, random glassmorphism, placeholder metrics and repeated icons.
8. Test motion, reduced motion, loading, empty, error and permission states.

## Motion (Blueprint §11)

- GSAP + ScrollTrigger for landing-page storytelling and selected page transitions.
- Three.js for one or two meaningful hero scenes; keep geometry lightweight and provide a static fallback.
- CSS transitions for normal app feedback; avoid expensive 3D in task tables and editor screens.
- Respect `prefers-reduced-motion`; pause offscreen animation; lazy-load video, GIF and 3D assets.
- Benchmark Core Web Vitals and low-end mobile performance.

## Complete screen inventory (Blueprint §5)

All 78 screens; v2.0 scope is marked **✅**, future tracks are marked with their track letter.

### Public and account
| # | Screen | v2 scope |
|---|---|---|
| 1 | Landing page (separate from app shell) | ✅ |
| 2 | Product lifecycle / capabilities page | Track B |
| 3 | Security, privacy and data handling page | ✅ (basic) |
| 4 | Integrations page with real status | ✅ |
| 5 | Sign in / sign out / account recovery | ✅ |
| 6 | Create workspace / join workspace | ✅ |
| 7 | Invitation acceptance and expired invite | ✅ |
| 8 | Workspace picker / account profile | ✅ |

### Workspace and portfolio
| # | Screen | v2 scope |
|---|---|---|
| 9 | Workspace home (empty-first, personalized) | ✅ |
| 10 | Workspace members, teams and invitations | ✅ |
| 11 | Workspace settings and policies | ✅ |
| 12 | Product catalog | Track B |
| 13 | Product creation wizard | Track B |
| 14 | Product profile / overview | Track B |
| 15 | Product context and source library | Track B |
| 16 | Idea discovery and brainstorm | Track B |
| 17 | Idea detail / validation studio | Track B |
| 18 | Evaluation report and metric evidence | Track B |
| 19 | Approval inbox / decision detail | Track B |
| 20 | Project hub / project creation | ✅ |
| 21 | Executive portfolio / manager rollup | Track C |
| 22 | Global search / command palette | ✅ |
| 23 | Notifications and activity center | ✅ (basic) |

### Project and planning
| # | Screen | v2 scope |
|---|---|---|
| 24 | Project overview / next-best-action | ✅ |
| 25 | Project brief and goals | ✅ |
| 26 | Project context hub | ✅ |
| 27 | Team, role assignment and access | ✅ |
| 28 | Workflow designer / workflow run history | Track C |
| 29 | Roadmap and dependency timeline | Track C |
| 30 | Epics, stories and tasks | ✅ (tasks only for v2) |
| 31 | Kanban board / backlog | ✅ (basic) |
| 32 | Task detail drawer with acceptance criteria, context, activity and evidence | ✅ |
| 33 | Requirements and acceptance ledger | ✅ |
| 34 | Design studio / prototype gallery / comments / version history | Track C |
| 35 | Architecture workspace / system diagrams / ADRs / API contracts | Track C |
| 36 | Documentation editor and artifact library | Track C |

### Engineering
| # | Screen | v2 scope |
|---|---|---|
| 37 | Repository explorer / connection health | ✅ |
| 38 | Developer home / assigned work | ✅ |
| 39 | Task-to-agent run setup | ✅ |
| 40 | Agent run live view (logs, tool calls, checkpoints, cost, stop/pause) | ✅ |
| 41 | Diff and changed-file review | ✅ |
| 42 | Branch/worktree manager | ✅ |
| 43 | Pull request list and PR detail | ✅ |
| 44 | AI review findings with triage and inline comments | ✅ |
| 45 | Dependency inventory / licenses / versions / update policy | Track D |
| 46 | CI checks and validation evidence | Track D |
| 47 | Skills and instruction pack viewer | Track D |
| 48 | Agent/provider settings and run policies | ✅ |

### QA, security and delivery
| # | Screen | v2 scope |
|---|---|---|
| 49 | QA board / feature readiness | Track E |
| 50 | Test plan and scenario editor | Track E |
| 51 | Manual test execution | Track E |
| 52 | Automation suite / run results / flaky test tracking | Track E |
| 53 | Defect detail / retest | Track E |
| 54 | Security posture / findings | Track E |
| 55 | Security guidelines and threat model | Track E |
| 56 | Pen-test evidence and waiver approval | Track E |
| 57 | DevOps dashboard / environment catalog | Track E |
| 58 | Pipeline editor / YAML review | Track E |
| 59 | Pipeline runs / artifacts / deployment logs | Track E |
| 60 | Release readiness checklist | Track E |
| 61 | Release notes / version / change log | Track E |
| 62 | Deployment approval / execution | Track E |
| 63 | Rollback plan / rollback execution | Track E |
| 64 | Production health / incidents / postmortem | Track E |
| 65 | Feedback triage / support signals | Track F |

### Context, governance and platform operations
| # | Screen | v2 scope |
|---|---|---|
| 66 | Shared Context timeline / live activity | ✅ (read-only v2) |
| 67 | Context explorer (decisions, learnings, evidence, sources) | ✅ |
| 68 | Context sharing permissions and scopes | Track F |
| 69 | Memory promotion review (project → team → org) | Track F |
| 70 | Audit log / security events | ✅ |
| 71 | Integration catalog / connection wizard / sync health | ✅ |
| 72 | API key and secret-reference management (masked; never reveal stored secret) | ✅ |
| 73 | Usage / model cost / budgets / quotas | ✅ |
| 74 | Evaluation and agent quality dashboard | Track F |
| 75 | Workflow template library | Track C |
| 76 | Organization policy and autonomy controls | Track C |
| 77 | Admin health / queues / failed jobs / replay | ✅ |
| 78 | Accessibility, profile and personal preferences | ✅ |

## Onboarding journey (Blueprint §4)

Implements Blueprint §4.2–4.5 (Slack-like progression, not a long form):

1. Landing: **two clear choices** — "Create a workspace" or "Join an existing workspace" (screen 6). Sign-in routes to workspace picker (screen 8).
2. New workspace setup (screens 6 → 9):
   - Sign in with Google / Firebase.
   - Ask workspace/company name and optional avatar.
   - Ask the user's role (personalizes guidance, not authorization).
   - Ask whether to start empty or from a template. **Default is empty.** Templates: product discovery → delivery, web app delivery, API/service delivery, security-sensitive delivery.
   - Offer invitations now or later.
   - Short checklist: connect repo, invite team, configure workflow. Allow skip and resume.
3. Land on workspace home (screen 9) with one primary next action; no seeded fake data.

### Empty-state rules (Blueprint §4.6)
- No projects: "Create your first project" + short explanation.
- Project with no repository: offer connect repo, start a new repo, or manual-only mode.
- No assigned tasks: show project plan/next step, not an empty board with dummy cards.
- No tests/security scans/deployments: show "not configured" distinctly from "passed".
- No permission: show a request-access state without exposing resource titles or counts.
- All demo data is clearly labelled and can be reset.

## Role workspaces (Blueprint §6)

The sidebar (`GET /api/nav`) is built per role. Each role sees a distinct entry point into the same underlying project state:

| Role (v2.0) | Primary entry points |
|---|---|
| pm | Ideas, evaluation status, approval inbox, project overview |
| director | Approval inbox, portfolio, ledger health, usage |
| developer | Assigned tasks, agent runs, PRs, AI review triage |
| lead | Learnings to verify, merge-ready PRs, runner and provider health, context |

## Pages

**Public**
- Landing (taste-skill rules): hero fills the viewport, headline max 2 lines, subtext max 20 words, 1 primary + 1 secondary CTA, stat counters from `/api/public/stats` (real counts or hidden), "What the factory does" list, one proof section, FAQ, footer. No fake logos or testimonials; if there is none, the section is not rendered.
- Sign-in (Firebase or dev user picker, based on `/api/config`).

**Onboarding** (same theme, real API): create or join organization → confirm role → choose model provider (shows live Gemini/Ollama health) → connect repo → invite team → done.

**App shell**: sidebar built from `GET /api/nav`, so a role sees only its own pages. Topbar shows provider health and runner status.

**Per-role dashboards** (from `GET /api/dashboard`): PM, Director, Developer, Lead.

**Shared pages**: Projects, Project detail (evaluation gate, board, runs), Run detail (phase, test output, honest runner state), PR review and triage (engine/model shown, clean-review state), Learnings, Context (explorer + shared context timeline), Ledger (with chain verify), Team, Settings (providers, runner, review engine, usage/budgets, API keys), Audit log.

## States

Every page has loading skeletons, empty states with a next action, and error states that show the API's message. Forms validate, show server errors and disable while submitting. Each screen specifies: target role, allowed actions, empty/loading/error/permission states, source-of-truth entities, events emitted, API endpoints, audit events, responsive behavior and acceptance tests (Blueprint §5 requirement).

### Accessibility (Blueprint §11)
Keyboard navigation, visible focus, accessible contrast, reduced motion and screen-reader labels are mandatory for every screen.

## Quality gates

- `tsc -b` and `vite build` clean.
- Playwright screenshots at 1440 and 390 wide for landing, sign-in, onboarding, each dashboard.
- Keyboard and focus check, contrast check (WCAG 2.2 AA), copy self-audit (no filler, no duplicate CTAs).
- Grep gate: no `mock`, `faker`, `lorem`, hardcoded project or person names, or other vendors' product names in `web/src`.
- Visual regression for major screens at each breakpoint.

## Build order

1. Tokens, base components (Button, Card, Badge, Table, Dialog, Skeleton, EmptyState, Toast).
2. Auth + shell + `/api/nav`.
3. Onboarding (screens 6, 7, 8, 9).
4. Dashboards (role workspaces).
5. Project, run, PR review pages (screens 20, 24–27, 30–33, 37–44, 66–67, 70–73, 77–78).
6. Context, Team, Settings, Audit log.
7. Landing page last, after the real stats endpoint exists.
8. Future tracks: screens 12–19 (discovery), 28–29, 34–36 (design/plan), 49–65 (QA/security/ship), 68–69, 74–76 (context/scale).
