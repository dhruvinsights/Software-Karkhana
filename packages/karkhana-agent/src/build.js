// One story, start to finish, on the developer's machine, under the developer's control
// and without wasting credits:
//
//   continuing?  run the tests first; if they already pass the coding agent is not called
//                (unless the developer gave an instruction or a reviewer asked for changes)
//   code         one agent call with a hard turn and cost cap
//   [pause]      after_code: run the tests, or ask the agent for a change
//   test         every suite runs and is reported as it starts and ends
//   [pause]      before_tests: run this suite or skip it
//   [pause]      fix: send the failures back, or tell the agent how
//   fix          failing suites go back to the agent for up to two small rounds
//   done         only a green build is committed and sent back; a red one stops with the work kept
//
// A pause only happens where the developer asked for one. Nothing here opens a pull request.
import { Stopped } from './gate.js';
import { DEFAULT_LIMITS, FIX_LIMITS, HarnessError } from './harness.js';
import { buildPrompt, changePrompt, continuePrompt, fixPrompt, fixPromptWithNote } from './prompts.js';

export const MAX_FIX_ROUNDS = 2;

const failing = (r) => r.suites.filter((s) => s.status !== 'passed' && s.status !== 'skipped');
const names = (r) => failing(r).map((s) => `${s.suite}${s.total != null ? ` (${s.failed ?? 0} failed of ${s.total})` : ''}`).join(', ');
const PROMPT_LOG = 3400;

const AFTER_CODE = [
  { id: 'go', label: 'Run the tests' },
  { id: 'change', label: 'Ask the agent to change something', needs_note: true },
];
const BEFORE_SUITE = [
  { id: 'go', label: 'Run it' },
  { id: 'skip', label: 'Skip it' },
];
const FIX_GATE = [
  { id: 'go', label: 'Let the agent fix it' },
  { id: 'change', label: 'Tell it how to fix it', needs_note: true },
];

/**
 * @param {object} p
 * @param {object} p.spec          the story (task_key, task_title, acceptance_criteria, context, brief, rework…)
 * @param {string} p.worktree
 * @param {string} p.baseBranch
 * @param {boolean} p.resumed      the worktree already existed
 * @param {string} p.sandbox
 * @param {Function} p.log
 * @param {Function} p.report      sends each suite's state to the server
 * @param {AbortSignal} [p.signal]
 * @param {string} p.commitMessage
 * @param {object} p.deps          { harness, testSuites, runSuites, workState, stagedDiff, commit, preflight?, pause? }
 * @param {object} [p.caps]        { build, fix } turn and cost caps
 */
