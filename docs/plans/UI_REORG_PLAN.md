# Software Karkhana dashboard: page-by-page reorganisation plan

**Ground rule:** keep the existing visuals exactly. That means `AppShell.tsx` markup and classes, the `LiquidEther` props, the glass sidebar, the header actions, SpotlightCard, GlassCard, BorderBeam, ShinyText, Terminal, the sizing and the palette. This plan changes only **what sits where** and **where the data comes from**. It adds no new design system and no new shell. The unmounted `web/src/workspace/*` shell (`WorkspaceApp`, `Rail`, `HomePage`, `ChatView`, `DMsPage`, `ActivityPage`, `ProjectWorkspace`, `ui.tsx`) is **not** brought back visually. Only its data layer is reused: `workspace/api.ts` (react-query hooks) and `workspace/realtime.ts`.

### Two facts found in the code that shape the plan

1. **The existing views can't use the `workspace/api.ts` hooks yet.**
   - `main.tsx` renders `<App/>` with no `QueryClientProvider` and no Router.
   - `useWsId()` reads `useParams().wsId`.
   - Fix: wrap `<App/>` in a `QueryClientProvider`. Change `useWsId()` to `useParams().wsId ?? useFactoryState().workspace.id`, or have a `WorkspaceIdContext` that `AppShell` provides from `state.workspace.id`.
   - Navigation stays on `factoryStore.currentScreen`, so `App.tsx` keeps its screen-switch design. URL/hash sync comes later (step 14).
2. **The product backend is thin.**
   - `Product` in `app/models.py` has only `name, code, domain, description, status, created_by`.
   - `products.py` has GET and POST `/api/products` and no PUT.
   - `POST /api/products` doesn't check workspace membership.
   - `GET /api/home` already returns `product` (id, name, code, domain, description) and `me.isOwner` / `me.isAdmin`. That is everything needed to gate "Edit Product".

---

## 1. Sidebar (same `AppShell` markup, new `navSections` data)

Nothing changes from the brand header down to the footer:
- `aside.w-64 bg-[#0A0A0F]/75 backdrop-blur-md border-r border-white/[0.08]`
- the "Software Karkhana" header and `v2.4` pill
- the `#101016` workspace switcher card
- the ⌘K search button
- the user footer card with the indigo "Invite to Workspace" button, "Public Landing" and "Sign Out"

**Styling rules for the rows:**
- Section titles keep `px-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider`.
- Rows keep the exact `button` classes: `px-3 py-2 rounded-lg text-[13px] font-medium`, active `bg-neutral-800 text-white`, and the mono `text-[11px]` count on the right.
- The only additions are:
  - an optional chevron on expandable project rows;
  - child rows that reuse the same classes plus `pl-8` indentation;
  - a 6px avatar dot or initials tile in DM rows, using the ChatPanel `Avatar` at `sm` size.

**Data sources:**
- `useHome()` for projects with `stations` and `openTasks`, plus `unreadActivity`, `me.isOwner` and `me.isAdmin`
- `useChannels()` and `useDMs()` for the channel and DM lists and unread counts
- `useRealtime(wsId)`, mounted once in AppShell, to keep counts live

### Proposed structure

```
[Software Karkhana  v2.4]
[Workspace switcher: <workspace/product name> · <product code · domain>]   ← subtitle no longer "Production Unit"
[Search or jump to...  ⌘K]

WORKSPACE
  Home                (LayoutGrid)      —
  Direct Messages     (MessageSquare)   Σ dm.unreadCount
  Activity            (Bell)            home.unreadActivity
  Idea Lab            (Sparkles)        ideas in draft+evaluating+review   (tabs inside: Brainstorm/Radar/Report/Review, Feedback Inbox)

YOUR PROJECTS                                         [+] (owner/admin only, until Phase 3 makes it "from approved idea")
  ▸ <Project A>       (FolderGit2)      openTasks
      Overview          (LayoutGrid)
      Issues & Board    (GitBranch)       my open tasks in project
      Discussion        (MessageSquare)   unread comments
      Team              (UserPlus)        members
      — stations, only those in my_stations —
      Product / PM      (Layers)
      Leadership        (Check)           pending gates
      Design            (Cpu)             ← old "Design System"
      Architecture      (Workflow)        ← old "System Architecture"
      Development       (Terminal)        ← old "Engineering & Agents"
      Pull Requests     (GitPullRequest)  open PRs, shown if development or qa in my_stations
      QA / QC           (CheckCircle2)    ← old "QA Verification"
      Security          (Shield)          open findings  ← old "Security & AppSec"
      CI/CD             (Server)          ← old "CI/CD Pipelines" (+ Incidents sub-tab)
      Release           (Radio)           ← old "Releases & Canary"
  ▸ <Project B> …
  All projects        (FolderGit2)      total           ← old "Project Hub" list (ProjectHubView switcher mode)

CHANNELS                                               [+] Add channel (public/private + members)
  # general           (Hash)            unreadCount
  # <team channel>    (Hash / Lock if private)  unreadCount

KNOWLEDGE
  Knowledge Base      (BookOpen)        ← KnowledgeLearningView (read for all; rules creation owner/lead)

ADMIN                                  (section rendered only if me.isOwner || me.isAdmin)
  Product & Workspace (Layers)          ← old "Products" (Edit Product, Members/Invites, Integrations: GitHub, Resend, Models)
  Factory Governance  (Sliders)         ← old "Factory Governance" (Lifecycle tiles + server ledger + Verify chain)

[user footer card · Invite to Workspace · Public Landing · Sign Out]   (unchanged)
```

**Rules for project rows:**
- Exactly one project is expanded at a time. It is the `selectedProjectId`, and the selection is remembered in `localStorage`.
- Clicking a child row sets `currentScreen='project_detail'` plus the new UI-state fields `projectTab` and `projectStation`.
- When `my_stations` is empty, the shared tabs (Overview, Issues & Board, Discussion, Team) still show.

### Where every current sidebar item goes (nothing dropped)

