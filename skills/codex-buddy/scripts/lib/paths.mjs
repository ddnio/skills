/**
 * paths.mjs — buddy home and workspace state resolution.
 *
 * Two distinct path concepts:
 *
 *   getBuddyHome()        → persistent user-level data (~/.buddy or $BUDDY_HOME)
 *                           used for: logs.jsonl, sessions/, broker sockets/pids
 *                           never cleaned by SessionEnd
 *
 *   resolveStateDir(cwd)  → per-workspace runtime state (official codex-plugin-cc pattern)
 *                           used for: buddy_session_id, broker.json session pointer
 *                           keyed by git root (not raw cwd) so subdirectory invocations
 *                           always resolve to the same dir
 *
 * State root priority (resolveStateDir):
 *   1. $CLAUDE_PLUGIN_DATA/state/<slug>-<hash16>/  — Claude Code plugin environment
 *   2. $BUDDY_HOME/state/<slug>-<hash16>/           — BUDDY_HOME override (tests/CI)
 *   3. ~/.buddy/state/<slug>-<hash16>/              — personal install fallback
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Persistent user-level data directory.
 * Honors BUDDY_HOME env for test/CI isolation.
 */
export function getBuddyHome() {
  return process.env.BUDDY_HOME || path.join(os.homedir(), '.buddy');
}

/**
 * Resolve workspace root via git (official pattern).
 * Falls back to cwd if not in a git repo.
 *
 * @param {string} cwd - project directory passed via --project-dir
 * @returns {string} absolute workspace root path
 */
export function resolveWorkspaceRoot(cwd) {
  if (!cwd) return process.cwd();
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return path.resolve(cwd);
  }
}

/**
 * Resolve per-workspace state directory (official codex-plugin-cc pattern).
 *
 * Directory name: <slug>-<hash16>
 *   slug = sanitized basename of workspace root
 *   hash = sha256(realpathSync(workspaceRoot)).slice(0, 16)
 *
 * Caller must mkdirSync before writing.
 *
 * @param {string} cwd - project directory passed via --project-dir
 * @returns {string} absolute state dir path
 */
export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  let canonicalRoot = workspaceRoot;
  try {
    canonicalRoot = fs.realpathSync(workspaceRoot);
  } catch {
    // realpathSync fails on non-existent paths; keep original
  }

  const slug = (path.basename(canonicalRoot) || 'workspace')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'workspace';

  const hash = createHash('sha256').update(canonicalRoot).digest('hex').slice(0, 16);

  const stateRoot = _stateRoot();
  return path.join(stateRoot, `${slug}-${hash}`);
}

/**
 * Resolve the buddy-session.json path for a given cwd.
 * Convenience wrapper over resolveStateDir.
 */
export function resolveBuddySessionFile(cwd) {
  return path.join(resolveStateDir(cwd), 'buddy-session.json');
}

// Internal: pick stateRoot based on env priority.
function _stateRoot() {
  if (process.env.CLAUDE_PLUGIN_DATA) {
    return path.join(process.env.CLAUDE_PLUGIN_DATA, 'state');
  }
  return path.join(getBuddyHome(), 'state');
}
