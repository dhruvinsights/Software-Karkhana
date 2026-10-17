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
