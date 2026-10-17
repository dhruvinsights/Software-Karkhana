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

/** Runs the tests; the exit code reported to Karkhana comes from here, not from the agent. */
export async function runTests(worktree, argv) {
  const out = await run(argv[0], argv.slice(1), { cwd: worktree, timeoutMs: 20 * 60_000 });
  return { code: out.code, output: `${out.stdout}${out.stderr}`.slice(-20_000) };
}
