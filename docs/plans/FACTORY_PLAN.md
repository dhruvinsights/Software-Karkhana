# Software Karkhana: Factory Build Plan

Status: proposed 2026-10-16. Each phase ends with a demo of a working flow, backed by the real API and database (no localStorage, no hardcoded data).

## Vocabulary

| Term | Meaning |
|---|---|
| Organization | The company (e.g. IBM). Owns many workspaces. |
| **Workspace = Product** | One workspace per product (e.g. Db2). Created together with the product's detailed description and its GitHub repo. It is the security boundary: chat, members, ideas and projects all live inside it. |
| Idea | A proposal inside a product. It is evaluated by AI, reviewed and approved. It is not a project. |
| Project | Created from an approved idea with one click. Holds epics, issues, teams and the role workspaces. |
| Station | A role workspace inside a project: Product, Leadership, Design, Development, QA, Security, DevOps (CI/CD), Release. |

## Target UX

```
┌ Left rail ───────────────┐ ┌ Main ───────────────────────────────────────────┐
│ [Workspace switcher]     │ │ Home: product overview (everyone)               │
│ Home                     │ │       my tasks · ideas to review · my projects  │
│ DMs                      │ │       recent channel activity                   │
│ Activity          (3)    │ │                                                 │
│ Ideas                    │ │ Project: header + tabs filtered by my stations  │
│ ── Your projects ──      │ │   Overview · Issues · Board · Design · Dev ·    │
│   Billing v2             │ │   QA · Security · CI/CD · Release · Team        │
│   Search revamp          │ │                                                 │
│ ── Channels ──           │ │ DMs/Channels: full-width chat with threads      │
│   # general              │ │                                                 │
│   # billing-dev          │ │ AI companion: right panel, opened on demand,    │
│ [me · invite · settings] │ │   aware of the page it's opened from            │
└──────────────────────────┘ └─────────────────────────────────────────────────┘
```

- The left rail holds only places where people talk or work: Home, DMs, Activity, Ideas, my projects, my channels. All the studio screens move inside a project.
- Chat and activity move from the top-right slide-overs into the left rail and get full pages.
- There is one `#general` channel per workspace. Teams create their own channels, which are visible only to members. DMs work between any two workspace members.
- Every page has a URL, so links in emails and notifications open the exact idea, issue or PR.

## Architecture decisions (with context)

**D1. Tenancy: Org → Workspace (=Product, 1:1) → Project.**
*Context:* workspace and product are separate tables today, and a workspace can hold many products. Folding them 1:1 matches how you describe the flow and keeps one security boundary. *Implementation:* keep the `products` table and add `UNIQUE(workspace_id)`. That way existing foreign keys (`ideas.product_id`, `projects.product_id`) keep working. *Scales:* every query filters by `workspace_id`, which is indexed. It can be partitioned or sharded by workspace later if needed.

**D2. Authorization: workspace role + project stations, checked on the server.**
*Context:* today `users.role` is one global value, `list_projects` returns everything, and `project_members` is never checked. *Decision:*
- A workspace member has a *title* (PM, Director, Developer…), which drives defaults and approvals.
- A project member has *stations* (which role workspaces they can open). Stations are independent of title, as you asked.
- One dependency, `require_project(project_id, station=None)`, guards every project endpoint.
- The UI only hides what the server already denies.

*Scales:* the check is one indexed lookup on `(project_id, user_id)`, and it can be cached per request.

**D3. Frontend: URL routing + react-query; the server is the source of truth.**
*Context:* most screens read and write a 1,100-line store kept in localStorage, which is why nothing persists. `react-router` and `react-query` are already installed. *Decision:* build the new shell on routes (`/w/:ws/home`, `/w/:ws/p/:projectId/:tab`, `/w/:ws/c/:channelId`). The store shrinks to session and UI state only. Existing studio screens are mounted in project tabs and marked "preview" until their phase rebuilds them.

**D4. Realtime: keep our FastAPI WebSocket gateway, fan out through Postgres LISTEN/NOTIFY, then Redis.**
*Context:* a working WebSocket server already exists, but it keeps connections in memory. On Cloud Run with more than one instance, users on different instances wouldn't see each other's messages. It also broadcasts DMs to the whole workspace. *Options:*
- (a) Managed chat SDK (Stream, Ably, Pusher): fastest to a polished chat, paid, data outside our database, and linking chat to tasks/PRs needs glue code.
- (b) Firestore: Google-native and realtime out of the box, but it puts chat data in a second database with a second set of permission rules.
- (c) Our gateway with Postgres LISTEN/NOTIFY now, and Memorystore Redis pub/sub when we pass a few thousand concurrent sockets. No new infrastructure today, and one database and one permission model.

