import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTask } from '../src/build.js';
import { makeGate } from '../src/gate.js';
import { buildPrompt, continuePrompt } from '../src/prompts.js';
import { commits, fakeHarness, fakeSuites, fixture, quiet, realGit, spec, writeFeature } from './helpers.js';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

/** A pause that answers from a script and records what it was asked. */
function scripted(answers) {
  const asked = [];
  const queue = [...answers];
  const pause = async (key, summary, options, name = key) => {
    asked.push({ key, name, summary, options: options.map((o) => o.id) });
    return queue.shift() ?? { action: 'go', note: '' };
  };
  pause.asked = asked;
  return pause;
}

async function run(f, { pause, redRuns = 0, harness, resumed = false, specExtra = {}, logs = [] } = {}) {
  const suites = fakeSuites(redRuns);
  const out = await buildTask({
    spec: { ...spec, ...specExtra }, worktree: f.wt.path, baseBranch: 'main', resumed, sandbox: 'none',
    log: (l, m) => logs.push(m), report: async () => {}, commitMessage: 'ISS-1: Add thing',
    deps: { ...realGit, ...suites, harness, pause },
  });
  return { out, suites, logs };
}

test('with every pause on, the build asks after the code and before each suite, and nowhere else when green', async () => {
  const f = await fixture();
  const pause = scripted([]);
  const { out } = await run(f, { pause, harness: fakeHarness(writeFeature) });
  assert.equal(out.ok, true);
  assert.deepEqual(pause.asked.map((a) => a.name), ['after_code', 'before_tests:unit']);
  assert.deepEqual(pause.asked[0].options, ['go', 'change']);
  assert.match(pause.asked[0].summary, /1 file\(s\) changed/);
});

test('asking for a change after the code sends only that change to the agent, then the tests run', async () => {
  const f = await fixture();
  const h = fakeHarness(writeFeature);
  const { out, suites } = await run(f, { pause: scripted([{ action: 'change', note: 'Return 404, not 500.' }, { action: 'go' }]), harness: h });
  assert.equal(out.ok, true);
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1], /asks for this/);
  assert.match(h.calls[1], /Return 404, not 500\./);
  assert.doesNotMatch(h.calls[1], /ACCEPTANCE CRITERIA/);
  assert.equal(suites.runs, 1);
});

test('skipping a suite is recorded as skipped and told to the reviewer, never as passed', async () => {
  const f = await fixture();
  const { out } = await run(f, { pause: scripted([{ action: 'go' }, { action: 'skip' }]), harness: fakeHarness(writeFeature) });
  assert.equal(out.ok, true);
  assert.deepEqual(out.skipped, ['unit']);
  assert.equal(out.suites[0].status, 'skipped');
  assert.match(out.summary, /Tests skipped by the developer: unit/);
});

test('stopping at a pause ends the build with the work kept and nothing committed', async () => {
  const f = await fixture();
  const { out, suites } = await run(f, { pause: scripted([{ action: 'stop' }]), harness: fakeHarness(writeFeature) });
  assert.equal(out.kind, 'cancelled');
  assert.match(out.error, /after the code was written/);
  assert.equal(suites.runs, 0);
  assert.equal((await commits(f.wt.path)).length, 0);
});

test('before a failing test is sent back, the developer can say how to fix it', async () => {
  const f = await fixture();
  const h = fakeHarness(writeFeature);
  const pause = scripted([{ action: 'go' }, { action: 'go' }, { action: 'change', note: 'The bug is in the rounding.' }]);
  const { out } = await run(f, { pause, redRuns: 1, harness: h });
  assert.equal(out.ok, true);
  assert.ok(pause.asked.some((a) => a.key === 'fix'));
  assert.match(h.calls[1], /THE DEVELOPER SAYS HOW TO FIX IT/);
  assert.match(h.calls[1], /rounding/);
  // Stopping at the fix pause keeps the red build local.
  const g = await fixture();
  const stop = scripted([{ action: 'go' }, { action: 'go' }, { action: 'stop' }]);
  const res = await run(g, { pause: stop, redRuns: 99, harness: fakeHarness(writeFeature) });
  assert.equal(res.out.kind, 'cancelled');
  assert.equal((await commits(g.wt.path)).length, 0);
});

