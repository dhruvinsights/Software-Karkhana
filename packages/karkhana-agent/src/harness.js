// Coding agents the developer already uses. Each adapter runs the agent in a
// worktree with the task as its prompt (on stdin), turns its JSON event stream
// into log lines, and returns what it said and what it cost. Model keys stay on
// this machine.
//
// What can go wrong with a coding agent is handled here with a plain message the
// developer can act on: out of credits, not signed in, rate limited (one retry),
// turn or cost cap hit, timeout, stopped by the developer. Every run has hard
// turn and cost caps so a confused agent cannot burn credits.
import { run } from './proc.js';

export const DEFAULT_LIMITS = { maxTurns: 60, maxCost: 3 };
export const FIX_LIMITS = { maxTurns: 25, maxCost: 1.5 };
const TIMEOUT_MS = 45 * 60_000;

/** Why a harness stopped, with what to do about it. */
export class HarnessError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'HarnessError';
    this.kind = kind;
  }
}

const RULES = [
  ['credits', /insufficient (credit|fund|balance)|out of credits|no credits|credit balance|quota (exceeded|exhausted)|billing|payment required|\b402\b|usage limit|plan limit/i,
    (h) => `${h} has no credits left. Top up or switch the machine's harness (karkhana-agent login --harness …); the work so far is kept.`],
  ['auth', /not logged in|please log ?in|unauthori[sz]ed|invalid (api )?key|authentication|\b401\b|login required|token (expired|invalid)|api key (is )?(missing|not set)/i,
    (h) => `${h} is not signed in on this machine. Sign in to it (or set its API key), then press Continue.`],
  ['rate_limit', /rate.?limit|too many requests|\b429\b|overloaded|\b529\b|temporarily unavailable|econnreset|etimedout|socket hang up|network error/i,
    (h) => `${h} was rate limited or unreachable. Wait a minute and press Continue.`],
  ['max_cost', /max[_ -]?(budget|cost)|cost (limit|cap)|budget/i,
    (h, l) => `${h} hit the cost cap of $${l.maxCost} for this step. The work so far is kept; press Continue to let it carry on from there.`],
  ['max_turns', /max[_ -]?turns|turn (limit|cap)/i,
    (h, l) => `${h} used all ${l.maxTurns} turns for this step. The work so far is kept; press Continue to let it carry on from there.`],
];

/**
 * Names a failure from the agent's own words and exit state.
 * @returns {{kind: string, message: string}}
 */
export function classifyFailure({ text = '', timedOut = false, aborted = false, harness = 'The coding agent', limits = DEFAULT_LIMITS }) {
  if (aborted) return { kind: 'cancelled', message: 'Stopped by the developer. The work so far is kept.' };
  if (timedOut) return { kind: 'timeout', message: `${harness} did not finish in ${TIMEOUT_MS / 60_000} minutes and was stopped. The work so far is kept; press Continue.` };
  for (const [kind, re, say] of RULES) if (re.test(text)) return { kind, message: say(harness, limits) };
  return { kind: 'other', message: `${harness} failed: ${text.trim().slice(-400) || 'no output'}` };
}

/** The environment agents and tests run in: Python tooling may not touch the system interpreter. */
export function harnessEnv(base = process.env) {
  const env = { ...base, PIP_REQUIRE_VIRTUALENV: 'true', PIP_DISABLE_PIP_VERSION_CHECK: '1', NPM_CONFIG_UPDATE_NOTIFIER: 'false' };
  return env;
}

function bobEnv() {
  const env = { ...harnessEnv(), BOB_LOG_LEVEL: 'error' };
  // Bob refuses to start when both key variables are set to different values.
  if (env.BOB_API_KEY) delete env.BOBSHELL_API_KEY;
  return env;
}

