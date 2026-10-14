# Learning guide: the ideas behind Software Karkhana

`BUILD_LOG.md` records *what* was built and why. This guide teaches the *ideas* underneath,
so anyone on the team can explain them to a judge and change the code safely.

How to use it: each concept has **the idea in plain words**, **where it lives in our code**,
a **Check yourself** question, and **resources**. Answer the question before reading on.
If you can't, open the file it points to and find the answer there. That is the learning.

---

## Part 1. The product ideas

### 1.1 What is a software factory?

**The idea.** A factory turns raw material into finished goods through fixed stations, with
quality checks between them. A *software factory* does the same for software: an idea goes
in, and it moves through defined stations (evaluate → plan → build → validate → review →
release). Each station has an owner, a gate and a record. The point is not speed alone. The
point is that **every project follows the same process, and every step leaves evidence**.

"Karkhana" is Hindi/Urdu for factory or workshop.

A factory has three things a loose team doesn't:

| Factory element | In Karkhana | File |
|---|---|---|
| Stations in a fixed order | 15 lifecycle stages | `app/process.py` (`STAGES`) |
| Quality gates between stations | Director approval, mandatory triage, test validation | `TRANSITIONS`, `merge_blockers()` |
| A record of every unit | Hash-chained evidence ledger | `app/ledger.py` |
| Workers at stations | People **and** AI agents (Evaluator, Coder, Reviewer) | `app/ai/`, `app/agents/` |
| Inspection you can't skip | Tests run by the worker, not claimed by the agent | `app/worker/main.py` |

**What makes ours different from "an AI that writes code":** AI is a worker at some stations,
never the inspector. Gates are always human (Director approves, developer triages, lead
verifies). The factory works with AI switched off; AI only makes stations faster.

```
 Idea ──▶ [Evaluate] ──gate: Director──▶ [Plan] ──▶ [Build: agent] ──gate: tests──▶
          AI drafts                       stories    in a worker
 ──▶ [Review: AI comments] ──gate: human triage──▶ [Merge] ──▶ [Learn: verified memory]
                                                                     │
          next project's [Evaluate] reuses verified lessons ◀────────┘
```

**Check yourself:** Name the three gates where a *person* must act before work can move on,
and the file that enforces each.

**Resources**
- Google's DORA research on what makes delivery fast *and* safe: <https://dora.dev/research/>
- "Software factory" defined (DoD DevSecOps Fundamentals, the most cited definition): <https://dodcio.defense.gov/Portals/0/Documents/Library/DoD%20Enterprise%20DevSecOps%20Fundamentals%20v2.5.pdf>
- A shorter industry take: <https://tanzu.vmware.com/software-factory>
- Anthropic, *Building effective agents* (when to use workflows vs autonomous agents): <https://www.anthropic.com/engineering/building-effective-agents>

---

### 1.2 Human-in-the-loop and trust labels

**The idea.** AI output is a *draft*, not a fact. Every item on screen says where it came from:
*AI-generated, unverified*; *Verified by code*; *Human-approved*; *Assumption*; *Cached*.
A judge can see at a glance what was checked and by whom.

**In our code:** `web/src/components/common.tsx` (`Badge`), and the rule that only **verified**
learnings are ever reused (`app/memory.py`).

**Check yourself:** Why would reusing an *unverified* AI learning on the next project be worse
than having no memory at all?

---

## Part 2. Orchestration: how the agents and steps are coordinated

### 2.1 What is orchestration?

**The idea.** Orchestration is the conductor: something that decides *what runs, when, in what
order, and what happens if it fails*. Without it, you have a set of capable tools and no one
deciding when to use them.

There are two styles. Knowing the difference is the core of agent design:

| Style | Who decides the next step | Good for | In Karkhana |
|---|---|---|---|
| **Workflow** (deterministic) | Your code | Steps that must happen in order with gates | The project lifecycle: `process.py` transition table |
| **Agent** (model-driven) | The LLM, choosing tools in a loop | Open-ended work where the path isn't known | The Coder deciding which files to read and edit |

**Our rule:** the *workflow* is in charge, and agents run *inside* one step of it. The Coder can
loop freely, reading files, editing, running tests, but only inside the "implement" step, only
with 5 tools, only up to 40 model calls, and its result is checked by code afterwards.

