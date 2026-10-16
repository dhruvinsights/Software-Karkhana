# 01. Backend Modules & Database Schema Audit

## 📦 Directory Structure (`app/` and `db/`)

```
app/
├── ai/
│   ├── evaluator.py          ← Verification, rubric evaluation, hallucination checks
│   ├── llm.py                ← LLM adapter abstraction (Gemini / Ollama / Mock)
│   ├── orchestrator.py       ← Task scheduling, tool invocation, worker loop
│   └── providers/
│       ├── gemini.py         ← Google GenAI SDK integration (Gemini 2.0 / 3.8 Flash)
│       └── ollama.py         ← Local Ollama HTTP integration (Llama 3.1, nomic-embed)
├── integrations/
│   ├── github.py             ← GitHub API client (diffs, PRs, comments, branches)
│   └── google_chat.py        ← Google Chat webhook publisher for audit alerts
├── routers/
│   ├── auth.py               ← OTP email verification, Google OAuth, GitHub OAuth, Workspaces
│   ├── chat.py               ← Real-time team chat, channel persistence, message history
│   ├── gemini.py             ← AI companion fallback, test scenario generator
│   ├── github_oauth.py       ← GitHub token exchange & repository listing
│   ├── operations.py         ← System health, station metrics, station activity logs
│   ├── platform.py           ← Workspace config, system health, server info
│   ├── products.py           ← Product creation, AI idea generation & scoring
│   ├── projects.py           ← Project lifecycle, task dependency graphs, milestones
│   ├── rag.py                ← LangChain + FAISS RAG chat, document chunk ingestion
│   ├── reviews.py            ← CodeRabbit-style PR diff reviewer, automated review triage
│   ├── runs.py               ← Autonomous worker run dispatch, live logs, ledger linking
│   └── workspace.py          ← Workspace settings, member management, invite routing
├── auth.py                   ← JWT creation/verification, password hashing, CurrentUser dep
├── config.py                 ← Central Pydantic BaseSettings loading from environment/.env
├── db.py                     ← Async SQLAlchemy engine, session maker, connection pool
├── email.py                  ← Resend API integration for branded HTML transactional emails
├── fast_api_app.py           ← FastAPI instance, CORS middleware, router registration
├── ledger.py                 ← Cryptographic SHA-256 hash-chained immutable audit ledger
├── models.py                 ← SQLAlchemy async declarative models
└── schemas.py                ← Pydantic request/response models & validation schemas
```

---

## 🗄️ Database Migrations Audit (`db/migrations/`)

| Migration File | Description & Entities Added | Status |
|:---|:---|:---|
| `001_initial_schema.sql` | Base tables: `users`, `projects`, `runs`, `pull_requests`, `ledger_entries` | ✅ Applied & Verified |
| `002_add_ledger_hash_chain.sql` | SHA-256 chained hash fields, `prev_hash`, `signature`, advisory lock functions | ✅ Applied & Verified |
| `003_pgvector_setup.sql` | Extension `vector`, `project_embeddings`, `learnings_semantic_index` | ✅ Applied & Verified |
| `004_task_dependency_graph.sql` | `task_nodes`, `task_edges`, invariant definitions | ✅ Applied & Verified |
| `005_audit_and_compliance.sql` | `compliance_checks`, `security_waivers`, `gate_signoffs` | ✅ Applied & Verified |
| `006_enterprise_auth_workspaces.sql` | `workspaces`, `workspace_members`, `products`, `ideas`, `invitations` | ✅ Applied & Verified |
| `007_rag_documents.sql` | `rag_documents`, `document_chunks`, metadata tags | ✅ Applied & Verified |
| `008_chat.sql` | `chat_channels`, `chat_messages`, direct messaging and station channels | ✅ Applied & Verified |
| `009_github_tokens.sql` | `github_tokens` table for user OAuth access tokens & refresh tokens | ✅ Applied & Verified |

---

## 🔍 Core Backend Services

### 1. Cryptographic Ledger (`app/ledger.py`)
- Every critical state change (workspace creation, project phase gate, AI patch application, security waiver, code approval) writes an immutable record.
- Each record computes `hash = SHA256(prev_hash + actor + action + timestamp + payload)`.
- Protected by PostgreSQL advisory locks (`pg_advisory_xact_lock`) to guarantee sequential monotonic hash ordering without race conditions.

### 2. Enterprise Authentication & SSO (`app/routers/auth.py`)
- **Email OTP**: Resend-powered 6-digit verification code with 10-minute expiry.
- **Google OAuth**: Verifies JWT ID tokens via Google Identity Services against `GOOGLE_CLIENT_ID`.
- **GitHub OAuth**: Secure code exchange with user token persistence in DB for repository operations.
- **Auto-Provisioning**: Unregistered users are safely provisioned with their verified display name and assigned standard workspace roles.

### 3. RAG Pipeline (`app/routers/rag.py`)
- Provides retrieval-augmented generation directly to the frontend AI Companion.
- Uses `RecursiveCharacterTextSplitter` (chunk size 800, overlap 150) to ingest architecture docs and project context.
- Maintains in-memory FAISS indices with lazy re-indexing on document upload/deletion.
