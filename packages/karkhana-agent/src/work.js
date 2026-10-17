// The work loop: claim a job, build it in a worktree, report, repeat.
import { hostname } from 'node:os';
import { deviceClient, runClient } from './api.js';
import { buildTask } from './build.js';
import { makeGate } from './gate.js';
import { commit, ensureClone, ensureCloneAt, expandPath, stagedDiff, taskWorktree, workState } from './git.js';
import { DEFAULT_LIMITS, FIX_LIMITS, harnessFor } from './harness.js';
import { preflightSuites, runSuites, testSuites } from './testrun.js';

const HEARTBEAT_MS = 60_000;

export { buildPrompt } from './prompts.js';

/** Buffers log lines and sends them in batches, about once a second. */
function logSink(device, jobId) {
  let buffer = [];
  let timer = null;
  const flush = async () => {
    timer = null;
    const lines = buffer.splice(0, 200);
    if (lines.length) await device.logs(jobId, lines).catch(() => {});
  };
  const log = (level, message) => {
    console.log(`  ${level === 'error' ? '!' : '·'} ${message}`);
    buffer.push({ level, message: String(message).slice(0, 4000) });
    timer ??= setTimeout(flush, 1000);
  };
  log.flush = async () => {
    clearTimeout(timer);
    while (buffer.length) await flush();
  };
  return log;
}

const TERMINAL = new Set(['failed', 'cancelled', 'timed_out', 'succeeded']);

const realDeps = () => ({ testSuites, runSuites, preflightSuites, preflight: preflightSuites, workState, stagedDiff, commit });

/** Reads the caps from the environment: KARKHANA_MAX_COST_USD, KARKHANA_MAX_TURNS. */
function capsFromEnv(env = process.env) {
  const cost = Number(env.KARKHANA_MAX_COST_USD);
  const turns = Number(env.KARKHANA_MAX_TURNS);
  if (!(cost > 0) && !(turns > 0)) return {};
  const build = { ...DEFAULT_LIMITS, ...(turns > 0 ? { maxTurns: turns } : {}), ...(cost > 0 ? { maxCost: cost } : {}) };
  return { build, fix: { maxTurns: Math.min(FIX_LIMITS.maxTurns, build.maxTurns), maxCost: Math.min(FIX_LIMITS.maxCost, build.maxCost / 2) } };
}

async function buildJob(job, device, { workDir, harness, sandbox, deps = realDeps(), harnessImpl }) {
  const runApi = runClient(job.callbackUrl, job.runId, job.runToken);
  const log = logSink(device, job.jobId);
  // The heartbeat repeats the current phase, so it never moves a run backwards, and it
  // hears when the developer pressed Stop: the coding agent is then stopped at once.
  const stop = new AbortController();
  let phase = 'cloning';
  const setPhase = (p) => {
    phase = p;
    return runApi.progress(p);
  };
  const heartbeat = setInterval(async () => {
    try {
      const r = await runApi.progress(phase);
      if (r && TERMINAL.has(r.status)) stop.abort();
    } catch {
      /* a missed heartbeat is retried on the next tick */
    }
  }, HEARTBEAT_MS);
  let worktree = null;
  try {
    const spec = await runApi.spec();
    const url = spec.repo_url || (spec.repo ? `https://github.com/${spec.repo}.git` : null);
    if (!url) throw new Error('The project has no repository.');
    log('info', `${spec.task_key}: ${spec.task_title}`);

    await setPhase('cloning');
    // The developer may have chosen the folder for this project (Developer → Machines).
    const clone = job.workDir
      ? await ensureCloneAt(expandPath(job.workDir), url, spec.base_branch)
      : await ensureClone(url, workDir, spec.base_branch);
    const branch = `karkhana/${spec.task_key.toLowerCase()}-${job.runId.slice(0, 8)}`;
    const wt = await taskWorktree(clone, branch, spec.base_branch, spec.task_key.toLowerCase());
    worktree = wt.path;
    log('info', `${wt.resumed ? 'continuing in' : 'new worktree'} ${worktree}${wt.resumed ? '' : ` on ${branch} (from origin/${spec.base_branch})`}`);

    await setPhase('coding');
    const out = await buildTask({
      spec,
      worktree,
      baseBranch: spec.base_branch,
      resumed: wt.resumed,
      sandbox,
      log,
      report: (suite) => runApi.tests(suite),
      signal: stop.signal,
      commitMessage: `${spec.task_key}: ${spec.task_title}\n\nKarkhana run ${job.runId}`,
      caps: capsFromEnv(),
      deps: {
        ...deps,
        harness: harnessImpl ?? harnessFor(job.harness || harness),
        pause: makeGate({ runApi, control: spec.control, signal: stop.signal, log }),
      },
    });

    const tests = out.result;
    const common = {
      test_command: tests?.label ?? null,
      test_exit_code: tests?.code ?? null,
      test_output: tests?.output ?? null,
      test_suites: out.suites,
    };
    if (!out.ok) {
      log('error', out.error);
      await runApi.complete({ ok: false, error: out.error.slice(0, 1500), ...common }).catch(() => {});
      return { ok: false, worktree, error: out.error };
    }
    await setPhase('validating');
    // The change stays on this machine until the developer raises the pull request.
    await runApi.complete({
      ok: true,
      publish: false,
      patch: out.patch,
      ...common,
      summary: (out.summary || '').slice(0, 4000) || null,
      reviewed: false,
    });
    return { ok: true, worktree };
  } catch (err) {
    log('error', err.message);
    await runApi.complete({ ok: false, error: err.message.slice(0, 1500) }).catch(() => {});
    return { ok: false, worktree, error: err.message };
  } finally {
    clearInterval(heartbeat);
    await log.flush();
  }
}

export { buildJob };

/** Claims and builds jobs until stopped (Ctrl+C) or, with `once`, after one job. */
export async function work(config, { workDir, harness, sandbox, once = false }) {
  const device = deviceClient(config.server, config.token);
  let stopping = false;
  process.once('SIGINT', () => {
    stopping = true;
    console.log('\nstopping after the current job…');
  });
  console.log(`karkhana-agent on ${hostname()}: waiting for work from ${config.server}; tests run ${sandbox === 'docker' ? 'in a Docker sandbox' : 'directly on this machine (no sandbox)'} (Ctrl+C to stop)`);
  while (!stopping) {
    let claimed;
    try {
      claimed = await device.claim();
    } catch (err) {
      if (err.status === 401) throw err;
      console.error(`claim failed (${err.message}); retrying in 10 s`);
      await new Promise((r) => setTimeout(r, 10_000));
      continue;
    }
    if (!claimed?.job) continue;
    const job = claimed.job;
    console.log(`\n▶ ${job.taskKey} ${job.taskTitle} (${job.projectName})`);
    const result = await buildJob(job, device, { workDir, harness, sandbox });
    await device
      .finish(job.jobId, { status: result.ok ? 'succeeded' : 'failed', error: result.error ?? null, worktree: result.worktree })
      .catch(() => {});
    console.log(result.ok ? `✔ done: ${result.worktree}` : `✖ failed: ${result.error}`);
    if (once) break;
  }
  return 0;
}

