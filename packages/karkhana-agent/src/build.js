// One story, start to finish, on the developer's machine, without wasting credits:
//
//   continuing?  run the tests first; if they already pass, the coding agent is not called
//   code         one agent call with a hard turn and cost cap
//   test         every suite runs and is reported as it starts and ends
//   fix          failing suites go back to the agent for up to two small rounds
//   done         only a green build is committed and sent back; a red one stops with the work kept
//
// Nothing here opens a pull request. The developer reviews the result and raises it.
import { continuePrompt, buildPrompt, fixPrompt } from './prompts.js';
import { FIX_LIMITS, DEFAULT_LIMITS, HarnessError } from './harness.js';

export const MAX_FIX_ROUNDS = 2;

const failing = (r) => r.suites.filter((s) => s.status !== 'passed');
const names = (r) => failing(r).map((s) => `${s.suite}${s.total != null ? ` (${s.failed ?? 0} failed of ${s.total})` : ''}`).join(', ');

/**
 * @param {object} p
 * @param {object} p.spec          the story (task_key, task_title, acceptance_criteria, context…)
 * @param {string} p.worktree
 * @param {string} p.baseBranch
 * @param {boolean} p.resumed      the worktree already existed
 * @param {string} p.sandbox
 * @param {Function} p.log
 * @param {Function} p.report      sends each suite's state to the server
 * @param {AbortSignal} [p.signal]
 * @param {string} p.commitMessage
 * @param {object} p.deps          { harness, testSuites, runSuites, workState, stagedDiff, commit }
 * @param {object} [p.caps]        { build, fix } turn and cost caps
 */
export async function buildTask({ spec, worktree, baseBranch, resumed, sandbox, log, report, signal, commitMessage, deps, caps = {} }) {
  const limits = { build: caps.build ?? DEFAULT_LIMITS, fix: caps.fix ?? FIX_LIMITS };
  let cost = 0;
  let summary = '';
  let agentCalls = 0;
  let result = null;
  const suites = await deps.testSuites(worktree);
  const test = () => deps.runSuites(worktree, suites, sandbox, report);
  const outcome = (extra) => ({ cost, agentCalls, summary, result, suites: result?.suites ?? [], ...extra });

  try {
    let state = null;
    let needAgent = true;
    if (resumed) {
      state = await deps.workState(worktree, baseBranch);
      if (state.files.length === 0) {
        state = null; // an empty leftover worktree is a fresh start
      } else {
        log('info', `continuing: ${state.files.length}${state.more ? '+' : ''} file(s) already changed. Running the tests first; the coding agent is only called if something fails.`);
        result = await test();
        if (result.code === 0) {
          needAgent = false;
          log('info', 'The tests already pass, so nothing is redone and no credits are spent.');
        }
      }
    }
    if (signal?.aborted) return outcome({ ok: false, kind: 'cancelled', error: 'Stopped by the developer. The work so far is kept.' });

    if (needAgent) {
      const prompt = state ? continuePrompt(spec, state, result ? failing(result) : []) : buildPrompt(spec);
      const first = await deps.harness(prompt, worktree, log, { limits: limits.build, signal });
      agentCalls += 1;
      cost += first.cost ?? 0;
      summary = first.summary ?? '';
      result = await test();
      for (let round = 1; round <= MAX_FIX_ROUNDS && result.code !== 0; round += 1) {
        if (signal?.aborted) return outcome({ ok: false, kind: 'cancelled', error: 'Stopped by the developer. The work so far is kept.' });
        log('info', `Tests failing: ${names(result)}. Sending only the failures back to the agent (round ${round} of ${MAX_FIX_ROUNDS}).`);
        const fix = await deps.harness(fixPrompt(spec, failing(result)), worktree, log, { limits: limits.fix, signal });
        agentCalls += 1;
        cost += fix.cost ?? 0;
        summary = fix.summary || summary;
        result = await test();
      }
    }
  } catch (err) {
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
  log('info', `Built and green. Committed locally; review it and raise the pull request when you are ready.${cost ? ` Credits spent: $${cost.toFixed(2)}.` : ''}`);
  return outcome({ ok: true, patch });
}
