# 02. Current Status & What Is Left

## 📋 Comprehensive Status Checklist

---

### 1. Authentication & Onboarding
- [x] Multi-factor Email OTP flow with branded Resend HTML templates
- [x] Google One Tap & Google Sign-In with backend token verification
- [x] Backend endpoint `GET /api/auth/google/client-id` for dynamic frontend configuration
- [x] GitHub OAuth code exchange and database token storage (`github_tokens` table)
- [x] 4-step interactive progressive onboarding wizard
- [x] Workspace chooser and 3-step workspace creation modal
- [ ] 60-second OTP resend cooldown timer with visual progress bar *(Eshitha)*
- [ ] Automatic silent JWT refresh and persistent multi-day sessions *(Eshitha)*

---

### 2. Workspace & Sharing Controls
- [x] Workspace creation, member listing (`/api/workspaces/{id}/members`), and owner tracking
- [x] Workspace invite modal with role selection and link copying
- [ ] Direct email invite delivery via Resend with deep-link URL parsing *(Eshitha)*
- [ ] Project-level invite links with automatic role granting *(Eshitha / Dhruv)*
- [ ] Interface / station visibility toggles (hide/show stations based on role assignment) *(Dhruv)*

---

### 3. Software Factory & Product Lifecycle
- [x] PM Product creation (`/api/products`) and product catalogue
- [x] AI idea generation with viability scoring (`/api/products/{id}/ideas`)
- [ ] Approval request workflow: assign reviewers / managers to candidate ideas *(Dhruv)*
- [ ] One-click Project creation from approved ideas *(Dhruv)*
- [ ] Multi-window project environment with lead enrollment & sub-team delegation *(Dhruv)*
- [ ] Issue & bug tracking: assign bugs between PMs, Devs, and QA *(Dhruv)*

---

### 4. PR Reviewer & Code Intelligence (CodeRabbit / IBM Dexter Parity)
- [x] `PRReviewPanel.tsx` UI with high-level summary and security badge
- [x] Backend PR review endpoint (`/api/reviews/pr/{id}`)
- [ ] Complete diff hunks parsing with inline line-by-line comment threads *(Dhruv)*
- [ ] Full parity verification with [IBM Dexter](https://github.com/dhruvinsights/IBM_Dexter) *(Dhruv)*
- [ ] Post automated review comments directly back to GitHub PRs via GitHub API *(Dhruv)*

---

### 5. Multi-Agent Orchestration & RAG
- [x] LangChain + FAISS RAG chat with session history (`/api/rag/chat`, `/api/rag/history`)
- [x] Knowledge base document ingestion and chunk management (`/api/rag/ingest`, `/api/rag/documents`)
- [x] AI Companion frontend drawer (420px/680px) with Chat and Docs tabs
- [ ] Multi-agent coordinator per station using Google AX tool schemas *(Dhruv)*
- [ ] Sandcastle isolated container execution runtime for agent workers *(Dhruv)*

---

### 6. Infrastructure, Realtime & Scale
- [x] Async FastAPI control plane with connection pooling
- [x] SHA-256 hash-chained immutable evidence ledger with PostgreSQL advisory locking
- [ ] Realtime WebSocket / SSE layer with Redis Pub/Sub for team chat and activity feed *(Eshitha)*
- [ ] FastAPI vs Go performance benchmarking and microservice profiling *(Eshitha)*
