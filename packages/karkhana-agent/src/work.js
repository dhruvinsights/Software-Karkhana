// The work loop: claim a job, build it in a worktree, report, repeat.
import { hostname } from 'node:os';
import { deviceClient, runClient } from './api.js';
import { commit, ensureClone, stagedDiff, taskWorktree } from './git.js';
import { harnessFor } from './harness.js';
import { runSuites, testSuites } from './testrun.js';

const HEARTBEAT_MS = 60_000;

export function buildPrompt(spec) {
  const criteria = spec.acceptance_criteria.map((c) => `- ${c}`).join('\n');
  const context = spec.context.map((c) => `- [${c.kind}] ${c.title} (${c.author}): ${c.body}`).join('\n');
  return [
    `You are implementing one story in the ${spec.project_name} repository, in this directory.`,
    '',
    `STORY ${spec.task_key}: ${spec.task_title}`,
    spec.task_description ? `NOTES: ${spec.task_description}` : '',
    '',
    'ACCEPTANCE CRITERIA:',
    criteria,
    '',
    context ? `SHARED PROJECT CONTEXT (approved design, decisions and handoffs; follow them):\n${context}\n` : '',
    'How to work:',
    '1. Read README and the code you will change first. Follow the existing style.',
    '2. Make the smallest change that meets every criterion.',
    '3. Add or update tests that prove each criterion, then run the test suite and fix failures.',
    '4. Do not add dependencies the story does not need. Do not weaken or delete existing tests.',
    '5. Do not run git commands; the agent commits for you.',
    'When you are done, reply with a short summary of what you changed and how you tested it.',
  ].join('\n');
}

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

async function buildJob(job, device, { workDir, harness, sandbox }) {
  const runApi = runClient(job.callbackUrl, job.runId, job.runToken);
  const log = logSink(device, job.jobId);
  // The heartbeat repeats the current phase, so it never moves a run backwards.
  let phase = 'cloning';
  const setPhase = (p) => {
    phase = p;
    return runApi.progress(p);
  };
  const heartbeat = setInterval(() => runApi.progress(phase).catch(() => {}), HEARTBEAT_MS);
  let worktree = null;
  try {
    const spec = await runApi.spec();
    const url = spec.repo_url || (spec.repo ? `https://github.com/${spec.repo}.git` : null);
    if (!url) throw new Error('The project has no repository.');
    log('info', `${spec.task_key}: ${spec.task_title}`);

    await setPhase('cloning');
    const clone = await ensureClone(url, workDir, spec.base_branch);
    const branch = `karkhana/${spec.task_key.toLowerCase()}-${job.runId.slice(0, 8)}`;
    worktree = await taskWorktree(clone, branch, spec.base_branch, spec.task_key.toLowerCase());
    log('info', `worktree ${worktree} on ${branch} (from origin/${spec.base_branch})`);

    await setPhase('coding');
    const summary = await harnessFor(job.harness || harness)(buildPrompt(spec), worktree, log);

    await setPhase('validating');
    const suites = await testSuites(worktree);
    const tests = await runSuites(worktree, suites, sandbox, (suite) => runApi.tests(suite));
    for (const r of tests.suites) {
      const counts = r.total != null ? ` (${r.passed} passed, ${r.failed} failed of ${r.total})` : '';
      log(r.status === 'passed' ? 'output' : 'error', `${r.suite}: ${r.status}${counts} · ${r.command}`);
    }

    const patch = await stagedDiff(worktree);
    if (!patch.trim()) {
      await runApi.complete({ ok: false, error: 'The agent made no changes.', test_exit_code: tests.code, test_output: tests.output, test_command: tests.label, test_suites: tests.suites });
      return { ok: false, worktree, error: 'no changes' };
    }
    await commit(worktree, `${spec.task_key}: ${spec.task_title}\n\nKarkhana run ${job.runId}`);
    log('info', 'committed locally; sending the change for review and the pull request');
    await runApi.complete({
      ok: true,
      patch,
      test_command: tests.label,
      test_exit_code: tests.code,
      test_output: tests.output,
      test_suites: tests.suites,
      summary: summary.slice(0, 4000) || null,
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

