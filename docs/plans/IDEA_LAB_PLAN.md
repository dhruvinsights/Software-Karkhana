# Idea Lab + Reviewer Space: build plan and status

Written 2026-10-16 so any session can pick the work up cold. Read together with
`FACTORY_PLAN.md` (overall phases) and `UI_REORG_PLAN.md` (page-by-page UI plan).

## Ground rules (from the user)
- **Keep the existing dashboard look** (AppShell, LiquidEther background, glass sidebar, header actions, Tailwind palette `#075BFF` etc.). Change placement and wiring, not styling, except for the Idea Lab chat, which gets its own premium look.
- Large fonts, generous spacing, "mood to work". Not cramped. No emoji. Not "AI slop".
- Effects the user supplied (React Bits): **SoftAurora** (WebGL background), **ThoughtLine** (thinking indicator), **BorderGlow** (cursor-following glowing edge). Port them to this repo (TypeScript, `motion` is already installed; ThoughtLine's HugeIcons dependency is replaced with lucide icons).
- Chat design follows the **Gemini design system**: large greeting, rounded pill composer, sparkle mark, Google Sans-like type (use `Google Sans` / Inter fallback), soft surfaces, answer text left-aligned with no bubbles for the assistant.
- Ollama = default for testing; **Gemini, Claude (Anthropic SDK), IBM Bob (`bob run`, as in Software-karkhana-v1) all wired**, with a provider/model picker in the UI. Keys live in `.env`, never in chat.
- Idea Lab lives **inside the product** (workspace = product), not in the global sidebar.
- Reviewers get their **own space** to review/approve ideas; they see a read-only overview of projects, no team work areas.

## Done so far (backend + realtime)
- Access model: owner / admin / reviewer / guide / member (`app/access.py`), per-project stations, archive-on-delete, live `workspace_sync` frames.
- Product setup full-screen (4 steps), reviewers + team spaces stored in `products.settings`.
- Live sync fixes: socket scoped to workspace, `X-Workspace-Id` on every chat call, new `activity` frame, unread badges from server, channel creation with member picker, `channel_created` / `activity` / `reconnected` handled live. Verified in browser with two accounts.
- Provider layer `app/ai/chat.py`: `list_providers()`, `stream()` (events `thinking` | `text` | `status`), `complete()`. Ollama verified streaming; Bob/Claude/Gemini coded, need keys to test. Anthropic SDK added (`anthropic` 1.15, server-side fallback `default`).
- Config: `chat_default_provider`, `ollama_chat_model`, `anthropic_api_key`, `claude_model`, `bob_api_key`, `bob_bin`.

## To build (in order)
### 1. Database (migration 014)
- `idea_scans` (id, product_id, workspace_id, status running|done|failed, provider, model, repo_url, started_by, stats jsonb, error, created_at, finished_at)
- `ideas` additions: `source` (`manual`|`agent`), `scan_id`, `evidence jsonb` (files/paths the agent cited), `review_status` (`none`|`requested`|`approved`|`rejected`|`changes_requested`)
- `idea_chats` (id, idea_id nullable, product_id, workspace_id, user_id, title, provider, model, created_at, updated_at) and `idea_chat_messages` (id, chat_id, role, content, thinking text, created_at). History per user per product.
- `idea_reviews` (id, idea_id, reviewer_id, decision pending|approved|rejected|changes_requested, comment, requested_by, requested_at, decided_at) plus an `idea_review_report` jsonb on `ideas` (business metrics, budget, impact, research evidence, risks, recommendation).
- GitHub connection: use existing `github_tokens` (per user); add `product_repos` in `products.settings.repositoryUrl` (already stored).

### 2. GitHub access for the agents
- Device-flow already exists (`/api/github/auth/start|poll`) but returns the token to the browser. Change `poll` to **store** the token in `github_tokens` and return only `{connected: true, login}`.
- `GET /api/github/status` -> connected? login? can read repo X?
- Agents clone the repo (shallow, `git clone --depth 1` with token via `git_auth_header`, token never logged) into a temp dir, build a repo map (tree, languages, README, manifests, TODO/FIXME, tests, CI), and read key files in chunks. Public repos work without a token.
- Production path later: GitHub App (workspace-level) instead of personal tokens.

### 3. Idea scan agents (`app/ai/idea_agents.py`)
- `POST /api/products/{id}/idea-scans` (admin/PM/member with write) -> background task, returns scan id; progress events over the workspace socket (`scan_progress`) and stored on the scan row.
- Pipeline: (a) clone + repo map, (b) 4 specialist passes in parallel (product gaps, tech debt/quality, security & reliability, growth/UX), each reading the relevant files and returning structured ideas with evidence, (c) a synthesis agent dedupes, scores (value, effort, risk), ranks, and writes ideas into `ideas` with `source='agent'`.
- Provider chosen per scan from the picker; Bob gets `--workspace <clone dir>` so it reads the repo itself; Ollama/Gemini/Claude get a repo map plus selected file excerpts.

### 4. Idea Lab UI (inside the product)
- Entry: product page tab / Overview card **Idea Lab**; sidebar item "Idea Lab" removed (sidebar keeps Overview, Products, Project Hub, etc.; see UI_REORG_PLAN).
- Layout: left = chat history list; center = Gemini-style chat; right (collapsible) = idea list from scans with score chips.
- **Idea list**: "Run agents on this product" button -> live progress (ThoughtLine with steps), then cards (BorderGlow) with title, problem, evidence, value/effort/risk. Each card: **Open in AI chat** (starts a chat seeded with the idea + evidence), **Send for review**, **Create project** (only when approved).
- **Chat**: SoftAurora background, big greeting ("What are we building in {product}?"), pill composer with provider/model selector, streaming answer with ThoughtLine while thinking, Markdown rendering (headings, lists, tables, code) at large sizes, copy button, history persisted per user and resumable, "Save as idea" / "Evaluate against metrics" actions.
- Fonts: body 17-18px, answers 18px/1.75, headings 28-40px, wide gutters, max width ~820px for reading.

### 5. Evaluation report
- `POST /api/ideas/{id}/evaluate`: metrics = business value, market/competitor, budget/effort, impact, risk, research notes; model-generated, grounded in repo evidence and product description; stored as the report. Rendered as a report page (printable).

### 6. Reviewer space
- Sidebar entry **Reviews** (visible to reviewers/admins and anyone with pending reviews): queue of ideas awaiting my decision, filters (pending/decided), idea detail with report + chat discussion + Approve / Request changes / Reject with comment.
- Product manager picks reviewers per idea ("Send for review" multi-select from the product's reviewers); each reviewer gets an activity notification + live badge + email (Resend, outbox).
- Decision rules: needs all required reviewers approving (configurable later; default any one reviewer). Approved ideas unlock **Create project from idea** (one click), which already creates the project, membership and sync.
- Server: `/api/ideas/{id}/reviews` (request), `/api/reviews/mine`, `/api/reviews/{id}/decide`. Reuse `_can_decide` in `products.py`.

### 7. Full-screen Create Project (same pattern as product setup)
- Steps: Project (from approved idea) -> Team spaces and people per space -> Epics (AI-generated draft the PM confirms) -> Review & create. Replaces the popup `CreateProjectModal`.

### 8. Later
- Move remaining global sidebar items into project workspaces per UI_REORG_PLAN.
- Agents run on the developer's machine via npm package + VS Code extension (FACTORY_PLAN D8).

## Provider setup checklist (user does this in `.env`)
```
GEMINI_API_KEY=...          # Gemini
ANTHROPIC_API_KEY=...       # Claude
BOB_API_KEY=...             # IBM Bob (the `bob` CLI is already installed)
CHAT_DEFAULT_PROVIDER=ollama
OLLAMA_CHAT_MODEL=qwen3.8:latest
```
Ollama models available locally: qwen3.8, gpt-oss:20b, llama3.3:70b, qwen2.5-coder:14b, granite3.3:8b, llama3.

## Known gaps / risks
- Full multi-account browser tests exist in the scratchpad e2e folder only; port the useful ones to `tests/e2e`.
- One pre-existing failing test (`test_golden_path`) expects PM-only project creation; resolve in step 7 when projects come only from approved ideas.
- Another process edits `products.py`, `projects.py`, `CreateProjectModal.tsx` in parallel; always re-read before editing.
- Bob streaming gives status lines and one final answer (not token streaming).
