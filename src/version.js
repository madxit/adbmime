// Application version (package.json) and git commit, resolved once at startup.
// The commit comes from ADBMIME_COMMIT, the git CLI, or the .git folder read directly
// (for hosts without git); "unknown" for a plain copy without .git.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));

const git = (args) =>
  execFileSync('git', args, { cwd: ROOT_DIR, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    .toString()
    .trim();

/** HEAD commit read from .git without the git CLI. */
function commitFromDotGit() {
  const dir = path.join(ROOT_DIR, '.git');
  const head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
  if (!head.startsWith('ref: ')) return head;
  const ref = head.slice(5);
  const loose = path.join(dir, ref);
  if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
  const packed = fs.readFileSync(path.join(dir, 'packed-refs'), 'utf8');
  return packed.split('\n').find((l) => l.endsWith(` ${ref}`))?.split(' ')[0] ?? '';
}

function resolveCommit() {
  if (process.env.ADBMIME_COMMIT) return { commit: process.env.ADBMIME_COMMIT.slice(0, 12), dirty: false };
  try {
    const commit = git(['rev-parse', '--short', 'HEAD']);
    // Local changes to tracked files (untracked files are ignored).
    const dirty = git(['status', '--porcelain', '--untracked-files=no']) !== '';
    return { commit, dirty };
  } catch {
    try {
      return { commit: commitFromDotGit().slice(0, 7) || null, dirty: null };
    } catch {
      return { commit: null, dirty: null };
    }
  }
}

export const build = { version, ...resolveCommit() };
