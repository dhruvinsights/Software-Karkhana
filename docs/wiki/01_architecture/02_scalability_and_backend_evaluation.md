# 02. Scalability & Backend Architecture Evaluation

## 🔍 Investigation: Is FastAPI Sufficient for High-Concurrency Software Factory Loads?

As Software Karkhana scales to support hundreds of concurrent engineers, multi-agent pipelines, real-time collaboration chats, and continuous AST/diff reviews, we evaluated whether our current **FastAPI (Python)** control plane is sufficient or if a transition to **Go** or a hybrid model is required.

---

## 📊 FastAPI vs Go Benchmark Analysis

| Requirement / Dimension | FastAPI (Python 3.13 + uvloop + asyncpg) | Go (Fiber / Gin / gRPC) | Evaluation & Verdict for Karkhana |
|:---|:---|:---|:---|
| **I/O Bound Work (DB, REST, OAuth, AI APIs)** | **90k - 140k req/sec** with `uvicorn --workers N` and `asyncpg` connection pooling. | **180k - 300k req/sec** native goroutines. | **FastAPI is 100% sufficient** for control plane CRUD, auth, and dispatch. 95% of Karkhana's requests are I/O bound (waiting on Postgres, Gemini/Ollama, Resend, or GitHub). |
| **Realtime WebSockets (Chat & Activity Streams)** | Excellent for thousands of concurrent connections using Redis pub/sub. | Slightly lower memory footprint per idle connection (2KB vs ~15KB in Python). | **FastAPI + Redis Pub/Sub** easily handles 25k+ simultaneous WebSockets. |
| **AI & LangChain Integration** | **Native first-class ecosystem** (LangChain, LangGraph, FAISS, Google GenAI SDK, PyTorch/NumPy AST parsers). | Fragmented AI libraries; requires custom bindings or HTTP calls to Python microservices. | **Major advantage for FastAPI**. Writing agent reasoning in Go slows velocity significantly. |
| **CPU-Bound Tasks (Heavy AST parsing, large diffs)** | Python GIL can bottleneck heavy CPU-bound AST graph calculations. | Multi-core true parallel execution across goroutines. | **Recommendation**: Offload heavy sandboxed code execution and AST diff computation to worker containers (Cloud Run Jobs / Docker Sandbox). |

### 🎯 Architectural Verdict
**Keep FastAPI for the Core Control Plane & AI Orchestration**, with the following optimizations:
1. **Redis Pub/Sub Layer**: For multi-node real-time chat, activity broadcasts, and agent run updates.
2. **Worker Sandbox Isolation**: Heavy agent execution and unit tests run in independent containers (Docker / Cloud Run Jobs), preventing CPU starvation of the web API.
3. **Session Caching**: Redis-backed distributed sessions to enable seamless multi-pod scaling.

---

## 💡 Industry Reference Architectures & Insights

### 1. Headroom Labs (`headroomlabs-ai/headroom`)
- **Key Pattern**: Context-aware memory hierarchies and multi-tier agent reflection loops.
- **Application to Karkhana**:
  - Incorporate hierarchical project context (Workspace Rules → Product Constraints → Story Invariants → File AST).
  - Use structured summarization before passing conversation history to agent execution loops to conserve token budgets.

### 2. Fabro (`fabro-sh/fabro`)
- **Key Pattern**: Declarative pipeline orchestration with deterministic phase gates and artifact immutability.
- **Application to Karkhana**:
  - Implement task dependency graphs where each station produces a verified signed artifact before unlocking the subsequent station.
  - Immutable run manifests verified against the SHA-256 evidence ledger.
