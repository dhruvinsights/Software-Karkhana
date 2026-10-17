// The repository decides how it is tested, never the server:
//   .karkhana/agent.json  {"test": ["uv", "run", "pytest", "-q"]}
//   or, one command per suite, run and reported separately:
//   .karkhana/agent.json  {"tests": {"unit": [...], "integration": [...]}}
// Without that file: a uv project runs `uv run pytest -q`, an npm project with a
// test script runs `npm test`, anything else `python3 -m pytest -q`; a pytest repo
// with tests/unit and tests/integration runs each folder as its own suite.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './proc.js';

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function present(path) {
  return (await readFile(path, 'utf8').catch(() => null)) !== null;
}

const isArgv = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string');
const SUITE_NAME = /^[a-z0-9_-]{1,40}$/;

async function isDir(path) {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

export async function testCommand(worktree) {
  const declared = (await readJson(join(worktree, '.karkhana', 'agent.json')))?.test;
  if (isArgv(declared)) return declared;
  if (await present(join(worktree, 'uv.lock'))) return ['uv', 'run', 'pytest', '-q'];
  if ((await readJson(join(worktree, 'package.json')))?.scripts?.test) return ['npm', 'test', '--silent'];
  return ['python3', '-m', 'pytest', '-q'];
}

/** The container image tests run in: the repository's choice, else one per stack. */
export async function sandboxImage(worktree) {
  const declared = (await readJson(join(worktree, '.karkhana', 'agent.json')))?.image;
  if (typeof declared === 'string' && declared) return declared;
  if (await present(join(worktree, 'uv.lock'))) return 'ghcr.io/astral-sh/uv:python3.12-bookworm-slim';
  if (await present(join(worktree, 'package.json'))) return 'node:22-slim';
  return 'python:3.12-slim';
}

/**
 * The docker argv that runs `argv` sandboxed: only the worktree is mounted,
 * the root filesystem is read-only, the process runs as this user (not root),
 * with CPU, memory and process limits. Network stays on so dependencies install.
 */
export function dockerArgs(worktree, image, argv) {
  const user = typeof process.getuid === 'function' ? [`--user`, `${process.getuid()}:${process.getgid()}`] : [];
  return [
    'run', '--rm', '--read-only', '--tmpfs', '/tmp:rw,exec,size=1g',
    '--cpus', '2', '--memory', '2g', '--pids-limit', '512', '--security-opt', 'no-new-privileges',
    ...user,
    '-e', 'HOME=/tmp', '-e', 'UV_CACHE_DIR=/tmp/uv-cache', '-e', 'UV_PROJECT_ENVIRONMENT=/tmp/venv',
    '-v', `${worktree}:/work`, '-w', '/work',
    image, ...argv,
  ];
}

/**
 * Runs the tests; the exit code reported to Karkhana comes from here, not from the agent.
 * With sandbox "docker" the repository's code runs in a container (see dockerArgs).
 */
export async function runTests(worktree, argv, sandbox = 'none') {
  if (sandbox === 'docker') {
    const image = await sandboxImage(worktree);
    const out = await run('docker', dockerArgs(worktree, image, argv), { cwd: worktree, timeoutMs: 20 * 60_000 });
    return { code: out.code, output: `${out.stdout}${out.stderr}`.slice(-20_000), label: `docker ${image}: ${argv.join(' ')}` };
  }
  const out = await run(argv[0], argv.slice(1), { cwd: worktree, timeoutMs: 20 * 60_000 });
  return { code: out.code, output: `${out.stdout}${out.stderr}`.slice(-20_000), label: argv.join(' ') };
}

/** The suites to run, in order: [{ name, argv }]. */
export async function testSuites(worktree) {
  const config = await readJson(join(worktree, '.karkhana', 'agent.json'));
  const declared = config?.tests;
  if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
    const suites = Object.entries(declared)
      .filter(([name, argv]) => SUITE_NAME.test(name) && isArgv(argv))
      .map(([name, argv]) => ({ name, argv }));
    if (suites.length) return suites;
  }
  const base = await testCommand(worktree);
  if (!config?.test && base.some((a) => a.includes('pytest'))) {
    const folders = [];
    for (const name of ['unit', 'integration']) if (await isDir(join(worktree, 'tests', name))) folders.push(name);
    if (folders.length) return folders.map((name) => ({ name, argv: [...base, `tests/${name}`] }));
  }
  return [{ name: 'tests', argv: base }];
}

