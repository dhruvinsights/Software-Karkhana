# Demo script (about 4 minutes)

Two browser windows: PM and Director in one, Developer and Lead in the other.

1. **Problem (20 s).** The PM waited three years. Every team heard a different
   version of the idea. Nothing was recorded.
2. **PM submits the idea (40 s).** Paste "Invoice discount codes". Show the score, the gaps
   (Assumption badge), and the epics with their verbatim quotes. Say: *"Every epic is
   checked against her words on the server. Invented epics are rejected."*
3. **The gate (30 s).** Show that the Developer's call to approve gets 403. The Director
   approves with a reason. Draft stories become Ready.
4. **The agent builds (60 s).** The Developer clicks **Assign to agent** on "Apply a percentage
   discount code". The ADK Coder runs in a Cloud Run Job. Open the real GitHub PR and its
   `karkhana/tests` status from the actual run.
5. **Mandatory triage (40 s).** Four AI comments labelled *AI-generated, unverified*. The merge
   button stays disabled. Mark three Valid, dismiss one with a reason, then merge.
6. **Memory (40 s).** The Lead verifies the captured learning. The PM submits "Multi-currency
   refunds". The evaluation cites the verified learning with project, PR and verifier.
7. **Evidence (20 s).** Scroll to the ledger, click **Verify chain**, then open Portfolio:
   "QA: pending, Security: pending". Say: *"We don't claim production-ready. We show the evidence."*
8. **Google stack (10 s).** Gemini on Vertex AI, ADK, Cloud Run plus Jobs, Cloud SQL with
   pgvector, Firebase Auth, Secret Manager, Cloud Build, Artifact Registry, Cloud Storage
   and Cloud Logging.

**Backup:** if Gemini or Jobs are slow on stage, `DEMO_FALLBACK=true` serves cached outputs
labelled "Cached", and `RUNNER_BACKEND=local` runs the same worker in the API container.
