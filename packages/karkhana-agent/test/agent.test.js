import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { has } from '../src/proc.js';
import { testCommand } from '../src/testrun.js';
import { buildPrompt } from '../src/work.js';

const dir = () => mkdtemp(join(tmpdir(), 'kagent-'));

test('the repository file decides the test command', async () => {
  const d = await dir();
  await mkdir(join(d, '.karkhana'));
  await writeFile(join(d, '.karkhana', 'agent.json'), JSON.stringify({ test: ['make', 'check'] }));
  assert.deepEqual(await testCommand(d), ['make', 'check']);
});

test('a string test command is ignored, never run through a shell', async () => {
  const d = await dir();
  await mkdir(join(d, '.karkhana'));
  await writeFile(join(d, '.karkhana', 'agent.json'), JSON.stringify({ test: 'rm -rf / && pytest' }));
  assert.deepEqual(await testCommand(d), ['python3', '-m', 'pytest', '-q']);
});

test('uv and npm projects are detected', async () => {
  const uv = await dir();
  await writeFile(join(uv, 'uv.lock'), '');
  assert.deepEqual(await testCommand(uv), ['uv', 'run', 'pytest', '-q']);
  const npm = await dir();
  await writeFile(join(npm, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
  assert.deepEqual(await testCommand(npm), ['npm', 'test', '--silent']);
});

test('the prompt carries the story, criteria and shared context', () => {
  const prompt = buildPrompt({
    project_name: 'Hisaab',
    task_key: 'KAR-1',
    task_title: 'Settle up',
    task_description: 'Delivers FR-1',
    acceptance_criteria: ['Given two members, one transfer'],
    context: [{ kind: 'handoff', title: 'Design v1', author: 'Asha', body: 'GET /groups/{id}/settle-up' }],
  });
  assert.match(prompt, /STORY KAR-1: Settle up/);
  assert.match(prompt, /- Given two members, one transfer/);
  assert.match(prompt, /\[handoff\] Design v1 \(Asha\): GET/);
});

test('has() finds executables on PATH without running them', async () => {
  assert.equal(await has('node'), true);
  assert.equal(await has('definitely-not-a-real-binary-xyz'), false);
});

test('the sandbox mounts only the worktree, read-only root, non-root, with limits', async () => {
  const { dockerArgs } = await import('../src/testrun.js');
  const args = dockerArgs('/w/iss-4', 'img:1', ['uv', 'run', 'pytest', '-q']);
  assert.deepEqual(args.slice(0, 3), ['run', '--rm', '--read-only']);
  assert.ok(args.includes('--memory') && args.includes('--pids-limit') && args.includes('no-new-privileges'));
  assert.equal(args.filter((a) => a === '-v').length, 1);
  assert.ok(args.includes('/w/iss-4:/work'));
  assert.deepEqual(args.slice(-5), ['img:1', 'uv', 'run', 'pytest', '-q']);
});

test('pytest repos with unit and integration folders run them as separate suites', async () => {
  const { testSuites } = await import('../src/testrun.js');
  const d = await mkdtemp(join(tmpdir(), 'ka-'));
  await writeFile(join(d, 'uv.lock'), '');
  await mkdir(join(d, 'tests', 'unit'), { recursive: true });
  await mkdir(join(d, 'tests', 'integration'), { recursive: true });
  assert.deepEqual(await testSuites(d), [
    { name: 'unit', argv: ['uv', 'run', 'pytest', '-q', 'tests/unit'] },
    { name: 'integration', argv: ['uv', 'run', 'pytest', '-q', 'tests/integration'] },
  ]);
});

test('declared suites win, and a single command is one suite', async () => {
  const { testSuites } = await import('../src/testrun.js');
  const d = await mkdtemp(join(tmpdir(), 'ka-'));
  await mkdir(join(d, '.karkhana'));
  await writeFile(join(d, '.karkhana', 'agent.json'), JSON.stringify({ tests: { unit: ['make', 'unit'], 'Bad Name': ['x'] } }));
  assert.deepEqual(await testSuites(d), [{ name: 'unit', argv: ['make', 'unit'] }]);
  const e = await mkdtemp(join(tmpdir(), 'ka-'));
  assert.deepEqual(await testSuites(e), [{ name: 'tests', argv: ['python3', '-m', 'pytest', '-q'] }]);
});

test('counts come from pytest and Jest summaries', async () => {
  const { parseCounts } = await import('../src/testrun.js');
  assert.deepEqual(parseCounts('== 1 failed, 4 passed, 2 skipped in 1s =='), { passed: 4, failed: 1, skipped: 2, total: 7 });
  assert.deepEqual(parseCounts('Tests:       2 failed, 10 passed, 12 total'), { passed: 10, failed: 2, skipped: 0, total: 12 });
  assert.deepEqual(parseCounts('boom'), {});
});

test('suites run in order and each is reported when it starts and ends', async () => {
  const { runSuites } = await import('../src/testrun.js');
  const d = await mkdtemp(join(tmpdir(), 'ka-'));
  const seen = [];
  const out = await runSuites(
    d,
    [
      { name: 'unit', argv: ['node', '-e', 'console.log("3 passed in 0.1s")'] },
      { name: 'integration', argv: ['node', '-e', 'console.log("1 failed, 1 passed"); process.exit(1)'] },
    ],
    'none',
    async (s) => {
      seen.push(`${s.suite}:${s.status}`);
      if (s.suite === 'integration' && s.status === 'running') throw new Error('network down');
    },
  );
  assert.deepEqual(seen, ['unit:running', 'unit:passed', 'integration:running', 'integration:failed']);
  assert.equal(out.code, 1);
  assert.equal(out.suites[0].passed, 3);
  assert.equal(out.suites[1].failed, 1);
});
