import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTask } from '../src/build.js';
import { commit, ensureCloneAt, stagedDiff, taskWorktree, workState } from '../src/git.js';
import { must } from '../src/proc.js';

// The developer's global git hooks (secret scanners and the like) make every commit
// slow; these tests exercise git itself, so they run with a clean git configuration.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

export const tmp = () => mkdtemp(join(tmpdir(), 'kb-'));
export const GIT = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

/** A bare origin with one commit on main, a clone of it and a fresh task worktree. */
export async function fixture() {
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

export const spec = {
  project_name: 'App', task_key: 'ISS-1', task_title: 'Add thing', task_description: '',
  acceptance_criteria: ['It works'], context: [],
};
export const realGit = { workState, stagedDiff, commit };
export const quiet = () => {};

/** Suites that are red for the first ``redRuns`` runs, then green. */
export function fakeSuites(redRuns) {
  let runs = 0;
  return {
    testSuites: async () => [{ name: 'unit', argv: ['x'] }],
    runSuites: async (_wt, ss, _sb, report, hooks = {}) => {
      if ((await hooks.before?.(ss[0])) === 'skip') {
        const skip = { suite: 'unit', status: 'skipped', note: 'Skipped by the developer', command: 'pytest tests/unit' };
        await report?.(skip);
        return { code: 0, output: '', label: 'pytest', suites: [skip] };
      }
      runs += 1;
      const red = runs <= redRuns;
      const suite = { suite: 'unit', status: red ? 'failed' : 'passed', passed: red ? 2 : 3, failed: red ? 1 : 0, total: 3, command: 'pytest tests/unit', output: red ? 'FAILED test_a - assert 1 == 2' : '3 passed' };
      await report?.(suite);
      return { code: red ? 1 : 0, output: suite.output, label: 'pytest', suites: [suite] };
    },
    get runs() { return runs; },
  };
}

export function fakeHarness(write) {
  const calls = [];
  const fn = async (prompt, worktree) => {
    calls.push(prompt);
    await write?.(worktree, calls.length);
    return { summary: `call ${calls.length}`, cost: 0.1, turns: 3 };
  };
  fn.calls = calls;
  return fn;
}

export const writeFeature = (wt, n) => writeFile(join(wt, `feature${n}.py`), `x = ${n}\n`);

export async function build(f, { redRuns = 0, harness, resumed = false, signal } = {}) {
  const suites = fakeSuites(redRuns);
  const out = await buildTask({
    spec, worktree: f.wt.path, baseBranch: 'main', resumed, sandbox: 'none', log: quiet, report: async () => {}, signal,
    commitMessage: 'ISS-1: Add thing', deps: { ...realGit, ...suites, harness },
  });
  return { out, suites };
}

export const commits = async (wt) => (await must('git', ['-C', wt, 'log', '--oneline', 'origin/main..HEAD'])).trim().split('\n').filter(Boolean);