/** Passed/failed/skipped/total from the last pytest or Jest summary line. */
export function parseCounts(output) {
  const tail = output.slice(-4000);
  const jest = [...tail.matchAll(/Tests:\s+(?:(\d+) failed, )?(?:(\d+) skipped, )?(?:(\d+) passed, )?(\d+) total/g)].pop();
  if (jest) {
    const [failed, skipped, passed, total] = jest.slice(1).map((x) => Number(x ?? 0));
    return { passed, failed, skipped, total };
  }
  const line = tail.split('\n').filter((l) => /\d+ (passed|failed|skipped|errors?)/.test(l)).pop();
  if (!line) return {};
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const [, n, word] of line.matchAll(/(\d+) (passed|failed|skipped|errors?|xfailed|xpassed)/g)) {
    if (word === 'passed' || word === 'xpassed') counts.passed += Number(n);
    else if (word === 'failed' || word.startsWith('error')) counts.failed += Number(n);
    else counts.skipped += Number(n);
  }
  counts.total = counts.passed + counts.failed + counts.skipped;
  return counts;
}

/**
 * Runs every suite in order and reports each as it starts and ends (`report`
 * may be null). The exit code is the first failing suite's, else 0.
 */
export async function runSuites(worktree, suites, sandbox = 'none', report = null) {
  if (sandbox === 'docker') await assertDockerSeesWorktree(worktree);
  // A lost progress report never stops the tests.
  const tell = async (suite) => {
    try {
      await report?.(suite);
    } catch {
      /* the final result carries every suite anyway */
    }
  };
  const results = [];
  let code = 0;
  const outputs = [];
  for (const { name, argv } of suites) {
    await tell({ suite: name, status: 'running', command: argv.join(' ').slice(0, 500) });
    const started = Date.now();
    const out = await runTests(worktree, argv, sandbox);
    const result = {
      suite: name,
      status: out.code === 0 ? 'passed' : 'failed',
      command: out.label.slice(0, 500),
      duration_ms: Date.now() - started,
      output: out.output.slice(-4000),
      ...parseCounts(out.output),
    };
    results.push(result);
    outputs.push(`== ${name}: ${out.label} (exit ${out.code})\n${out.output}`);
    if (out.code !== 0 && code === 0) code = out.code;
    await tell(result);
  }
  return {
    code,
    output: outputs.join('\n').slice(-20_000),
    label: results.map((r) => r.command).join(' && '),
    suites: results,
  };
}

/**
 * Docker Desktop mounts only shared folders; anything else shows up empty and
 * every test "fails" for a reason that has nothing to do with the code. Fail
 * early with the fix instead.
 */
export async function assertDockerSeesWorktree(worktree) {
  const image = await sandboxImage(worktree);
  const out = await run('docker', ['run', '--rm', '-v', `${worktree}:/work`, image, 'ls', '-A', '/work'], {
    cwd: worktree,
    timeoutMs: 10 * 60_000,
  });
  if (out.code !== 0) throw new Error(`docker could not start the test sandbox: ${(out.stderr || out.stdout).trim().slice(-300)}`);
  if (!out.stdout.trim()) {
    throw new Error(
      `Docker cannot see ${worktree} (it is not a shared folder). Use --dir under your home folder, ` +
        'add the folder in Docker Desktop → Settings → Resources → File sharing, or run with --sandbox none.',
    );
  }
}