**Check yourself:** The Coder says "done, all tests pass". Who decides whether the project
moves forward, and based on what?

**Resources**
- Anthropic, *Building effective agents* (workflows vs agents, the clearest short read): <https://www.anthropic.com/engineering/building-effective-agents>
- ADK documentation (agents, tools, runners, multi-agent): <https://adk.dev/>
- ADK on Google Cloud: <https://docs.cloud.google.com/agent-builder/agent-development-kit/overview>

### 2.2 Agents, tools and runners in Google ADK

**The idea.**
- An **agent** (`LlmAgent`) = a model + instructions + tools.
- A **tool** = a plain Python function the model may call. ADK reads its docstring and type hints to tell the model how to use it.
- A **runner** executes the agent loop: model → tool call → result → model … until a final answer.
- A **session** holds the conversation state during the run.
- **`output_schema`** forces the final answer into a typed shape (our Reviewer returns exactly `ReviewOutput`).

**In our code:** `app/agents/coder.py` (`build_coder`, `build_reviewer`, `_run`), `app/agents/tools.py`.

**Check yourself:** Why does the Coder get `replace_in_file` *and* `write_file`, and why is
`replace_in_file` required to match exactly once?

### 2.3 State machines: the process engine

**The idea.** A state machine says: you are in state X; event E is allowed only from certain
states; it moves you to state Y. Everything not listed is forbidden. It makes illegal moves
impossible by construction, instead of hoping every `if` statement is right.

**In our code:** `app/process.py`. `TRANSITIONS[(stage, status, event)] = (new_stage, new_status, roles)`.
Anything not in the table returns 409; the wrong role returns 403.

**Check yourself:** A second agent run fails after the project already moved to review. Which
row in the table handles that, and why did we add it instead of ignoring the event?

**Resources:** statecharts.dev intro: <https://statecharts.dev/what-is-a-state-machine.html>

### 2.4 Control plane vs execution plane

**The idea.** This is the most important architecture idea in the project, borrowed from how
large platforms (Kubernetes, Ona/Gitpod, cloud providers) are built:

- The **control plane** decides and records: who may do what, what may run, what state things are in. It is small, trusted, and holds the secrets.
- The **execution plane** does the heavy, risky work: running agents and untrusted code. It is disposable, holds as little as possible, and reports back.

```
 Control plane (Cloud Run service, trusted)          Execution plane (Cloud Run Job, untrusted)
 ┌───────────────────────────────────────┐   start   ┌──────────────────────────────────┐
 │ roles · process engine · ledger       │──────────▶│ clone (read-only) · ADK Coder    │
 │ Cloud SQL · GitHub token · publisher  │◀──────────│ pytest · diff · ADK Reviewer     │
 └───────────────────────────────────────┘  patch +  └──────────────────────────────────┘
          │ applies patch, pushes, opens PR  results     holds NO GitHub token
          ▼                                  (HMAC)
       GitHub
```

**Why the split matters:** a worker can crash, time out or be replaced, and the project state is
safe because the control plane owns it. And because the worker runs code the agent wrote,
anything it holds could leak. So it holds nothing worth stealing (see 4.4).

**In our code:** `app/runner/` (the contract), `app/worker/main.py` (execution),
`app/publisher.py` (control-plane publishing), ADR-001 in the project docs.

**Check yourself:** Why did we move "push branch and open PR" *out* of the worker in review
round 3? What could a malicious test file have done before?

### 2.5 Idempotency, locks and races

**The idea.**
- **Idempotent** means doing it twice has the same effect as doing it once. Networks retry, so every callback must be safe to repeat.
- A **race** is when two things happen at once and the result depends on timing.
- A **lock** makes one of them wait.

| Problem | Our fix | File |
|---|---|---|
| Worker callback arrives twice | Terminal runs ignore late callbacks; `phase='publishing'` claim before publishing | `routers/runs.py` |
| Two Cloud Run instances append to the ledger at once | Postgres advisory lock → one linear chain | `ledger.py` |
| Two runs change the project stage at once | Project row lock (`SELECT … FOR UPDATE`) | `routers/common.py` |
| Two "Retry AI review" clicks at once | PR row lock; second request gets 409 | `routers/reviews.py` |