test('an instruction or a reviewer\'s requested change always gets an agent call, even when the tests already pass', async () => {
  const f = await fixture();
  await run(f, { harness: fakeHarness(writeFeature) });
  const again = { ...f, wt: { path: f.wt.path, resumed: true } };
  const h = fakeHarness(async (wt) => writeFeature(wt, 2));
  const { out } = await run(again, { resumed: true, harness: h, specExtra: { rework: 'Handle the empty list.', brief: { instruction: 'Keep it in one file.', focus: ['app/'] } } });
  assert.equal(out.agentCalls, 1);
  assert.match(h.calls[0], /CHANGES REQUESTED ON THE PREVIOUS PULL REQUEST/);
  assert.match(h.calls[0], /Handle the empty list\./);
  assert.match(h.calls[0], /INSTRUCTION FROM THE DEVELOPER/);
  assert.match(h.calls[0], /- app\//);
  // Without either, green tests mean no call.
  const quietOne = fakeHarness(writeFeature);
  const res = await run(again, { resumed: true, harness: quietOne });
  assert.equal(res.out.agentCalls, 0);
});

test('the exact prompt is written to the run log, with its size', async () => {
  const f = await fixture();
  const logs = [];
  await run(f, { harness: fakeHarness(writeFeature), logs, specExtra: { brief: { focus: ['src/store.cpp'] } } });
  const line = logs.find((m) => m.startsWith('PROMPT SENT'));
  assert.match(line, /\d+ chars, about \d+ tokens/);
  assert.match(line, /STORY ISS-1: Add thing/);
  assert.match(line, /src\/store\.cpp/);
});

test('prompts carry what the developer chose and the environment rules', () => {
  const p = buildPrompt({ ...spec, brief: { instruction: 'Use Decimal.', focus: ['a.py'] }, rework: null });
  assert.match(p, /Use Decimal\./);
  assert.match(p, /never run pip against the system Python/i);
  const c = continuePrompt({ ...spec, brief: {} }, { files: ['A\tx.py'], more: 0, summary: '1 file changed' }, []);
  assert.match(c, /THIS IS A CONTINUATION/);
});

test('the gate asks only where the developer chose to pause, and waits for the answer', async () => {
  const calls = [];
  const state = [{ status: 'running', gate: { decision: null } }, { status: 'running', gate: { decision: { action: 'change', note: 'x' } } }];
  const runApi = {
    gate: async (g) => calls.push(g.clear ? 'clear' : g.name),
    gateState: async () => state.shift() ?? { status: 'running', gate: null },
  };
  const pause = makeGate({ runApi, control: { pauses: ['after_code'] }, log: quiet, pollMs: 1 });
  assert.deepEqual(await pause('before_tests', 's', []), { action: 'go', note: '' }); // not a chosen pause
  assert.deepEqual(calls, []);
  assert.deepEqual(await pause('after_code', 'wrote 3 files', [{ id: 'go', label: 'Go' }]), { action: 'change', note: 'x' });
  assert.deepEqual(calls, ['after_code', 'clear']);
});

test('a pause ends when the run is stopped from elsewhere or the agent is told to abort', async () => {
  const runApi = { gate: async () => {}, gateState: async () => ({ status: 'cancelled', gate: null }) };
  const p1 = makeGate({ runApi, control: { pauses: ['fix'] }, log: quiet, pollMs: 1 });
  assert.equal((await p1('fix', 's', [])).action, 'stop');
  const ctl = new AbortController();
  ctl.abort();
  const p2 = makeGate({ runApi: { gate: async () => {}, gateState: async () => ({ status: 'running', gate: null }) }, control: { pauses: ['fix'] }, signal: ctl.signal, log: quiet, pollMs: 1 });
  assert.equal((await p2('fix', 's', [])).action, 'stop');
});
