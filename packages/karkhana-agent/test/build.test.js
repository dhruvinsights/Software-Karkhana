import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildTask, MAX_FIX_ROUNDS } from '../src/build.js';
import { commit, ensureCloneAt, expandPath, repoSlug, stagedDiff, taskWorktree, workState } from '../src/git.js';
import { classifyFailure, harnessEnv, HarnessError } from '../src/harness.js';
import { must, run } from '../src/proc.js';

// The developer's global git hooks (secret scanners and the like) make every commit
// slow; these tests exercise git itself, so they run with a clean git configuration.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const tmp = () => mkdtemp(join(tmpdir(), 'kb-'));
const GIT = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

/** A bare origin with one commit on main, a clone of it and a fresh task worktree. */
async function fixture() {
  const root = await tmp();
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  await must('git', ['init', '--quiet', '--bare', '-b', 'main', origin]);
  await must('git', ['init', '--quiet', '-b', 'main', seed]);
  await writeFile(join(seed, 'README.md'), '# app\n');
  await must('git', [...GIT, '-C', seed, 'add', '-A']);
  await must('git', [...GIT, '-C', seed, 'commit', '--quiet', '-m', 'base']);
  await must('git', ['-C', seed, 'push', '--quiet', origin, 'main']);
  const clone = await ensureCloneAt(join(root, 'clone'), origin, 'main');
  const wt = await taskWorktree(clone, 'karkhana/iss-1-abc', 'main', 'iss-1');
  return { root, origin, clone, wt };
}

const spec = {
  project_name: 'App', task_key: 'ISS-1', task_title: 'Add thing', task_description: '',
  acceptance_criteria: ['It works'], context: [],
};
const realGit = { workState, stagedDiff, commit };
const quiet = () => {};

/** Suites that are red for the first ``redRuns`` runs, then green. */
function fakeSuites(redRuns) {
  let runs = 0;
  return {
    testSuites: async () => [{ name: 'unit', argv: ['x'] }],
    runSuites: async (_wt, _s, _sb, report) => {
      runs += 1;
      const red = runs <= redRuns;
      const suite = { suite: 'unit', status: red ? 'failed' : 'passed', passed: red ? 2 : 3, failed: red ? 1 : 0, total: 3, command: 'pytest tests/unit', output: red ? 'FAILED test_a - assert 1 == 2' : '3 passed' };
      await report?.(suite);
      return { code: red ? 1 : 0, output: suite.output, label: 'pytest', suites: [suite] };
    },
    get runs() { return runs; },
  };
}

function fakeHarness(write) {
  const calls = [];
  const fn = async (prompt, worktree) => {
    calls.push(prompt);
    await write?.(worktree, calls.length);
    return { summary: `call ${calls.length}`, cost: 0.1, turns: 3 };
  };
  fn.calls = calls;
  return fn;
}

const writeFeature = (wt, n) => writeFile(join(wt, `feature${n}.py`), `x = ${n}\n`);

async function build(f, { redRuns = 0, harness, resumed = false, signal } = {}) {
  const suites = fakeSuites(redRuns);
  const out = await buildTask({
    spec, worktree: f.wt.path, baseBranch: 'main', resumed, sandbox: 'none', log: quiet, report: async () => {}, signal,
    commitMessage: 'ISS-1: Add thing', deps: { ...realGit, ...suites, harness },
  });
  return { out, suites };
}

const commits = async (wt) => (await must('git', ['-C', wt, 'log', '--oneline', 'origin/main..HEAD'])).trim().split('\n').filter(Boolean);

test('a green build is committed locally and sent back, once', async () => {
  const f = await fixture();
  const h = fakeHarness(writeFeature);
  const { out } = await build(f, { harness: h });
  assert.equal(out.ok, true);
  assert.equal(h.calls.length, 1);
  assert.match(out.patch, /feature1\.py/);
  assert.equal((await commits(f.wt.path)).length, 1);
});

