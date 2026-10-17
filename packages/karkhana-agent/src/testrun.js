// The repository decides how it is tested, never the server:
//   .karkhana/agent.json  {"test": ["uv", "run", "pytest", "-q"]}
// Without that file: a uv project runs `uv run pytest -q`, an npm project with a
// test script runs `npm test`, anything else `python3 -m pytest -q`.
import { readFile } from 'node:fs/promises';
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

export async function testCommand(worktree) {
  const declared = (await readJson(join(worktree, '.karkhana', 'agent.json')))?.test;
  if (Array.isArray(declared) && declared.length && declared.every((a) => typeof a === 'string')) return declared;
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
