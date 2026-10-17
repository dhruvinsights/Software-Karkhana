// The repository decides how it is tested, never the server:
//   .karkhana/agent.json  {"test": ["uv", "run", "pytest", "-q"]}
//   or, one command per suite, run and reported separately:
//   .karkhana/agent.json  {"tests": {"unit": [...], "integration": [...]}}
// Without that file: a uv project runs `uv run pytest -q`, an npm project with a
// test script runs `npm test`, anything else `python3 -m pytest -q`; a pytest repo
// with tests/unit and tests/integration runs each folder as its own suite.
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { has, run } from './proc.js';

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
  // Python without uv.lock: uv supplies pytest (and the declared requirements) in a throwaway environment.
  for (const req of ['requirements.txt', 'backend/requirements.txt', 'server/requirements.txt']) {
    if (await present(join(worktree, req))) return ['uv', 'run', '--with', 'pytest', '--with-requirements', req, 'python', '-m', 'pytest', '-q'];
  }
  if (await present(join(worktree, 'pyproject.toml'))) return ['uv', 'run', '--with', 'pytest', 'python', '-m', 'pytest', '-q'];
  return ['python3', '-m', 'pytest', '-q'];
}

const UV_IMAGE = 'ghcr.io/astral-sh/uv:python3.12-bookworm-slim';
// The tool a suite starts decides its image: a repo with package.json can still have Python tests.
const IMAGE_FOR_TOOL = {
  uv: UV_IMAGE, uvx: UV_IMAGE, python: UV_IMAGE, python3: UV_IMAGE, pytest: UV_IMAGE, pip: UV_IMAGE,
  npm: 'node:22-slim', npx: 'node:22-slim', node: 'node:22-slim', yarn: 'node:22-slim', pnpm: 'node:22-slim',
  go: 'golang:1.23', cargo: 'rust:1.82-slim', mvn: 'maven:3-eclipse-temurin-21',
};

/** The program a test command starts, looking inside `sh -c "…"`. */
export function toolOf(argv) {
  const first = basename(argv[0] ?? '');
  if (first === 'sh' || first === 'bash') {
    const cmd = argv[argv.indexOf('-c') + 1] ?? '';
    return basename(cmd.trim().split(/\s+/)[0] ?? '');
  }
  return first;
}

/**
 * The container image for a suite: the repository's choice (.karkhana/agent.json "image"),
 * else the image for the tool the command starts. ``null`` when nothing is known
 * for the tool (cmake, make, …): the developer names an image or runs without a sandbox.
 */
export async function sandboxImage(worktree, argv = []) {
  const declared = (await readJson(join(worktree, '.karkhana', 'agent.json')))?.image;
  if (typeof declared === 'string' && declared) return declared;
  const tool = toolOf(argv);
  if (IMAGE_FOR_TOOL[tool]) return IMAGE_FOR_TOOL[tool];
  if (['cmake', 'ctest', 'make', 'gcc', 'g++', 'cc', 'clang'].includes(tool)) return null;
  if (await present(join(worktree, 'uv.lock'))) return UV_IMAGE;
  if (await present(join(worktree, 'package.json'))) return 'node:22-slim';
  return 'python:3.12-slim';
}

const toolChecks = new Map();
/** Whether ``tool`` exists in ``image`` (checked once per image and tool). */
async function toolInImage(image, tool) {
  const key = `${image}::${tool}`;
  if (!toolChecks.has(key)) {
    const out = await run('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c', 'command -v "$0"', tool], { timeoutMs: 10 * 60_000 });
    toolChecks.set(key, out.code === 0);
  }
  return toolChecks.get(key);
}

const SANDBOX_HELP = 'Name an image that has it in .karkhana/agent.json ("image"), or run the agent with --sandbox none.';

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

/** A suite that could not run at all: the test environment's fault, not the code's. */
function noEnv(argv, note, image, out) {
  return {
    code: 127,
    infra: true,
    note,
    output: `${note}\n${out ? `${out.stdout}${out.stderr}`.slice(-2000) : ''}`.trim(),
    label: `${image ? `docker ${image}: ` : ''}${argv.join(' ')}`,
  };
}

/**
 * Runs the tests; the exit code reported to Karkhana comes from here, not from the agent.
 * With sandbox "docker" the repository's code runs in a container (see dockerArgs).
 */