| Current section | Current item | New place |
|---|---|---|
| Workspace | Overview | WORKSPACE › **Home** (`workspace_home`, retargeted to the product overview) |
| Workspace | Products (count) | Product overview hero on **Home** for everyone. Editing goes to ADMIN › **Product & Workspace** (one product per workspace, D1) |
| Workspace | Project Hub (count) | YOUR PROJECTS. Each project opens ProjectHubView. "All projects" keeps the switcher list |
| Workspace | Idea Lab (count) | WORKSPACE › **Idea Lab** |
| Build & Code | Engineering & Agents | Project › **Development** station |
| Build & Code | Pull Requests (count) | Project › **Pull Requests** row (PRReviewPanel). The count moves to the project row |
| Build & Code | System Architecture | Project › **Architecture** station |
| Build & Code | Design System | Project › **Design** station. Design tokens can also be edited at product level in ADMIN |
| Quality & Ops | QA Verification | Project › **QA / QC** station |
| Quality & Ops | Security & AppSec (count) | Project › **Security** station (the count moves there) |
| Quality & Ops | CI/CD Pipelines | Project › **CI/CD** station |
| Quality & Ops | Releases & Canary | Project › **Release** station |
| Knowledge | Incidents & Triage | Split. Incidents go to Project › CI/CD › "Incidents" sub-tab. Feedback goes to Idea Lab › "Feedback Inbox" tab |
| Knowledge | Knowledge Base | KNOWLEDGE › **Knowledge Base** |
| Knowledge | Factory Governance | ADMIN › **Factory Governance** |
| (breadcrumb only) | Workflow Admin (`workflow_templates`) | ADMIN › Factory Governance tabs, plus Product & Workspace › Integrations / Models |
| (header only) | Chat overlay | Still in the header. Also in sidebar **Direct Messages** and **CHANNELS** as full pages |
| (header only) | Activity overlay | Still in the header. Also in sidebar **Activity** as a full page |
| (palette only) | Executive Portfolio / Approvals | Project › **Leadership** station. The idea gate moves to Idea Lab › Review. A "Pending approvals" widget goes on Home |

---

## 2. Header bar (`AppShell` header unchanged in markup)

The header keeps its full layout and styling: `h-14 bg-[#0A0A0F]/90 backdrop-blur-md`, the breadcrumb, the amber bell, the blue Chat button, Invite, the blue Create dropdown, the white-active AI Companion toggle and the avatar.

**Breadcrumb:** `workspace name › project name › tab/station label`. Use `project_detail` with `projectTab` and `projectStation`, and extend `SCREEN_LABELS` with `dms`, `activity` and `channel`.

**Activity bell:**
- Still toggles `ActivityFeedPanel` (420px) as a quick peek, with the same amber badge from `useHome().unreadActivity`.
- Add a "View all" ghost link in the panel header that runs `setScreen('activity')`.
- Fix `onNavigate`:
  - `project_comment` or a project target opens `project_detail` with `projectTab='discussion'`;
  - a channel target opens `setScreen('channel')` and sets `selectedChannelId`;
  - `selectProject` is never called with a channel id.

**Chat:**
- Still toggles the 680px `ChatPanel` as a quick peek.
- ChatPanel and the full pages share the same extracted pieces (`Avatar`, `MessageRow`, `Composer`, `MentionPicker`) through `components/shell/chat/ChatView.tsx`.
- Clicking a channel or DM inside the overlay offers "Open full page", which sets the sidebar selection.
- Unread counts come from the same react-query cache, so the header badge and the sidebar counts always agree.

**Invite:**
- Opens `WorkspaceInviteModal`.
- Its role grid shows only the roles the inviter may grant: admin only for owners and admins.
- It copies the server-returned tokened `inviteLink`.

**Create dropdown:**
- `Edit Product` / `Add Product`: owner and admin only. It is "Add" if `home.product` is null, otherwise "Edit". It replaces "New Product", since a workspace has one product.
- `New Project`: owner and admin only until Phase 3. After Phase 3 it reads "Project from approved idea…" and opens Idea Lab › Review.
- `Propose Innovation`: everyone. Unchanged; it goes to `idea_generate`.
- New `New Channel`: everyone. Opens the channel create form (public/private plus a member picker).

**AI Companion:** unchanged. Its context bar and quick actions follow `projectStation` and `currentScreen`.

**Avatar:**
- Uses `state.currentUser` (display_name, email, avatar), with the gradient initial tile as the fallback.
- Drop `members[0]` and the Unsplash photo.
- The menu keeps "Public Landing Page" and "Sign Out", and adds "Workspace settings" for owners and admins.

**Global ⌘K:** AppShell adds a `keydown` listener that opens the `CommandPalette`.

**Cursor:** mount `<DashboardCursor/>` right after `<LiquidEther/>`. Leave `LiquidEther` props byte-for-byte (`colors ['#2a00ff','#5300ff','#b497cf']`, `mouseForce 42`, `cursorSize 55`, `persistence 0.78`, `autoDemo`, `autoSpeed 0.5`, `autoIntensity 1.4`, `intensity 1.6`, `resolution 0.5`, `clickBurst`, `intro`).

---

## 3. Page-by-page table (every audited file)

