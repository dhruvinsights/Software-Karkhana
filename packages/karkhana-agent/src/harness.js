// Coding agents the developer already uses. Each adapter runs the agent in a
// worktree with the task as its prompt (on stdin), turns its JSON event stream
// into log lines, and returns its final summary. Model keys stay on this machine.
import { run } from './proc.js';

const MAX_TURNS = '80';

function bobEnv() {
  const env = { ...process.env, BOB_LOG_LEVEL: 'error' };
  // Bob refuses to start when both key variables are set to different values.
  if (env.BOB_API_KEY) delete env.BOBSHELL_API_KEY;
  return env;
}

/** IBM Bob: `bob run --format stream-json`. */
async function bob(prompt, worktree, log) {
  let summary = '';
  let failure = '';
  const out = await run(
    'bob',
    ['run', '--format', 'stream-json', '--max-turns', MAX_TURNS, '--trust', '--accept-license',
      '--disable-mcp', '--disable-subagents', '--workspace', worktree],
    {
      cwd: worktree,
      env: bobEnv(),
      input: prompt,
      timeoutMs: 45 * 60_000,
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
        else if (ev.type === 'result') log('info', `bob finished: ${ev.stats?.tool_calls ?? 0} tool calls, $${ev.stats?.session_costs ?? 0}`);
      },
    },
  );
  if (out.code !== 0 || failure) throw new Error(`bob failed: ${failure || out.stderr.trim().slice(-400)}`);
  return summary.trim();
}

/** Claude Code: `claude -p --output-format stream-json`, edits accepted, shell limited to test runners. */
async function claude(prompt, worktree, log) {
  let summary = '';
  let failure = '';
  const out = await run(
    'claude',
    ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', MAX_TURNS,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep',
      'Bash(uv run *)', 'Bash(python -m pytest*)', 'Bash(npm test*)', 'Bash(git diff*)', 'Bash(git status*)'],
    {
      cwd: worktree,
      input: prompt,
      timeoutMs: 45 * 60_000,
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
          log('info', `claude finished: ${ev.num_turns ?? '?'} turns, $${(ev.total_cost_usd ?? 0).toFixed(4)}`);
          if (ev.is_error) failure = ev.subtype ?? 'error';
        }
      },
    },
  );
  if (out.code !== 0 || failure) throw new Error(`claude failed: ${failure || out.stderr.trim().slice(-400)}`);
  return summary.trim();
}

export const HARNESSES = { bob, claude };

export function harnessFor(name) {
  const fn = HARNESSES[name];
  if (!fn) throw new Error(`unknown harness "${name}"; use one of: ${Object.keys(HARNESSES).join(', ')}`);
  return fn;
}