*Recommendation:* (c). Agents posting progress and messages linked to an issue/PR/build/approval are the features that make our chat worth more than a Slack clone, and they're easiest when chat lives next to that data.

**D5. Notifications + email: one event, three deliveries.**
- Every notable event (invite, reviewer added, mention, assignment, approval) writes an `activity_events` row, gets pushed over the WebSocket, and enqueues an email in an outbox table.
- A background worker sends the emails through Resend (already configured) with retries, so an email outage never fails a user's request.

**D6. Work tracking: GitHub-issues style, one `issues` table.**
- Types: epic, story, task, bug. `parent_id` builds the hierarchy.
- Many assignees, labels, milestone, issue templates, generated branch name and PR title, linked PRs/runs.
- Per-project workflow states. Defaults: Backlog → Ready → In progress → In review → Ready for QA → In QA → QA passed → Done.
- Epics can be AI-generated from the approved idea plus product context; a human always confirms them.

**D7. Agent execution: harness × sandbox.**
- Harness (who does the work): Bob, Claude Code, Gemini CLI, Antigravity, our ADK coder.
- Sandbox (where it runs): the developer's local machine, Docker, Google AX, Cloud Run Job.
- Patterns ported from Sandcastle and from v1's orchestrator: phase prompts, gate verifier, failure classifier.
- Production target: Google AX. Dev and testing: Claude, Gemini, Bob.

**D8. Local development: `@software-karkhana/agent` (npm CLI) + VS Code extension, sharing one TypeScript core.**
*Feasibility:* yes. This is the pattern behind GitHub Actions self-hosted runners and Copilot/Cursor background agents.
- The local agent dials **out** to our backend over a WebSocket, so it needs no inbound ports and works behind corporate firewalls.
- The developer picks a local repo folder once. The dashboard dispatches *typed* jobs ("run plan for ISSUE-42 with harness=bob"), and the agent runs them in a git worktree.
- It streams events, plans, diffs and test results back, and pushes the branch and opens a PR.

*Safety:*
- The agent only accepts known job types, never raw shell commands from the server.
- Risky steps (push, dependency install, writes to risk-zone files) need local approval.
- Model API keys stay on the developer's machine.

The VS Code extension adds the plan/diff/approval UI inside the editor. The CLI serves terminal users and other editors.

**D9. Design station: requirements + guideline docs → multi-screen mockups.**
- The designer uploads guideline `.md` files. Gemini generates HTML/Tailwind screens from the project requirements, and each screen can be refined with a prompt. Screens render in sandboxed iframes.
- Gemini image generation supplies imagery.
- Google Stitch: check whether we have API/MCP access before depending on it. If we don't, support importing Stitch's HTML/Figma exports.

**D10. Project memory.**
- Use the existing `context_entries` and `learnings` tables (pgvector).
- Every handoff (decision, review, QA result, release) writes an entry.
- Agents receive the relevant entries in their prompt, and similar past projects are found by vector search at idea-evaluation time.

## Phases

| # | Phase | Done when |
|---|---|---|
| **1** | **Shell & navigation** | New left rail (Home, DMs, Activity, Ideas, projects, channels). Project workspace with tabs filtered by station. Chat as full pages with real channels/DMs; DMs no longer broadcast to everyone. `/api/home`. Project list filtered by membership. |
| 2 | Workspace = Product creation | Org + workspace wizard with detailed product description and GitHub connect. Invite emails describing Karkhana. Join flow. Product overview on Home. |
| 3 | Ideas → approval → project | AI brainstorm + evaluation report (business, budget, impact, research). Reviewer assignment + notification + email. Approve/reject. One-click project creation from an approved idea. |
| 4 | Project, teams & issues | Invite teams/people with stations. GitHub-style issues, board, templates, AI epic generation, visible to all project members. |
| 5 | Realtime chat completion | Team channels, threads, reactions, edits, typing, unread counts, LISTEN/NOTIFY fan-out, linking messages to issues/PRs, agent posts. |
| 6 | Dev station | Harness × sandbox layer, local agent CLI + VS Code extension, plan → approve → multi-agent build → report, PR link, dependency manifest. |
| 7 | Design station | Guidelines, multi-screen AI mockups, review comments, handoff to dev. |
| 8 | QA, Security, CI/CD, Release | AI scenarios + manual runs, automation scripts, dependency/vulnerability scans, pipeline config, release checklist & sign-offs. |

Phases 5–8 each start with a short decision check-in before any new infrastructure (e.g. Redis, AX cluster, Stitch) is added.
