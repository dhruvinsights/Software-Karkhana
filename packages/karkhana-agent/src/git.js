// The local checkout: one clone per repository under the work directory, and
// one git worktree per task beside it, so the developer can open, run and
// inspect exactly what the agent built while their main clone stays clean.
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { has, must } from './proc.js';

// Agent scratch directories that must never end up in a patch.
const LOCAL_ONLY = ['.bob/', '.claude/', '.gemini/', '.karkhana-agent/'];

let ghHelper;
/** Uses `gh` as the credential helper for GitHub over HTTPS when it is installed and signed in. */
async function credentialArgs(url) {
  if (!url.startsWith('https://github.com/')) return [];
  ghHelper ??= (await has('gh')) ? ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'] : [];
  return ghHelper;
}

export function repoName(url) {
  return basename(url).replace(/\.git$/, '');
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Clones the repository once, then keeps the base branch fresh. Returns the clone path. */
export async function ensureClone(url, workDir, baseBranch) {
  const dir = join(workDir, repoName(url));
  const auth = await credentialArgs(url);
  await mkdir(workDir, { recursive: true });
  if (!(await exists(join(dir, '.git')))) {
    await must('git', [...auth, 'clone', '--quiet', url, dir]);
    const common = (await must('git', ['rev-parse', '--git-common-dir'], { cwd: dir })).trim();
    await appendFile(join(dir, common, 'info', 'exclude'), `\n# karkhana-agent\n${LOCAL_ONLY.join('\n')}\n`);
  }
  await must('git', [...auth, 'fetch', '--quiet', 'origin', baseBranch], { cwd: dir });
  return dir;
}

/** A fresh worktree for one task on a new branch from origin/<base>. Returns its path. */
export async function taskWorktree(cloneDir, branch, baseBranch, folderName) {
  const path = join(`${cloneDir}.worktrees`, folderName);
  if (await exists(path)) await must('git', ['worktree', 'remove', '--force', path], { cwd: cloneDir });
  await mkdir(`${cloneDir}.worktrees`, { recursive: true });
  await must('git', ['worktree', 'add', '--quiet', '-B', branch, path, `origin/${baseBranch}`], { cwd: cloneDir });
  return path;
}

/** Stages everything and returns the binary diff against the base, or '' when nothing changed. */
export async function stagedDiff(worktree) {
  await must('git', ['add', '-A'], { cwd: worktree });
  return must('git', ['diff', '--cached', '--binary'], { cwd: worktree });
}

/** Commits the staged change on the task branch, so it stays in the developer's checkout. */
export async function commit(worktree, message) {
  await must(
    'git',
    ['-c', 'user.name=Karkhana Agent', '-c', 'user.email=agent@karkhana.dev', 'commit', '--quiet', '--no-verify', '-m', message],
    { cwd: worktree },
  );
}