test('failing tests go back to the agent as a short fix round, then it is green', async () => {
  const f = await fixture();
  const h = fakeHarness(writeFeature);
  const { out, suites } = await build(f, { redRuns: 1, harness: h });
  assert.equal(out.ok, true);
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1], /tests fail/i);
  assert.match(h.calls[1], /FAILED test_a/);
  assert.doesNotMatch(h.calls[1], /ACCEPTANCE CRITERIA/); // only the failures, not the whole story again
  assert.equal(suites.runs, 2);
});

test('tests that stay red are never published: nothing is committed and the work is kept', async () => {
  const f = await fixture();
  const h = fakeHarness(writeFeature);
  const { out } = await build(f, { redRuns: 99, harness: h });
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'tests_failing');
  assert.equal(h.calls.length, 1 + MAX_FIX_ROUNDS);
  assert.match(out.error, /Nothing was published/);
  assert.match(out.error, new RegExp(f.wt.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal((await commits(f.wt.path)).length, 0);
  assert.match(await readFile(join(f.wt.path, 'feature1.py'), 'utf8'), /x = 1/); // still there to continue from
});

test('continuing with passing tests does not call the coding agent at all', async () => {
  const f = await fixture();
  await build(f, { harness: fakeHarness(writeFeature) });
  const again = await taskWorktree(f.clone, 'karkhana/iss-1-def', 'main', 'iss-1');
  assert.equal(again.resumed, true);
  const h = fakeHarness(writeFeature);
  const { out } = await build({ ...f, wt: again }, { resumed: true, harness: h });
  assert.equal(h.calls.length, 0);
  assert.equal(out.ok, true);
  assert.equal(out.agentCalls, 0);
  assert.match(out.patch, /feature1\.py/); // the earlier commit still counts
});

test('continuing with failing tests tells the agent what exists and what failed, not the whole story', async () => {
  const f = await fixture();
  await build(f, { redRuns: 99, harness: fakeHarness(writeFeature) });
  const h = fakeHarness(async (wt) => writeFile(join(wt, 'fix.py'), 'y = 1\n'));
  const { out } = await build({ ...f, wt: { path: f.wt.path, resumed: true } }, { resumed: true, redRuns: 1, harness: h });
  assert.equal(out.ok, true);
  assert.match(h.calls[0], /THIS IS A CONTINUATION/);
  assert.match(h.calls[0], /feature1\.py/);
  assert.match(h.calls[0], /FAILED test_a/);
  assert.match(h.calls[0], /Do NOT start over/);
});

test('an agent failure is reported plainly and the work is kept', async () => {
  const f = await fixture();
  const broke = async () => {
    throw new HarnessError('credits', 'Claude Code has no credits left.');
  };
  const { out } = await build(f, { harness: broke });
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'credits');
  assert.match(out.error, /no credits/);
});

test('Stop from the developer ends the run without another agent call', async () => {
  const f = await fixture();
  const stop = new AbortController();
  const h = fakeHarness(async () => stop.abort());
  const { out } = await build(f, { redRuns: 99, harness: h, signal: stop.signal });
  assert.equal(out.kind, 'cancelled');
  assert.equal(h.calls.length, 1);
});

test('what went wrong with the agent is named, with what to do', () => {
  const k = (text, extra = {}) => classifyFailure({ text, harness: 'Claude Code', ...extra }).kind;
  assert.equal(k('Error: credit balance is too low'), 'credits');
  assert.equal(k('402 payment required'), 'credits');
  assert.equal(k('Invalid API key · Please run /login'), 'auth');
  assert.equal(k('HTTP 429 too many requests'), 'rate_limit');
  assert.equal(k('error_max_turns'), 'max_turns');
  assert.equal(k('error_max_budget_usd'), 'max_cost');
  assert.equal(k('anything', { timedOut: true }), 'timeout');
  assert.equal(k('anything', { aborted: true }), 'cancelled');
  assert.equal(k('segfault'), 'other');
  assert.match(classifyFailure({ text: 'max_turns', harness: 'Bob', limits: { maxTurns: 60, maxCost: 3 } }).message, /60 turns/);
});

test('agents and tests may not touch the system Python', () => {
  assert.equal(harnessEnv({ PATH: '/bin' }).PIP_REQUIRE_VIRTUALENV, 'true');
});

