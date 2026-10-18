// Child processes with a fixed argv: never a shell string, so nothing the
// server sends can be interpreted as a command.
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

/**
 * Runs a command to completion. ``signal`` (an AbortSignal) stops it early.
 * @returns {Promise<{code: number, stdout: string, stderr: string, timedOut: boolean, aborted: boolean}>}
 */
export function run(cmd, args, { cwd, env, input, timeoutMs = 600_000, onStdoutLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    let aborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!onStdoutLine) return;
      pending += text;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) onStdoutLine(line);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(err.code === 'ENOENT' ? new Error(`${cmd} is not installed or not on PATH`) : err);
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (onStdoutLine && pending) onStdoutLine(pending);
      resolve({ code: code ?? (sig ? 124 : 1), stdout, stderr, timedOut, aborted });
    });
    child.stdin.end(input ?? '');
  });
}

/** Runs a command and throws with its stderr if it fails. */
export async function must(cmd, args, opts) {
  const out = await run(cmd, args, opts);
  if (out.code !== 0) throw new Error(`${cmd} ${args[0]} failed: ${out.stderr.trim().slice(-500)}`);
  return out.stdout;
}

/** True when an executable is on PATH (looked up, not run: some CLIs exit non-zero on --version). */
export async function has(cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const ext of exts) {
      try {
        await access(join(dir, cmd + ext), constants.X_OK);
        return true;
      } catch {
        // not in this directory
      }
    }
  }
  return false;
}
