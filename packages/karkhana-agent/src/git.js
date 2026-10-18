// The local checkout: one clone per repository, and one git worktree per task
// beside it, so the developer can open, run and inspect exactly what the agent
// built while their main clone stays clean. The developer picks where the clone
// lives; a task that already has a worktree continues in it instead of starting over.
import { appendFile, mkdir, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { has, must, run } from './proc.js';

// Agent scratch directories that must never end up in a patch.
export const LOCAL_ONLY = ['.bob/', '.claude/', '.gemini/', '.chroma/', '.karkhana-agent/'];

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

/** `owner/name` of a GitHub URL (https or ssh), lowercased, or the URL itself. */
export function repoSlug(url) {
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return (m ? m[1] : url.trim()).toLowerCase();
}

/** ``~`` and relative paths resolved; the developer may type either. */
export function expandPath(p) {
  const home = p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;
  return isAbsolute(home) ? resolve(home) : resolve(homedir(), home);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The clone at ``dir``: reused when it is a checkout of ``url``, cloned when the
 * folder is missing or empty, refused (with the reason) when it is anything else.
 * Then the base branch is fetched. Returns ``dir``.
 */
export async function ensureCloneAt(dir, url, baseBranch) {
  const auth = await credentialArgs(url);
  if (await exists(join(dir, '.git'))) {
    const origin = (await run('git', ['remote', 'get-url', 'origin'], { cwd: dir })).stdout.trim();
    if (repoSlug(origin) !== repoSlug(url)) {
      throw new Error(`${dir} is a checkout of ${origin || 'another repository'}, not ${url}. Pick another folder for this project.`);
    }
  } else {
    if (await exists(dir)) {
      if ((await readdir(dir)).length > 0) throw new Error(`${dir} exists, is not empty and is not a git checkout. Pick an empty or new folder.`);
    } else {
      await mkdir(dir, { recursive: true });
    }
    await must('git', [...auth, 'clone', '--quiet', url, dir]);
    const common = (await must('git', ['rev-parse', '--git-common-dir'], { cwd: dir })).trim();
    await appendFile(join(dir, common, 'info', 'exclude'), `\n# karkhana-agent\n${LOCAL_ONLY.join('\n')}\n`);
  }
  await must('git', [...auth, 'fetch', '--quiet', 'origin', baseBranch], { cwd: dir });
  return dir;
}

/** Clones under the work directory (the default place), or reuses that clone. */
export function ensureClone(url, workDir, baseBranch) {
  return ensureCloneAt(join(workDir, repoName(url)), url, baseBranch);
}

/**
 * The worktree for one task. If it already exists the task is being continued:
 * it is kept exactly as it is. Otherwise it is created on a new branch from
 * origin/<base>. Returns ``{ path, resumed }``.
 */
export async function taskWorktree(cloneDir, branch, baseBranch, folderName) {
  const path = join(`${cloneDir}.worktrees`, folderName);
  if (await exists(join(path, '.git'))) return { path, resumed: true };
  await mkdir(`${cloneDir}.worktrees`, { recursive: true });
  await run('git', ['worktree', 'prune'], { cwd: cloneDir });
  await must('git', ['worktree', 'add', '--quiet', '-B', branch, path, `origin/${baseBranch}`], { cwd: cloneDir });
  return { path, resumed: false };
}

/**
 * Stages everything and returns the binary diff against ``origin/<base>``:
 * what an earlier commit on this branch and the files changed since add up to.
 * Empty when there is nothing to send.
 */
export async function stagedDiff(worktree, baseBranch) {
  await must('git', ['add', '-A'], { cwd: worktree });
  return must('git', ['diff', '--cached', '--binary', `origin/${baseBranch}`], { cwd: worktree });
}

/** What is already done here, for a continuing build: changed files against the base, capped. */
export async function workState(worktree, baseBranch, max = 60) {
  await must('git', ['add', '-A'], { cwd: worktree });
  const status = (await must('git', ['diff', '--cached', '--name-status', `origin/${baseBranch}`], { cwd: worktree })).trim();
  const lines = status ? status.split('\n') : [];
  const stat = (await must('git', ['diff', '--cached', '--shortstat', `origin/${baseBranch}`], { cwd: worktree })).trim();
  return { files: lines.slice(0, max), more: Math.max(0, lines.length - max), summary: stat };
}

/** Commits the staged change on the task branch, so it stays in the developer's checkout. Returns false when there is nothing new. */
export async function commit(worktree, message) {
  const clean = (await run('git', ['diff', '--cached', '--quiet'], { cwd: worktree })).code === 0;
  if (clean) return false;
  await must(
    'git',
    ['-c', 'user.name=Karkhana Agent', '-c', 'user.email=agent@karkhana.dev', 'commit', '--quiet', '--no-verify', '-m', message],
    { cwd: worktree },
  );
  return true;
}