test('the developer picks the folder: reused when it is the repository, refused when it is something else', async () => {
  const f = await fixture();
  assert.equal(await ensureCloneAt(f.clone, f.origin, 'main'), f.clone); // reuse
  const other = await fixture();
  await assert.rejects(ensureCloneAt(f.clone, other.origin, 'main'), /not .*origin\.git|checkout of/);
  const busy = await tmp();
  await writeFile(join(busy, 'notes.txt'), 'x');
  await assert.rejects(ensureCloneAt(busy, f.origin, 'main'), /not empty/);
  const fresh = join(await tmp(), 'new', 'place');
  await ensureCloneAt(fresh, f.origin, 'main');
  assert.equal((await run('git', ['-C', fresh, 'rev-parse', '--is-inside-work-tree'])).stdout.trim(), 'true');
  assert.match(expandPath('~/x'), /\/x$/);
  assert.equal(repoSlug('git@github.com:Acme/App.git'), 'acme/app');
  assert.equal(repoSlug('https://github.com/Acme/App'), 'acme/app');
});

test('the tool a suite starts picks its sandbox image, even in a repo that also has package.json', async () => {
  const { sandboxImage, toolOf } = await import('../src/testrun.js');
  const d = await tmp();
  await writeFile(join(d, 'package.json'), '{}');
  assert.match(await sandboxImage(d, ['python3', '-m', 'pytest', '-q']), /astral-sh\/uv/);
  assert.match(await sandboxImage(d, ['uv', 'run', 'pytest']), /astral-sh\/uv/);
  assert.equal(await sandboxImage(d, ['npm', 'test']), 'node:22-slim');
  assert.equal(await sandboxImage(d, ['sh', '-c', 'cmake -B build && ctest']), null); // no safe guess: the developer names one
  await mkdir(join(d, '.karkhana'));
  await writeFile(join(d, '.karkhana', 'agent.json'), JSON.stringify({ image: 'my/cpp:1' }));
  assert.equal(await sandboxImage(d, ['cmake']), 'my/cpp:1'); // the repository's own choice wins
  assert.equal(toolOf(['sh', '-c', 'cmake -S . -B build && ctest']), 'cmake');
  assert.equal(toolOf(['/usr/bin/python3', '-m', 'pytest']), 'python3');
});

test('missing test tooling is found before the coding agent is paid for', async () => {
  const { preflightSuites } = await import('../src/testrun.js');
  const d = await tmp();
  const problem = await preflightSuites(d, [{ name: 'unit', argv: ['definitely-not-a-real-tool-xyz', 'test'] }], 'none');
  assert.match(problem, /not installed on this machine/);
  assert.equal(await preflightSuites(d, [{ name: 'unit', argv: ['node', '-v'] }], 'none'), null);

  const f = await fixture();
  const h = fakeHarness(writeFeature);
  const out = await buildTask({
    spec, worktree: f.wt.path, baseBranch: 'main', resumed: false, sandbox: 'docker', log: quiet, report: async () => {},
    commitMessage: 'x', deps: { ...realGit, ...fakeSuites(0), preflight: async () => 'The sandbox image node:22-slim has no `python3`.', harness: h },
  });
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'sandbox');
  assert.match(out.error, /Nothing was started/);
  assert.equal(h.calls.length, 0); // not a single credit spent
});

test('a suite that cannot start is never sent to the agent as a failing test', async () => {
  const f = await fixture();
  const h = fakeHarness(writeFeature);
  const suites = {
    testSuites: async () => [{ name: 'unit', argv: ['x'] }],
    runSuites: async () => ({
      code: 127, output: 'no python3', label: 'docker node:22-slim: python3 -m pytest',
      suites: [{ suite: 'unit', status: 'error', infra: true, note: 'The sandbox image node:22-slim has no `python3`.', command: 'x' }],
    }),
  };
  const out = await buildTask({
    spec, worktree: f.wt.path, baseBranch: 'main', resumed: false, sandbox: 'docker', log: quiet, report: async () => {},
    commitMessage: 'x', deps: { ...realGit, ...suites, harness: h },
  });
  assert.equal(out.kind, 'sandbox');
  assert.equal(h.calls.length, 1); // it coded once; the fix rounds were not wasted on an environment problem
  assert.match(out.error, /could not run/);
});