export async function runTests(worktree, argv, sandbox = 'none') {
  const tool = toolOf(argv);
  if (sandbox === 'docker') {
    const image = await sandboxImage(worktree, argv);
    if (!image) return noEnv(argv, `There is no sandbox image for \`${tool}\`. ${SANDBOX_HELP}`);
    if (!(await toolInImage(image, tool))) return noEnv(argv, `The sandbox image ${image} has no \`${tool}\`. ${SANDBOX_HELP}`, image);
    const out = await run('docker', dockerArgs(worktree, image, argv), { cwd: worktree, timeoutMs: 20 * 60_000 });
    const label = `docker ${image}: ${argv.join(' ')}`;
    if (out.code === 126 || out.code === 127) return noEnv(argv, `\`${tool}\` could not start in ${image} (exit ${out.code}). ${SANDBOX_HELP}`, image, out);
    return { code: out.code, output: `${out.stdout}${out.stderr}`.slice(-20_000), label };
  }
  try {
    const out = await run(argv[0], argv.slice(1), { cwd: worktree, timeoutMs: 20 * 60_000 });
    return { code: out.code, output: `${out.stdout}${out.stderr}`.slice(-20_000), label: argv.join(' ') };
  } catch (err) {
    return noEnv(argv, `${err.message}. Install it, or fix the test command in .karkhana/agent.json.`);
  }
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

/** Passed/failed/skipped/total from the last pytest, Jest or CTest summary line. */
export function parseCounts(output) {
  const tail = output.slice(-4000);
  const ctest = [...tail.matchAll(/(\d+)% tests passed, (\d+) tests? failed out of (\d+)/g)].pop();
  if (ctest) {
    const failed = Number(ctest[2]);
    const total = Number(ctest[3]);
    return { passed: total - failed, failed, skipped: 0, total };
  }
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
export async function runSuites(worktree, suites, sandbox = 'none', report = null, hooks = {}) {
  if (sandbox === 'docker') await assertDockerSeesWorktree(worktree, suites[0]?.argv);
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
    // The developer may skip a suite (hooks.before returns 'skip'); it is recorded as skipped, never as passed.
    if ((await hooks.before?.({ name, argv })) === 'skip') {
      const skipped = { suite: name, status: 'skipped', note: 'Skipped by the developer', command: argv.join(' ').slice(0, 500) };
      results.push(skipped);
      outputs.push(`== ${name}: skipped by the developer`);
      await tell(skipped);
      continue;
    }
    await tell({ suite: name, status: 'running', command: argv.join(' ').slice(0, 500) });
    const started = Date.now();
    const out = await runTests(worktree, argv, sandbox);
    const result = {
      suite: name,
      // 'error' = the suite could not run (no tool in the sandbox); 'failed' = it ran and tests failed.
      status: out.code === 0 ? 'passed' : out.infra ? 'error' : 'failed',
      ...(out.infra ? { infra: true, note: out.note } : {}),
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
export async function assertDockerSeesWorktree(worktree, argv = []) {
  const image = (await sandboxImage(worktree, argv)) ?? 'busybox';
  const out = await run('docker', ['run', '--rm', '--entrypoint', 'ls', '-v', `${worktree}:/work`, image, '-A', '/work'], {
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


/**
 * Can these suites run here at all? Checked before the coding agent is paid for:
 * a missing tool in the sandbox is found now, not after a $4 build.
 * @returns {Promise<string|null>} what is wrong, or null
 */
export async function preflightSuites(worktree, suites, sandbox = 'none') {
  if (sandbox === 'docker') {
    try {
      await assertDockerSeesWorktree(worktree, suites[0]?.argv);
    } catch (err) {
      return err.message;
    }
  }
  for (const { name, argv } of suites) {
    const tool = toolOf(argv);
    if (sandbox === 'docker') {
      const image = await sandboxImage(worktree, argv);
      if (!image) return `The ${name} tests start \`${tool}\`, and there is no sandbox image for it. ${SANDBOX_HELP}`;
      if (!(await toolInImage(image, tool))) return `The ${name} tests start \`${tool}\`, which the sandbox image ${image} does not have. ${SANDBOX_HELP}`;
    } else if (!(await has(tool))) {
      return `The ${name} tests start \`${tool}\`, which is not installed on this machine. Install it or change the test command in .karkhana/agent.json.`;
    }
  }
  return null;
}
