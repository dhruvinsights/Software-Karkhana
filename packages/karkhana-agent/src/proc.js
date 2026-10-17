// Child processes with a fixed argv: never a shell string, so nothing the
// server sends can be interpreted as a command.
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

/**
 * Runs a command to completion.
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function run(cmd, args, { cwd, env, input, timeoutMs = 600_000, onStdoutLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
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
      reject(err.code === 'ENOENT' ? new Error(`${cmd} is not installed or not on PATH`) : err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (onStdoutLine && pending) onStdoutLine(pending);
      resolve({ code: code ?? (signal ? 124 : 1), stdout, stderr });
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