| Current file / screen | New location | Features kept (all) | Wiring (endpoint) | New backend needed | Visuals kept |
|---|---|---|---|---|---|
| `shell/AppShell.tsx` (wraps all) | Global shell, unchanged | LiquidEther, workspace switcher, ⌘K search, nav, footer + Invite, breadcrumb, bell, Chat, Invite, Create, AI toggle, avatar menu, all modals and panels | `useHome` (counts, isOwner), `useChannels`/`useDMs`, `useRealtime(ws)` replacing the bare `chatSocket.connect(token)`. Switcher runs `switchWorkspace` and then a workspace-scoped resync. "+ New Workspace" opens `CreateWorkspaceModal` | none (`/api/home` and chat exist) | Everything listed in the audit, byte-for-byte. Adds `<DashboardCursor/>` |
| `shell/ChatPanel.tsx` (overlay) | Header quick peek, plus a full page via extracted `chat/ChatView.tsx` for the `channel` and `dms` screens | Channels/Direct tabs, grouped messages, @mention, typing, voice, composer, create channel, open DM, presence | `useChannels`, `useDMs`, `useMembers`, `useMessages`, `useMarkRead`, `useCreateChannel({name, is_private, member_ids})`, `useOpenDM`. Remove the `factoryStore.createChannel`/`openDM` fallbacks. Replace `alert()` with an inline notice | none (private channels with `member_ids` exist) | 680px #0A0A0F overlay, green "N online" pill, 220px #0d1017 inner list, Hash rows, gradient Avatar with presence dot, MentionPicker, Mic/At/Send composer, italic typing line |
| `shell/ActivityFeedPanel.tsx` | Header quick peek, plus the full **Activity** page (new `views/ActivityView.tsx` reusing `FeedRow` and the filter pills) | All/Mentions/Unread filters, mark read, mark all read, live mentions, click-through | `useActivity`, `useMarkAllActivityRead`, `POST /api/chat/activity/{id}/read`. `myId` comes from `currentUser`. Fixed `onNavigate` targets | Activity types `idea_review_requested` and `idea_approved` (Phase 3) | Amber bell header, filter pills, tinted type icons, 3px unread border, "All caught up!" |
| `shell/AICompanion.tsx` | Global docked panel, unchanged | Chat history, send, clear, KB tab ingest/list/delete, context bar, quick actions | Same `/api/rag/*`. Pass `workspace_id` on `/api/rag/documents`. Quick actions keyed by `projectStation` | Workspace filter on `/api/rag/documents`; auto-ingest the product description on product PUT. Show an explicit "AI offline (no Gemini key)" state | 420→680 width animation, Sparkles header, context chips, bubbles, quick-action grid, doc cards |
| `shell/CommandPalette.tsx` | Global modal | Search, quick actions, Esc | ⌘K listener in AppShell. Results from cached `useHome` projects, my stations, `useChannels`, `useMembers` (DM), ideas, plus static actions. Implement ↑↓ and Enter. Drop the fake "#42" | optional `GET /api/search` later | Blurred backdrop, #101016 max-w-2xl card, row tiles turning blue, kbd footer |
| `shell/DashboardCursor.tsx` | Mounted in AppShell after LiquidEther, and in WorkspaceChooser | Trailing 48px ring, 8px dot, fade on leave | none | none | Exact sizes, colours, 0.12 lerp. Native cursor left visible (no `cursor:none`) unless the user wants it hidden |
| `views/WorkspaceHomeView.tsx` (`workspace_home`, `products`, `product_*`) | **Home** | Hero, 4 metric SpotlightCards, BorderBeam panel, tab switcher, product cards, project cards, Audit tab | Hero uses `home.product` (name in ShinyText, description). Owner/admin see the `Edit Product` button (CreateProductModal in edit mode), others see `Propose Idea`. Metrics: Projects, My open tasks (`home.myTasks.length`), Ideas in review (`home.ideas.counts`), PRs awaiting review. BorderBeam panel becomes "My Tasks" (`home.myTasks`). Quick-add becomes Propose idea (`POST /api/ideas`). Tabs: Projects (`home.projects`, Open goes to project Overview), Ideas (`home.ideas.recent`), Activity/Audit (`GET /api/ledger?workspace_id`). Trash buttons removed. `onboarding` no longer falls through here | `PUT /api/products/{id}`, extended Product fields, ledger workspace scope check | Hero pill, ShinyText title, 4-up SpotlightCard grid with blue/indigo/cyan/purple spotlights, BorderBeam (150/14, #075BFF→#514CE8), underline tabs, SpotlightCard project cards, GlassCard empty states |
| `components/views/ProductWorkspaceView.tsx` (`product_workspace`) | Merged into Home. Its SpotlightCard hero and 4-metric strip become the **Product Overview** block at the top of Home (extract `ProductOverviewHero.tsx` from this file) | Hero with code·domain·status, metrics (projects, ideas, repos, docs), tabs (Projects / Ideas / Specs & Knowledge), CTAs | Hero from `home.product` plus the extended fields (problem, personas, stack, repo, GitHub status). Specs & Knowledge tab lists `GET /api/projects/{id}/context` and `/api/learnings` (product docs). "New Project" is gated to owner/admin. Projects and ideas come from `useHome` | same as above | SpotlightCard hero with rgba(7,91,255,0.15) spotlight, 5xl title, mono status line with green dot, 4-col metrics, segmented tabs |
| `workspace/CreateProductModal.tsx` | Same modal, in `mode: 'create' \| 'edit'`. Opened from Home hero, Create menu, ADMIN › Product & Workspace, and step 2 of CreateWorkspaceModal | Specs form (all fields, plus keyFeatures and constraints shown), Upload Docs extraction, JSON import/export | Create: `POST /api/products` (one per workspace). Edit: `PUT /api/products/{id}`, prefilled from `home.product`. Remove the `factoryStore.createProduct` local copy. Extract passes `workspace_id`/`product_id`. New "Connect GitHub" section (device flow `/api/github/auth/start`/`poll` now, GitHub App later) | Product columns `problem_statement, target_personas, tech_stack[], key_features[], constraints, repositories[]` (migration 011); PUT with owner/admin check; membership check on POST; `UNIQUE(workspace_id)` | Gradient Layers tile header, pill tab switcher, dashed dropzone, emerald/red banners, RAG spinner |
| `workspace/CreateProjectModal.tsx` | Interim: owner/admin "New Project". Phase 3: the "Approve and create project" confirmation from an approved idea. A reduced picker is reused in Project › Team | Name/code, product (fixed to the workspace product), scope, date, repo, member picker | `POST /api/projects`, then `POST /api/projects/{id}/members` for each selected member with stations. Phase 3: `POST /api/ideas/{id}/promote` with members. Remove the local `createProject` and the demo member fallback | `promote` accepts members and stations | FolderGit2 gradient header, member toggle chips with indigo tiles and blue Check, plus per-member station chips in the same chip style |
| `workspace/WorkspaceInviteModal.tsx` | Same modal from header and footer Invite; also the "Members" tab of ADMIN › Product & Workspace | Members list, role grid, copy link, email invite | `GET /api/workspaces/{id}/members` (read `avatar`, not `avatar_url`). `POST .../invites` and use the returned tokened `inviteLink`. Role grid filtered by inviter. Pending invites list. Honest copy: "Invite created", with "Email sent" only once Resend is wired | Join requires a token; role-grant limits; GET pending invites; Resend outbox (Phase 2); drop the duplicate members route in `rag.py` | card-elevated modal, UserPlus header, Members/Invite tabs, role-coloured rows, 2-col role cards, mono link input with Copy |
| `workspace/DashboardCustomizerModal.tsx` (orphan) | A "Customize" ghost button on the Home hero | Manual widget toggles, restore defaults, AI layout tab | Toggles control Home sections (Product overview, My tasks, Projects, Ideas in review, Activity, Pending approvals). Persist in `localStorage` now. Hide the AI tab until the endpoint exists | `PUT /api/me/preferences`, `POST /api/gemini/dashboard-layout` (later) | Pill switcher with amber Sparkles, preview box, Eye/EyeOff rows |
| `workspace/GuidedTutorialOverlay.tsx` | After DreamTransition, **first time per user per workspace only** | 7-step tour, progress pills, Back/Next/Skip | Seen flag via `POST /api/me/onboarded` (or `localStorage` keyed by workspace). Step text rewritten for the new IA: Home & Product, DMs & Channels, Idea Lab, Your projects & stations, Issues & Board, AI Companion | per-workspace tour flag (optional) | #0a0d16 card, blue glow orb, progress pills, cyan Target pill, blue Next button |
| `auth/CreateWorkspaceModal.tsx` | Same modal, 5 steps | Name, profile, discipline, invites, copy link, launch | Step 2 embeds the CreateProductModal Specs/Upload tabs; step 3 is Connect GitHub; step 4 sends the profile with the real discipline; step 5 creates real invites. After `POST /api/workspaces/create`, call `syncSessionFromServer()` and then `switchWorkspace(returnedId)`. Remove `factoryStore.createWorkspace` | `/create` accepts the product spec and creates invites; persist discipline | n/3 step tile, progress bar, rounded-2xl inputs, email chips, gradient Launch button |
| `auth/OnboardingWizard.tsx` (orphan) | Routed for `currentScreen==='onboarding'`: the full-screen first-run flow for users with zero workspaces | Intent (create/join), identity, goal, template, invites, repo/stack | Shares a step model with CreateWorkspaceModal and calls `/api/workspaces/create`. Join takes an invite link or token via `GET /api/workspaces/invites/{token}` and `POST /join`. All Nexus demo prefills cleared | merge `/onboard` into `/create` | ChromaWaves, "Step n of 6", serif-italic accent, intent cards, goal radios, template cards, domain preview |
| `auth/WorkspaceChooser.tsx` | Unchanged entry after login | Workspace cards, create tile, header/footer | `GET /api/workspaces/list`. Each card adds the product code and one-liner. Open runs a resync, then `switchWorkspace`. Grouped by org once that exists. Soften the footer claims | product summary in `/list`; Organization model (later) | ChromaWaves 30%, SK logo, ShinyText welcome, SpotlightCards, dashed cyan tile. Plus DashboardCursor |
| `App.tsx` (router) | Same sequence: Marketing, Auth, Chooser, DreamTransition, AppShell | All screen mappings kept (old ids alias to the new locations) | New screen ids `dms`, `activity`, `channel`. `project_detail` driven by `projectTab`/`projectStation`. Old ids (`qa_dashboard`, `pipeline_studio`, …) map to `project_detail` plus a station, so palette, links and the tutorial still work. Route `onboarding`. Fix create/join resync. Show the tutorial once | — | DreamTransition, tutorial layering |
| `views/IdeaValidationView.tsx` (`ideas`, `idea_*`) | WORKSPACE › **Idea Lab** | Propose form, idea list, delete, Validation Radar, Brief, AI Brainstorm terminal, Promote | `GET /api/ideas?workspace_id`, `POST /api/ideas`, `PUT /api/ideas/{id}` (save assessment through the store, not by mutation; read `summary`, not `executiveSummary`; render feasibility, marketFit, risk, recommendations, riskFactors, suggestedEpics). Promote via `POST /api/ideas/{id}/promote`, reviewer-only. New tabs: Review ("Needs my review" filter) and Feedback Inbox | DELETE/archive idea; `review-request` and `decision` endpoints with activity events; extended evaluate schema (business, budget, impact, research); Gemini-offline badge | ShinyText header, pill tabs, 4/8 grid, #075BFF ring selection, Discovery SpotlightCard, Radar score box, glow Promote button, Terminal |
| `views/ExecutivePortfolioView.tsx` | Project › **Leadership** station. Its idea gate moves to Idea Lab › Review. "Pending approvals" widget on Home for approvers | Metrics strip, approval queue, detail with comment, single sign-off, batch sign | `GET /api/portfolio`, `GET /api/ledger/verify` (real compliance), `POST /api/projects/{id}/approve` and `batch-approve` with a Bearer token and only the selected pending ids; errors surfaced; comment saved as the reason | `GET /api/approvals?assignee=me`; release sign-off endpoints | Blue mono kicker header, Batch Sign button, notice banner, 4 metric cards, 5/7 queue/detail split, Grant Sign-off button |
| `views/ProjectHubView.tsx` (`projects`, `project_*`) | The **project shell** for every project child row. "All projects" opens it in switcher mode | Header and switcher, station ribbon, overview, epics, ADRs, dev, QA, CI/CD, AppSec, comments, role & station access | `useProject(id)` (header, `my_stations`, epics, tasks, approvals). The ribbon is split into shared tabs (Overview, Issues & Board, Discussion, Team) and station tabs filtered by `my_stations`. Each tab renders the station view **inline** instead of linking out. Discussion uses `useProjectComments`/`usePostComment`. Team uses `useProjectMembers`/`useAddProjectMember`. Lifecycle strip from `/api/stages` | remove/update project member; project-join invite links | Mono breadcrumb, LIVE FACTORY tag, ShinyText name, switcher pills, colour-coded ribbon icons (adding Leadership, Design and Release in the same style), overview SpotlightCard, station cards, comment thread, invite GlassCard, member rows |
| `views/PlanningRoadmapView.tsx` (`roadmap`, `issues`, `board`, `epics`) | Project › **Issues & Board** (shared) | Create row, 4-col Kanban, Advance | `GET /api/projects/{id}/board`, with columns mapped (backlog+ready → To Do, in_progress, review → In Review, done). Epics strip above the board. Assignee names from members. Swap only the off-palette `blue-600`/`slate-*` for `#075BFF`/`#827D8E` | `POST /api/projects/{id}/issues`, `PATCH /api/issues/{id}`, epic CRUD (Phase 4) | Header, Create Work Item GlassCard, dark column panels, count pills, SpotlightCard cards, "Advance →" |
| `views/DeveloperWorkspaceView.tsx` | Project › **Development** station | Header, tabs (Review, Agent Sandbox, Task Context), PR list, empty state | Review tab embeds `PRReviewPanel` in the same SpotlightCard. PR list from `GET /api/prs?project_id`. Sandbox runs `POST/GET /api/tasks/{id}/runs` and polls `GET /api/runs/{id}` in the emerald terminal. Context: `GET/POST /api/projects/{id}/context` plus the export.md link. The fake PR form becomes "Assign task to agent" | `GET /api/projects/{id}/tasks?status=ready` (optional) | ShinyText Agent Studio, pill tabs, 4/8 grid, ring-selected PR cards, SpotlightCard findings, GlassCard terminal |
| `views/PRReviewPanel.tsx` | Inside Development › Review, plus the Project › **Pull Requests** row (read-only for non-dev stations) | PR list poll, detail and live GitHub status, CI card and trigger, AI review and re-run, triage, merge readiness, DeviceFlowModal | Same endpoints; guard against `task_id` undefined; the 5s poll also refreshes detail. GitHub connect moves to ADMIN › Integrations; the panel shows a "not connected" notice linking there. Remove the placeholder Add PR form | server-side GitHub credential per workspace; delete the duplicate `/api/prs` in `workspace.py` | 280px rail with divider, PR rows, CI card, Karkhana AI Review card, CommentCard 3px borders, Merge card, device-flow modal |
| `views/ArchitectureStudioView.tsx` | Project › **Architecture** station | ADR form, ADR registry, C4 map, contracts, empty state | Project-scoped ADR API. Detail drawer using `selectedAdrId`. C4 and contracts stored as context entries. Stop mutating `state.adrs` | `GET/POST/PATCH /api/projects/{id}/adrs` (DB), replacing `_ADR_STORE`; real `generate-adrs` | Header, pill tabs, ADR GlassCard form, 2-col ADR SpotlightCards, 3 C4 tiles, contracts code panel |
| `views/DesignStudioView.tsx` | Project › **Design** station. Tokens also editable in ADMIN › Product & Workspace | Viewport toggles canvas, tokens tab, generate variation | Wire `handleGenerateVariation` to a prompt input in the card header. Artefacts per project. Tokens from the product. Add the "No project" empty state | `/api/projects/{id}/designs`, `/api/products/{id}/design-tokens`, AI design endpoint (Phase 7, D9) | Header, pill tabs, Preview Matrix SpotlightCard with Monitor/Tablet/Smartphone toggle, token GlassCards |
| `views/QAVerificationView.tsx` | Project › **QA / QC** station | Metrics, quick add, runner with pass/fail, AI synthesizer | Filter by projectId. Zero tests shows "No tests yet", not "100% Passed". Synthesizer calls `/api/gemini/generate-tests`. Unique ids. Show steps, plus a Blocked button. Failed test offers "Create issue" | project QA scenario CRUD and run results (Phase 8); QA gate endpoint | Pill tabs, 3-up SpotlightCards, GlassCard add form, Pass/Fail rows, Synthesis panel |
| `views/SecurityAppSecView.tsx` | Project › **Security** station | Scan button, metrics, console | `POST /api/security/scan`, streaming into the console. Add Findings / Threat Model / Scans tabs in the QA pill style, with findings as SpotlightCards and "Create issue". Metrics derived from real data, with no hardcoded "Compliant" | findings table, real scan, gate endpoint (Phase 8) | Header, Trigger SAST button, 3-up SpotlightCards, `$` console with Gate pill |
| `views/DevOpsPipelinesView.tsx` | Project › **CI/CD** station (sub-tabs Pipelines / Environments / History / **Incidents**) | Run pipeline, create pipeline, DAG, empty states | Stages from `pipeline.stages`; list all of the project's pipelines; no cross-project fallback; Actions dispatch via GitHub later | pipeline persistence, GitHub Actions integration (Phase 8) | Header, Run button, GlassCard form, DAG SpotlightCard with status pill, 4 stage tiles |
| `views/ReleaseManagementView.tsx` | Project › **Release** station | Stage RC, sign-off, canary, active release dashboard | Checklist / Sign-off / History tabs. A signer may sign only if they hold the station. Deploy disabled until all have signed. Project-scoped. No pre-signed approvals | releases table, sign-off endpoint, gate aggregation (Phase 8) | Header, dual actions, GlassCard form, release SpotlightCard, quorum tile grid |
| `views/FeedbackIncidentsView.tsx` | Split. Incidents tab goes to Project › CI/CD › Incidents (component reused with `mode='incidents'`). Feedback tab goes to Idea Lab › Feedback Inbox (`mode='feedback'`) | Log incident form, incidents list, feedback inbox, empty states | Incident form only in incidents mode, with a summary input. Feedback gets "Turn into idea" (`POST /api/ideas`) | incidents and feedback tables (later) | SEV pills, segmented tabs, War Room GlassCard, feedback SpotlightCards |
| `views/KnowledgeLearningView.tsx` | KNOWLEDGE › **Knowledge Base** | Rule form, rules grid, knowledge grid | Knowledge from `GET /api/learnings` (scoped) with lead-only Verify (`POST /api/learnings/{id}/verify`). Empty states. Rule creation for owner/lead via a store action | rules CRUD per workspace | Header, segmented tabs, rule GlassCard, rule and knowledge SpotlightCards |
| `views/WorkflowAdminView.tsx` (`workflow_templates`, `integrations`, `models`, `admin_settings`, `audit_explorer`) | ADMIN › **Factory Governance** (Lifecycle and Ledger tabs) plus ADMIN › **Product & Workspace** (Product, Members, Integrations, Models tabs in the same pill style). The lifecycle tiles are also reused as the strip on Project Overview | Phase tiles, ledger search | `GET /api/ledger?workspace_id&project_id` with pagination, a "Verify chain" button (`/api/ledger/verify`), `/api/stages` to highlight the current phase | workspace settings endpoints (integrations status, model config) | 5 coloured phase tiles on #080a10, search box, mono ledger rows |

---

## 4. Product: who adds or edits it, and how everyone sees it

**What exists today**
- `POST /api/workspaces/create` already auto-creates one product, `<name> Core`, with placeholder text. So most workspaces already have a product, and the job is **editing**, not creating.
- `CreateProductModal` already has the full form (name, code, problem/value prop, personas, domain, tech stack, repo), the doc-to-spec RAG extraction, and JSON import/export.
- It can't edit: there's no `mode` or `product` prop. It also writes a duplicate local copy, and the backend stores only name, code, domain and description.
- `WorkspaceHomeView` has the hero, metrics and BorderBeam panel. `ProductWorkspaceView` has the product-hero SpotlightCard.

**Changes**

1. **Backend (one migration plus one route):**
   - Add `problem_statement`, `target_personas`, `tech_stack` (JSON), `key_features` (JSON), `constraints`, `repositories` (JSON) and `github_connected` to `Product`, plus `UNIQUE(workspace_id)` (D1).
   - Extend `ProductCreatePayload` and the list/create responses.
   - Add `PUT /api/products/{id}`, guarded by the `CurrentWorkspace` dependency. Allow it only when the caller is the workspace owner, or has the `admin` role, or is `product.created_by`. Write a `product.updated` ledger entry. Otherwise return 403.
   - Add the membership check to POST.
   - Extend `/api/home` `product` with the new fields.
2. **`CreateProductModal.tsx`:**
   - New props `mode?: 'create' | 'edit'` and `product?: HomeData['product']`.
   - In edit mode the form is prefilled and the header reads "Edit Product Anchor" (same tile), and submit calls PUT.
   - Remove `factoryStore.createProduct`. On success, invalidate `qk.home(ws)`.
   - Show `keyFeatures` and `constraints` inputs (state exists already) and add the "Connect GitHub" row.
3. **Who sees the button:**
   - `canEditProduct = home.me.isOwner || home.me.isAdmin`. This guarantees at least the workspace creator can add or edit the product.
   - The button appears on the Home hero as `Edit Product` (or `Add Product` when `home.product` is null), in the Create menu, and in ADMIN › Product & Workspace.
   - Everyone else sees the same hero read-only.
4. **Home layout for everyone** (`WorkspaceHomeView.tsx`, existing components):
   - **Product Overview:** `ProductOverviewHero`, extracted unchanged from the `ProductWorkspaceView` SpotlightCard hero. It shows the code·domain·status line, the 5xl name, and the description. Below it, a GlassCard with Problem, Personas, Tech stack chips (the existing chip style), Repo and GitHub status, and Key features.
   - When the product is empty, owners see a GlassCard empty state with a "Describe your product" CTA, and members see "The workspace owner hasn't described the product yet".
   - **Metrics:** the existing 4 SpotlightCards (Projects, My open tasks, Ideas in review, PRs awaiting review).
   - **BorderBeam panel:** "My Tasks / Assigned to me" from `home.myTasks`. Each row opens the project's Issues tab.
   - **Tabs** (existing underline switcher): Projects (from `home.projects`) / Ideas (from `home.ideas`) / Activity (ledger).
   - `ProductWorkspaceView` stays in the code base as the source of `ProductOverviewHero`. Its `product_workspace` screen id aliases to Home.

---

## 5. Implementation order (each step ships on its own and looks identical, except for placement)

1. **Restore the cursor effect.**
   - Mount `<DashboardCursor/>` after `<LiquidEther/>` in `AppShell.tsx` and in `WorkspaceChooser.tsx`.
   - Confirm `main.tsx` → `App.tsx` → `AppShell` is the rendered shell and that `workspace/WorkspaceApp` is not mounted.
   - Verify with a screenshot.
2. **Shell correctness fixes, with no layout change.**
   - Avatar and menu use `currentUser`.
   - Add the ⌘K listener and ↑↓/Enter in `CommandPalette`.
   - "+ New Workspace" opens `CreateWorkspaceModal`.
   - `App.tsx` routes `onboarding` to `OnboardingWizard`.
   - Show the tutorial once per workspace.
3. **Data plumbing.**
   - Add `QueryClientProvider` in `main.tsx`.
   - Add the `useWsId()` fallback to `state.workspace.id`.
   - Mount `useRealtime(ws)` in AppShell, replacing `chatSocket.connect(token)` so the socket is workspace-scoped.
   - `syncSessionFromServer` passes `workspace_id`, and `switchWorkspace` triggers a resync.
   - Create and join call resync and then `switchWorkspace(realId)`. Remove `factoryStore.createWorkspace` from `CreateWorkspaceModal` and `OnboardingWizard`.
4. **Product backend:** migration 011 (product fields plus `UNIQUE(workspace_id)`), `PUT /api/products/{id}` with the owner/admin check, the POST membership check, and the extended `/api/home` product payload. Add tests.
5. **Product UI:**
   - `CreateProductModal` gets edit mode and loses its local copy.
   - Extract `ProductOverviewHero`.
   - Home shows the product overview and the owner-only Edit button.
   - Create menu: owner-only "Edit/Add Product"; owner/admin-only "New Project".
6. **Home sections:** metrics, the "My Tasks" BorderBeam panel, and the Projects/Ideas/Activity tabs from `useHome`. Remove the local quick-add and Trash buttons. Wire `DashboardCustomizerModal` to toggle the sections.
7. **Sidebar data restructure:** replace only the `navSections` array plus a render branch for expandable project rows, channel rows and DM rows (same classes). Add the old-screen-id aliases in `App.tsx` so every old item still lands somewhere (see the table in section 1).
8. **Chat full pages:**
   - Extract `components/shell/chat/{Avatar,MessageRow,Composer,MentionPicker,ChatView}.tsx` from `ChatPanel.tsx`; the overlay looks identical afterwards.
   - Add the `channel` and `dms` screens rendering `ChatView` in the main stage.
   - Channel creation gets a private toggle and member picker.
   - Drop the local fallbacks.
9. **Activity page:** `views/ActivityView.tsx` reuses `FeedRow` and the pills. Add the "View all" link in the overlay and fix `onNavigate`.
10. **Project shell:** in `ProjectHubView`, use `useProject(id)`, filter the ribbon by `my_stations`, and render tabs from the store fields `projectTab`/`projectStation`. Shared tabs: Overview, Discussion (existing comments, react-query, no local fallback) and Team (`useProjectMembers`, `useAddProjectMember`, reusing the CreateProjectModal picker with station chips).
11. **Stations inline, one per release, each unchanged visually:**
    1. Development and PRReviewPanel (real runs, PRs and context)
    2. Issues & Board (PlanningRoadmapView on `/board`)
    3. Architecture
    4. QA
    5. Security
    6. CI/CD with the Incidents sub-tab
    7. Release
    8. Design
    9. Leadership (ExecutivePortfolioView with real approve calls)

    Each one removes its `setScreen` link-outs and global-state reads.
12. **Idea Lab wiring:** `/api/ideas` CRUD, saved assessment, promote via the backend, then the Review tab and Feedback Inbox tab (Phase 3 reviewer endpoints).
13. **Admin pages:**
    - Product & Workspace: Product, Members (WorkspaceInviteModal content), Integrations (GitHub, Resend) and Models tabs.
    - Factory Governance on the server ledger with Verify chain.
    - Knowledge Base on `/api/learnings`.
    - Invite security: tokened join, role-grant limits.
14. **Deep links:** sync `currentScreen`, project, tab and channel to the URL hash (`#/w/:ws/p/:id/:tab`, `#/w/:ws/c/:id`) so email and notification links open the exact page (D3), still without replacing the shell.

**Files touched across the plan:**
- `web/src/main.tsx`
- `web/src/App.tsx`
- `web/src/store/factoryStore.ts`: UI state only (`projectTab`, `projectStation`, `selectedChannelId`)
- `web/src/workspace/api.ts`: `useWsId` fallback, plus new hooks `useUpdateProduct`, `useIdeas`, `useBoard`
- `web/src/components/shell/{AppShell,ChatPanel,ActivityFeedPanel,CommandPalette,AICompanion,DashboardCursor}.tsx`
- new `web/src/components/shell/chat/*`
- new `web/src/components/views/ActivityView.tsx`
- new `web/src/components/views/ProductOverviewHero.tsx`
- every `web/src/components/views/*View.tsx` listed above
- `web/src/components/workspace/{CreateProductModal,CreateProjectModal,WorkspaceInviteModal,DashboardCustomizerModal,GuidedTutorialOverlay}.tsx`
- `web/src/components/auth/{CreateWorkspaceModal,OnboardingWizard,WorkspaceChooser}.tsx`
- `app/models.py`
- `app/routers/products.py`
- `app/routers/home.py`
- a new migration `011`

---

## Completeness review

The plan keeps the shell and most visuals, but it has gaps. Some features lose their place, a few steps change the look, and several backend claims are wrong. I checked every backend claim against `app/routers/*.py`, `app/access.py` and `web/src/workspace/api.ts`.

### Features the plan drops or hides
1. **Products tab and product cards on Home.** Home's tabs become Projects / Ideas / Activity. The "Products" tab and its cards (tech chips, "Open Workspace" chevron) are on the keep-visuals list but get no home. **Fix:** keep the tab as "Product". Render the single product card in the same style, linking to the product overview.
2. **Products in the sidebar for ordinary members.** "Products" moves to ADMIN › Product & Workspace, which only owners and admins see. Members then have no product entry in the sidebar, and the user said "we do need to show the product". **Fix:** add a "Product" row under WORKSPACE for everyone (read-only overview). Keep editing for admins only.
3. **Factory Governance (ledger) for members.** It used to be visible to everyone; now only admins see it. **Fix:** give all members read-only access to the ledger. Keep "Verify chain" and the lifecycle editor for admins.
4. **ProductWorkspaceView metrics strip and buttons.** Section 4 pulls out only the hero (code·domain·status, name, description). Dropped:
   - the 4-column metrics strip (projects / ideas / repos / docs)
   - the "Idea Lab" secondary button
   - the glowing "New Project" button
   - the "Specifications & Knowledge" tab

   **Fix:** include the metrics strip in `ProductOverviewHero`. Keep both buttons, with New Project limited to owners and admins. Add a "Specs & Knowledge" tab to the Home tabs.
5. **Two heroes on Home.** Section 3 puts the product name in ShinyText in WorkspaceHomeView's "Factory Overview" hero. Section 4 puts `ProductOverviewHero` on top. **Fix:** pick one. Either the WorkspaceHomeView hero stays and the product SpotlightCard sits under it, or one replaces the other. Also say where the old hero's "New Project" button goes.
6. **Product / PM station has no content.** The sidebar lists it, but no view renders it. The old ProjectHubView "Product & Epics" tab isn't assigned anywhere either. **Fix:** map it to the ProjectHubView Product & Epics tab, with the epics list from `useProject().epics`.
7. **ProjectHubView overview pieces.** "Launch Agent Swarm" and the 3 station cards aren't mentioned. **Fix:** keep both on Overview. Make the cards deep-link to the stations the user can access.
8. **"All projects" has no list view.** ProjectHubView needs a selected project and has no "switcher mode". **Fix:** send "All projects" to Home's Projects tab, or build the list from WorkspaceHomeView's project SpotlightCards.
9. **Tutorial loses QA, Security and CI/CD.** The new steps drop "QA & AppSec" and "CI/CD & Releases", and the "n / 7" counter changes. **Fix:** keep 7 steps and merge the stations into one "Project stations" step plus a "Quality & Release" step.
10. **Old Idea Lab bugs.** The DM response keys (`otherUserId` / `otherUserAvatar`) are not checked. ChatPanel and ActivityFeedPanel read a stale `getState()`. The Idea Lab still lists all ideas, not just the product's. **Fix:** add these to step 8 and step 12.

### Steps that change the look, not just the placement
11. **Workspace switcher subtitle.** It changes from "Autonomous Engine / Production Unit" to "product code · domain". **Fix:** keep the original subtitle and put product info only in the dropdown, or ask the user first.
12. **Avatar photo.** Dropping the photo changes the header. **Fix:** use `currentUser.avatar` when it exists, and the gradient initials tile only as fallback.
13. **Security station.** The plan deletes the large emerald "Compliant" text and the "Gate: PASS" pill, both on the keep list. **Fix:** keep the elements and drive their text and colour from real data.
14. **PlanningRoadmapView palette swap.** Swapping `blue-600` / `slate-*` is a restyle, and Architecture, Design and QA stay off-palette, so the stations become inconsistent. **Fix:** leave the colours as they are unless the user approves.
15. **CreateWorkspaceModal grows from 3 steps to 5.** This changes the "n / 3" tile and the three-segment progress bar. **Fix:** either keep 3 visible steps, folding product spec and GitHub into step 1 and 2 sub-panels, or get the user to sign off on the 5-step version.
16. **Create dropdown "New Channel".** No icon is given. **Fix:** use `Hash` in the same item style.
17. **New nav icons.** Leadership (`Check`), Product/PM (`Layers`) and Team (`UserPlus`) are added. `Layers` is already used by the old Products row. **Fix:** avoid icon collisions with ADMIN › Product & Workspace (`Layers`).

### Backend and code claims that are wrong
18. **`GET /api/ledger?workspace_id`.** No such parameter exists. `platform.py` `list_ledger` accepts only `project_id` and `limit`, with no pagination cursor, and returns the ledger for every workspace. **Fix:** list "add workspace_id filter + membership check + offset/cursor" under new backend work.
19. **`GET /api/ideas?workspace_id`.** No such parameter exists. `products.py` `list_ideas` takes only `product_id` and has no workspace or membership scoping. **Fix:** use `?product_id=home.product.id`, and add workspace scoping to the backend list.
20. **"Knowledge from `GET /api/learnings` (scoped)".** It is not scoped: it takes only `CurrentUser` and returns all learnings. `GET /api/portfolio` and `/api/ledger/verify` are the same: global, with no workspace. **Fix:** add workspace scoping as a backend item for learnings and portfolio before showing them to members.
21. **Specs & Knowledge tab "lists `GET /api/projects/{id}/context`".** That route is project-scoped, so it can't hold product-level docs. **Fix:** list context across `home.projects`, or add product-level docs (RAG documents or a new endpoint).
22. **`useCreateChannel({name, is_private, member_ids})`.** The hook and `ChannelCreate` take `visibility: 'public' | 'private'`, not `is_private`. The default is private. **Fix:** send `visibility`.
23. **"`syncSessionFromServer` passes `workspace_id`".** `GET /api/projects` ignores a `workspace_id` query; it resolves the workspace from the `X-Workspace-Id` header (`access.py` `CurrentWorkspace`). `GET /api/products?workspace_id` works but has no membership check. **Fix:** send `X-Workspace-Id` on every call, or reuse `apiFetch`.
24. **"PRs awaiting review" metric from `useHome`.** `/api/home` returns no PR data, only `product`, `me`, `memberCount`, `unreadActivity`, `projects`, `myTasks` and `ideas`. **Fix:** add a PR count to `/api/home`, or fetch `GET /api/prs` per project.
25. **Sidebar station gating from `home.projects[].stations`.** `home.py` uses `my_stations.get(p.id, ALL_STATIONS)`, so a visible project where the user has no `ProjectMember` row shows all stations. **Fix:** return `[]` for non-members, or gate on `useProject().my_stations`.
26. **`useWsId()` fallback.** `useParams().wsId ?? useFactoryState().workspace.id` calls a hook conditionally, which breaks the rules of hooks. **Fix:** call both hooks unconditionally and then combine them, or use the `WorkspaceIdContext` option.
27. **Invite security left until step 13.** `POST /api/workspaces/join` still enrolls anyone by a bare `workspace_id` with a client-chosen role. That code path is still live in `auth.py`. Step 13 is too late, since invites are rewired in the steps before it. **Fix:** require the token and ignore the client role in step 3 or 4.
28. **Smaller fixes:**
    - `CreateProjectModal` posts `POST /api/projects/{id}/members` "with stations". That route exists, so check it accepts `stations` before relying on it.
    - The "remove/update project member" route is correctly listed as missing.
    - PRReviewPanel's GitHub device-flow token (`X-GitHub-Token`) is still ignored server-side. Moving "Connect GitHub" into CreateProductModal and Integrations doesn't help until the token is persisted on the server. List that persistence as a prerequisite of step 5.