**Check yourself:** In the review-retry race test, why does one request get 200 and the other
409, and never both 200?

**Resources**
- Stripe on idempotency (the classic explainer): <https://stripe.com/blog/idempotency>
- Postgres row locks: <https://www.postgresql.org/docs/16/explicit-locking.html>

### 2.6 Evidence ledger (tamper-evident log)

**The idea.** Each entry stores the hash of the previous entry. Change any old entry and every
hash after it stops matching, so tampering is *visible*. Certificate Transparency uses the
same idea for the web's TLS certificates.

**In our code:** `app/ledger.py`, the "Verify chain" button, and `db/migrations` (the app role
can't UPDATE or DELETE, and a trigger blocks even the owner).

**Check yourself:** Tamper-*proof* or tamper-*evident*: which one is this, honestly?

**Resources:** <https://certificate.transparency.dev/howctworks/>

### 2.7 Memory and retrieval (RAG)

**The idea.** Text becomes a list of numbers (an *embedding*) so that similar meanings sit close
together. To "remember", we embed the new idea and find the nearest *verified* learnings
(pgvector cosine distance), then give them to Gemini with their sources. That is
retrieval-augmented generation (RAG).

**In our code:** `app/memory.py` (`retrieve`, `capture_on_merge`), `learnings.embedding vector(768)`.

**Check yourself:** Why did memory reuse (B3) fail in our offline test run but nothing else did?

**Resources:** <https://docs.cloud.google.com/sql/docs/postgres/work-with-vectors> ·
<https://github.com/pgvector/pgvector>

---

## Part 3. AI reliability: making a model's output trustworthy

| Technique | What it does | File |
|---|---|---|
| Structured output (`response_schema`) | Gemini must return our exact JSON shape | `app/ai/genai.py` |
| Validate again (Pydantic) | Never trust the shape blindly | `app/schemas.py` |
| Grounding check | Every epic's quote must appear in the idea text | `app/ai/evaluator.py` |
| One repair pass | Send exact errors back, retry once | `evaluator.evaluate` |
| Code decides, not the model | Test exit code from the worker; citations enriched from the DB | `worker/main.py`, `routers/projects.py` |
| Labelled fallbacks | Cached answers for the stage, always marked "Cached" | `app/ai/fallbacks/` |

**Check yourself:** Which of these would still catch an epic whose quote is real but whose stories
go far beyond what the quote says? (Honest answer: none of them fully. That's why the Director gate exists.)

**Resources:** <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output>

---

## Part 4. Infrastructure: how it runs on Google Cloud

### 4.1 Cloud Run services vs Cloud Run Jobs

**The idea.**
- A **service** answers HTTP requests and scales with traffic. It is our API and website.
- A **job** runs a task to completion and exits. It is our coding worker (one execution per agent run) and our migration step.
- Both run the same container image; only the start command differs.

**In our code:** `Dockerfile` (one image), `cloudbuild.yaml` (one service and two jobs),
`app/runner/cloudrun_job.py` (starts an execution with per-run env overrides).

**Check yourself:** Why is a *job* a better fit than a service for running one agent task?

**Resources:** <https://docs.cloud.google.com/run/docs/execute/jobs> ·
Cloud Run overview: <https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run>

### 4.2 Identity: service accounts and least privilege

**The idea.** In Google Cloud, programs have identities too (*service accounts*). Each gets only
the permissions its job needs ("least privilege"). Then a bug or a leak in one part can't
reach everything.

| Identity | Can | Cannot |
|---|---|---|
| `karkhana-run` (API) | Cloud SQL as IAM user, Vertex AI, start worker jobs, read HMAC + GitHub secrets | Change the schema |
| `karkhana-worker` | Vertex AI, upload run artifacts | Database, **any secret**, GitHub |
| `karkhana-migrate` | Connect to Cloud SQL as schema owner | Anything else |

**Check yourself:** A malicious test in the agent's repo calls the metadata server and gets the
worker's access token. What's the worst it can do?

**Resources:** <https://docs.cloud.google.com/run/docs/securing/service-identity> ·
<https://docs.cloud.google.com/iam/docs/using-iam-securely>

### 4.3 Secrets and keyless database login

**The idea.** Secrets live in Secret Manager and are injected at deploy time, never stored in
code or images. Better still is having no secret at all: with **IAM database
authentication**, the API's service account *is* its database login, so no database
password exists for the app.

**In our code:** `app/db.py` (Cloud SQL Python Connector, `enable_iam_auth=True`),
`infra/bootstrap.sh` (secrets, IAM users), `cloudbuild.yaml` (`--set-secrets`).

**Resources:** <https://docs.cloud.google.com/sql/docs/postgres/iam-logins> ·
<https://docs.cloud.google.com/run/docs/configuring/services/secrets>

### 4.4 Trust boundaries (security thinking)

**The idea.** Draw a line around everything that runs code you didn't write or check. Anything
inside that line must be assumed compromised. So give it nothing it could misuse.

Our boundary is the worker. pytest runs tests the *agent* wrote, so a malicious `conftest.py`
could read the worker's environment. Round 3 removed the GitHub token from the worker
entirely. What remains inside the line, stated honestly:
- the run's own callback token, which can only report on this run;
- Vertex AI access;
- outbound network.

**Check yourself:** Why is "the agent could write a test that always passes" *not* fixed by
isolation, and what in our process catches it instead?

### 4.5 CI and CD

**The idea.**
- **CI (continuous integration):** every change is automatically built and tested, so mistakes are caught in minutes.
- **CD (continuous delivery):** every good build can be deployed with one command.
- Keep CI *deterministic*: no live AI or third-party calls, so an outage elsewhere never turns it red.

**In our code:**
- `.github/workflows/ci.yml`: lint; Postgres with pgvector; all tests, failing if any skip; web build and audit; Docker build.
- `cloudbuild.yaml`: build → migrate → deploy.

**Resources:**
- Martin Fowler, *Continuous Integration*: <https://martinfowler.com/articles/continuousIntegration.html>
- Cloud Build config reference: <https://docs.cloud.google.com/build/docs/build-config-file-schema>
- Google SRE book (reliability thinking, free online): <https://sre.google/sre-book/table-of-contents/>

### 4.6 Infrastructure as a script

**The idea.** If setting up the environment needs a person clicking in a console, nobody can
repeat it reliably. `infra/bootstrap.sh` creates everything from zero and is *idempotent*: safe
to run again. It is the step before full Terraform, and the right size for two days.

**Check yourself:** What does "idempotent" mean for `bootstrap.sh`, and which line shows it?

**Resources:** Agent Starter Pack (Google's production template, which uses Terraform): <https://github.com/GoogleCloudPlatform/agent-starter-pack>

---

## Part 5. How the design evolved (the process, honestly)

Good engineering is iterative. Each round found real problems, and the fixes made the
design better, not just patched:

| Round | Found by | What changed | Lesson |
|---|---|---|---|
| Build (Wed night) | Our own tests | Background evaluation read uncommitted data; app role lacked DELETE for redrafting | Test against the *real* database with the *real* permissions |
| Review 1 | Independent reviewer | Fallback dropped memory; regional location override; no surgical edit tool; reviewer outage blocked merge; concurrent runs desynced stage | Every failure path needs a recovery path |
| Windows run | Teammate's machine | Backslash paths; scrubbed env broke Windows sockets (`WinError 10106`) | "Works on my machine" is not verification |
| Browser run | Automated Chromium walkthrough | Stale "evaluating" banner; wrong test-command display | Unit tests don't see what users see |
| Review 3 | Independent reviewer | **Worker no longer holds GitHub credentials**; separate worker/validation status; race-safe retry; CI; dated evidence | Find the trust boundary, then empty it |

**Check yourself:** Pick one row. Could the problem have been caught earlier, and by which kind of test?

---

## Learning path (about 4 hours)

1. Part 1 + Anthropic's *Building effective agents* (40 min). Why this product exists.
2. Part 2.1–2.4, then read `app/process.py` and `app/worker/main.py` (60 min). How it's orchestrated.
3. ADK docs + `make playground` on the demo repo (45 min). Agents in practice.
4. Part 4, then read `infra/bootstrap.sh` and `cloudbuild.yaml` side by side (45 min). How it runs.
5. Part 2.5 + `tests/integration/test_golden_path.py` (40 min). How we prove it works.
6. Part 5 (15 min). How to think about the next round.
