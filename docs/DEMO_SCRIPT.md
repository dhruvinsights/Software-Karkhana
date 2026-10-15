# Demo script (v2 — about 5 minutes)

> **v2 update:** `DEMO_FALLBACK` is gone. All model responses are real. No cached outputs are shown. The runner shows honest status ("AX not connected" if no cluster). Onboarding is the entry point for new users.

Two browser windows: PM and Director in one, Developer and Lead in the other.

1. **Problem (20 s).** Teams work on ideas nobody recorded. Agents ship code nobody can trace. Nobody knows what was decided, by whom, and why.

2. **Onboarding (30 s).** Open the app fresh. Show the two-choice landing: "Create a workspace" or "Join". Create a workspace — name it, pick a role, skip the template, invite a teammate. Land on the workspace home: "Create your first project". No fake data, no seeded cards.

3. **PM submits a task (30 s).** Create a project. Add a task with a description. Show the task detail drawer with acceptance criteria and the context pack that was assembled for it (top-k project context entries). Every entry shows source and `verified_at`.

4. **The gate (30 s).** Show that the Developer's call to approve gets 403. The Director approves with a reason. Draft task becomes Ready. The ledger records the transition with actor, org and correlation ID.

5. **The agent builds (60 s).** The Developer clicks **Assign to agent**. The task view shows the provider: `Gemini / gemini-3-flash` or `Ollama / qwen2.5-coder:14b`. The run live view shows ADK tool calls and model steps as they stream in. Open the real GitHub PR and its `karkhana/tests` status from the actual run.

   If no AX cluster is connected, the runner status shows "AX not connected" — that is honest, not an error. The run uses the local runner or Cloud Run Jobs instead.

6. **Mandatory triage (40 s).** AI review findings labelled *AI-generated, unverified* with engine and model shown ("Karkhana AI review (PR-Agent / qwen2.5-coder:14b)"). The merge button stays disabled. Mark findings Valid or Dismissed (reason required). Merge.

7. **Shared context (30 s).** The merge distills a learning from the PR triage. It appears in the Context Explorer as `source=agent, verified_at=null`. The Lead verifies it. Open the Context Pack for the next task: the verified learning appears in the pack with source, confidence and `valid_from`.

8. **Evidence (20 s).** Scroll to the ledger. Click **Verify chain**. Open the Audit log — every state change is there with actor, org and timestamp. Open Provider Health — Gemini `configured: true`; AX `available: false` if no cluster — no green checkmarks for things that are not configured.

9. **Google stack (10 s).** Gemini on Vertex AI, ADK worker adapter, Cloud Run Jobs, Cloud SQL Postgres + pgvector, Firebase Auth, Secret Manager, Cloud Build, Artifact Registry, Cloud Storage, Cloud Logging.

---

**If Gemini or Jobs are slow:**
- Use `LLM_PROVIDER=ollama` with `qwen2.5-coder:14b` for a slower but fully local run.
- Use `RUNNER_BACKEND=local` to run the worker in the API container.
- There is no `DEMO_FALLBACK`. If the model is unavailable, the UI shows "model unavailable" with a retry action.

**Key talking points:**
- Every response comes from a real model call. No cached outputs, ever.
- The runner shows honest state. "AX not connected" is not a bug — it is the product telling the truth.
- AI never approves its own changes. The merge button enforces mandatory human triage server-side.
- The evidence ledger records every consequential action, not just the happy path.
- Shared context carries verified knowledge across runs and sessions — only what a Lead has confirmed.