export async function buildTask({ spec, worktree, baseBranch, resumed, sandbox, log, report, signal, commitMessage, deps, caps = {} }) {
  const limits = { build: caps.build ?? DEFAULT_LIMITS, fix: caps.fix ?? FIX_LIMITS };
  const pause = deps.pause ?? (async () => ({ action: 'go', note: '' }));
  let cost = 0;
  let summary = '';
  let agentCalls = 0;
  let result = null;
  const skipped = [];
  const suites = await deps.testSuites(worktree);
  const outcome = (extra) => ({ cost, agentCalls, summary, result, suites: result?.suites ?? [], ...extra });
  const stopped = (where) => outcome({ ok: false, kind: 'cancelled', error: `Stopped by the developer at ${where}. The work so far is kept.` });

  // One agent call: the exact prompt is written to the run log so the developer can see what it was told.
  const ask = async (prompt, lim) => {
    log('info', `PROMPT SENT (${prompt.length} chars, about ${Math.round(prompt.length / 4)} tokens)\n${prompt.length > PROMPT_LOG ? `${prompt.slice(0, PROMPT_LOG)}\n… (${prompt.length - PROMPT_LOG} more characters)` : prompt}`);
    const r = await deps.harness(prompt, worktree, log, { limits: lim, signal });
    agentCalls += 1;
    cost += r.cost ?? 0;
    if (r.summary) summary = r.summary;
    return r;
  };
  const test = () =>
    deps.runSuites(worktree, suites, sandbox, report, {
      before: async (suite) => {
        const d = await pause('before_tests', `Next: the ${suite.name} tests (${suite.argv.join(' ')}).`, BEFORE_SUITE, `before_tests:${suite.name}`);
        if (d.action === 'stop') throw new Stopped(`the ${suite.name} tests`);
        if (d.action === 'skip') {
          skipped.push(suite.name);
          return 'skip';
        }
        return 'go';
      },
    });
  // A suite that cannot run is the test environment's problem: never something to pay the agent to fix.
  const envProblem = (r) => {
    const bad = r?.suites.find((s) => s.infra);
    return bad ? outcome({ ok: false, kind: 'sandbox', error: `The ${bad.suite} tests could not run: ${bad.note}` }) : null;
  };

  // Before anything costs money: can the tests run here at all?
  const blocked = await deps.preflight?.(worktree, suites, sandbox);
  if (blocked) return outcome({ ok: false, kind: 'sandbox', error: `Nothing was started. ${blocked}` });

  try {
    let state = null;
    let needAgent = true;
    // The developer's own words, or a reviewer's requested changes, always get an agent call.
    const instructed = !!spec.rework || !!spec.brief?.instruction?.trim();
    if (resumed) {
      state = await deps.workState(worktree, baseBranch);
      if (state.files.length === 0) {
        state = null; // an empty leftover worktree is a fresh start
      } else {
        log('info', `continuing: ${state.files.length}${state.more ? '+' : ''} file(s) already changed. Running the tests first; the coding agent is only called if something fails.`);
        result = await test();
        const stuck = envProblem(result);
        if (stuck) return stuck;
        if (result.code === 0 && !instructed) {
          needAgent = false;
          log('info', 'The tests already pass, so nothing is redone and no credits are spent.');
        }
      }
    }
    if (signal?.aborted) return stopped('the start');

    if (needAgent) {
      const prompt = state ? continuePrompt(spec, state, result ? failing(result) : []) : buildPrompt(spec);
      await ask(prompt, limits.build);

      // Pause 1: the code is written. Look at it, ask for changes, then run the tests.
      for (;;) {
        const ws = await deps.workState(worktree, baseBranch);
        const files = ws.files.slice(0, 8).map((l) => `  ${l}`).join('\n');
        const d = await pause(
          'after_code',
          `The agent finished${cost ? ` ($${cost.toFixed(2)} so far)` : ''}. ${ws.files.length}${ws.more ? '+' : ''} file(s) changed:\n${files}${ws.more || ws.files.length > 8 ? '\n  …' : ''}\nNext: run the tests.`,
          AFTER_CODE,
        );
        if (d.action === 'stop') return stopped('after the code was written');
        if (d.action !== 'change') break;
        await ask(changePrompt(spec, d.note), limits.fix);
      }

      result = await test();
      const stuck = envProblem(result);
      if (stuck) return stuck;
      for (let round = 1; round <= MAX_FIX_ROUNDS && result.code !== 0; round += 1) {
        if (signal?.aborted) return stopped('a fix round');
        const d = await pause('fix', `Tests failing: ${names(result)}.\nThe agent can be sent only the failures (round ${round} of ${MAX_FIX_ROUNDS}).`, FIX_GATE);
        if (d.action === 'stop') return stopped('the failing tests');
        log('info', `Tests failing: ${names(result)}. Sending only the failures back to the agent (round ${round} of ${MAX_FIX_ROUNDS}).`);
        await ask(d.action === 'change' ? fixPromptWithNote(spec, failing(result), d.note) : fixPrompt(spec, failing(result)), limits.fix);
        result = await test();
        const stuckAfterFix = envProblem(result);
        if (stuckAfterFix) return stuckAfterFix;
      }
    }
  } catch (err) {
    if (err instanceof Stopped) return stopped(err.message.replace(/^Stopped by the developer at /, '').replace(/\.$/, ''));
    if (err instanceof HarnessError) return outcome({ ok: false, kind: err.kind, error: err.message });
    throw err;
  }

  if (result.code !== 0) {
    return outcome({
      ok: false,
      kind: 'tests_failing',
      error:
        `Tests still failing after ${MAX_FIX_ROUNDS} automatic fix rounds: ${names(result)}. ` +
        `Nothing was published. The work is kept in ${worktree}: press Continue to try again, or fix it by hand and press Continue.`,
    });
  }

  const patch = await deps.stagedDiff(worktree, baseBranch);
  if (!patch.trim()) return outcome({ ok: false, kind: 'no_changes', error: 'The agent made no changes.' });
  await deps.commit(worktree, commitMessage);
  if (skipped.length) summary = `${summary}\n\nTests skipped by the developer: ${skipped.join(', ')}.`.trim();
  log('info', `Built${skipped.length ? ` (tests skipped: ${skipped.join(', ')})` : ' and green'}. Committed locally; review it and raise the pull request when you are ready.${cost ? ` Credits spent: $${cost.toFixed(2)}.` : ''}`);
  return outcome({ ok: true, patch, skipped });
}
