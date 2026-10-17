# karkhana-agent

Connects a developer machine to Software Karkhana. When a developer presses **Build on my machine** on a story, this agent claims the job, codes the story with your own coding agent (Bob or Claude Code), runs the tests, commits locally and sends the result back for review and a pull request.

Model keys and source code stay on your machine. The agent dials out to the server, so no inbound port is needed.

## Requirements

- Node 20 or newer
- `bob` or `claude` on your `PATH`
- `git`
- Docker (optional). When present, tests run in a sandbox.

## Use

```bash
# 1. In Software Karkhana: Project → Developer → Connect a machine. Copy the one-time code.
npx karkhana-agent login --server https://<server> --code XXXX-XXXX --harness bob

# 2. Leave this running. It waits for builds you start in the app.
npx karkhana-agent work

npx karkhana-agent status    # shows the connection
npx karkhana-agent logout    # forgets the token (also revoke the machine in the app)
```

`work` options:

| Flag | Default | Meaning |
|---|---|---|
| `--dir <path>` | `~/karkhana-work` | Where clones and worktrees live |
| `--harness bob\|claude` | the one chosen at login | Which coding agent writes the code |
| `--sandbox docker\|none` | `docker` when available | Where tests run |
| `--once` | off | Handle one job and exit |

## What happens for each job

1. Claims a job (long-poll, `FOR UPDATE SKIP LOCKED` on the server, so several API instances are safe).
2. Clones the repo once, then creates a git worktree per story: `<dir>/<repo>.worktrees/<story>`.
3. Fetches the story spec (title, acceptance criteria, shared context) from the run callback.
4. Runs the harness in the worktree. The harness is told not to run git; the agent commits.
5. Detects the test command from the repository file (never from a string run through a shell) and runs it.
6. Commits locally and reports back. The control plane reviews the change and opens the PR.

## Sandbox

With Docker, tests run with a read-only root filesystem, only the worktree mounted, a non-root user and CPU and memory limits. Without Docker, pass `--sandbox none` to run them directly on the machine.

## Files

| Path | Role |
|---|---|
| `src/cli.js` | `login`, `work`, `status`, `logout` |
| `src/api.js` | Calls to pairing, claim, logs and finish endpoints |
| `src/work.js` | The loop: claim, build in a worktree, report |
| `src/harness.js` | Adapters for `bob` and `claude` |
| `src/git.js` | Clone, worktree, staged diff, commit |
| `src/testrun.js` | Test command detection and Docker sandbox |
| `src/config.js` | Stored connection (token, device id) |

## Test

```bash
node --test
```

## Known limits

- Only the Bob and Claude Code adapters exist. Gemini CLI and Ollama are not built.
- No local approval prompt yet for risky steps such as dependency installs.