/** IBM Bob: `bob run --format stream-json`. */
async function bob(prompt, worktree, log, { limits = DEFAULT_LIMITS, signal } = {}) {
  let summary = '';
  let failure = '';
  let cost = 0;
  let turns = 0;
  const out = await run(
    'bob',
    ['run', '--format', 'stream-json', '--max-turns', String(limits.maxTurns), '--max-cost', String(limits.maxCost), '--trust',
      '--accept-license', '--disable-mcp', '--disable-subagents', '--workspace', worktree],
    {
      cwd: worktree,
      env: bobEnv(),
      input: prompt,
      timeoutMs: TIMEOUT_MS,
      signal,
      onStdoutLine: (line) => {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.type === 'tool_use') log('info', `${ev.tool_name} ${JSON.stringify(ev.parameters ?? {}).slice(0, 300)}`);
        else if (ev.type === 'tool_result' && ev.status !== 'success') log('error', String(ev.output ?? '').slice(0, 500));
        else if (ev.type === 'message' && ev.role === 'assistant') summary += ev.content ?? '';
        else if (ev.type === 'result' && ev.status !== 'success') failure = ev.error ?? ev.status;
        else if (ev.type === 'result') {
          cost = Number(ev.stats?.session_costs ?? 0);
          turns = Number(ev.stats?.tool_calls ?? 0);
          log('info', `bob finished: ${turns} tool calls, $${cost}`);
        }
      },
    },
  );
  if (out.code !== 0 || failure) {
    throw Object.assign(new HarnessError('other', ''), { raw: { text: `${failure} ${out.stderr}`, timedOut: out.timedOut, aborted: out.aborted } });
  }
  return { summary: summary.trim(), cost, turns };
}

/** Claude Code: `claude -p --output-format stream-json`, edits accepted, shell limited to test runners. */
async function claude(prompt, worktree, log, { limits = DEFAULT_LIMITS, signal } = {}) {
  let summary = '';
  let failure = '';
  let cost = 0;
  let turns = 0;
  const out = await run(
    'claude',
    ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', String(limits.maxTurns), '--max-budget-usd', String(limits.maxCost),
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep',
      'Bash(uv run *)', 'Bash(python -m pytest*)', 'Bash(npm test*)', 'Bash(git diff*)', 'Bash(git status*)'],
    {
      cwd: worktree,
      env: harnessEnv(),
      input: prompt,
      timeoutMs: TIMEOUT_MS,
      signal,
      onStdoutLine: (line) => {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.type === 'assistant') {
          for (const part of ev.message?.content ?? []) {
            if (part.type === 'tool_use') log('info', `${part.name} ${JSON.stringify(part.input ?? {}).slice(0, 300)}`);
            if (part.type === 'text') log('thinking', part.text.slice(0, 500));
          }
        } else if (ev.type === 'result') {
          summary = ev.result ?? '';
          cost = Number(ev.total_cost_usd ?? 0);
          turns = Number(ev.num_turns ?? 0);
          log('info', `claude finished: ${turns || '?'} turns, $${cost.toFixed(4)}`);
          if (ev.is_error) failure = `${ev.subtype ?? 'error'} ${ev.result ?? ''}`;
        }
      },
    },
  );
  if (out.code !== 0 || failure) {
    throw Object.assign(new HarnessError('other', ''), { raw: { text: `${failure} ${out.stderr}`, timedOut: out.timedOut, aborted: out.aborted } });
  }
  return { summary: summary.trim(), cost, turns };
}

export const HARNESSES = { bob, claude };

/**
 * The adapter for ``name`` wrapped with failure handling: a rate limit is retried
 * once, every failure comes out as a :class:`HarnessError` with a plain message.
 */
export function harnessFor(name, { retryDelayMs = 20_000 } = {}) {
  const fn = HARNESSES[name];
  if (!fn) throw new Error(`unknown harness "${name}"; use one of: ${Object.keys(HARNESSES).join(', ')}`);
  const label = name === 'bob' ? 'Bob' : 'Claude Code';
  return async (prompt, worktree, log, opts = {}) => {
    const limits = opts.limits ?? DEFAULT_LIMITS;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fn(prompt, worktree, log, opts);
      } catch (err) {
        if (!err.raw) throw err;
        const { kind, message } = classifyFailure({ ...err.raw, harness: label, limits });
        if (kind === 'rate_limit' && attempt === 0 && !opts.signal?.aborted) {
          log('info', `${label} was rate limited; trying once more in ${Math.round(retryDelayMs / 1000)} s`);
          await new Promise((r) => setTimeout(r, retryDelayMs));
          continue;
        }
        throw new HarnessError(kind, message);
      }
    }
  };
}
