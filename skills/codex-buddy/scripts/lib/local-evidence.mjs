import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Collect local evidence by running checks in the project directory.
 *
 * checks format:
 *   - "file-exists:<path>"       — check if file exists
 *   - "grep:<pattern>:<file>"    — search for pattern in file (safe: uses execFileSync)
 *   - "test:<command>"           — run a test command (TRUST BOUNDARY: executes shell command)
 *   - "lint:<command>"           — run a lint command (TRUST BOUNDARY: executes shell command)
 *   - "git-diff"                 — show git diff summary
 *   - "git-status"               — show git status
 *
 * Returns: { ok: boolean, evidence: string[] }
 */
export async function collectEvidence(projectDir, { checks = [] } = {}) {
  const evidence = [];
  let allOk = true;

  if (checks.length === 0) {
    return { ok: true, evidence, skipped: true };
  }

  for (const check of checks) {
    const [type, ...args] = check.split(':');

    switch (type) {
      case 'file-exists': {
        const filePath = path.resolve(projectDir, args.join(':'));
        if (fs.existsSync(filePath)) {
          evidence.push(`file-exists: ${args.join(':')} exists`);
        } else {
          evidence.push(`file-exists: ${args.join(':')} not found`);
          allOk = false;
        }
        break;
      }

      case 'grep': {
        const pattern = args[0];
        const file = args.slice(1).join(':');
        try {
          // Safe: execFileSync does not invoke a shell
          const result = execFileSync('grep', ['-n', pattern, file], {
            cwd: projectDir, encoding: 'utf8', timeout: 10000,
          }).trim();
          const lineCount = result.split('\n').length;
          evidence.push(`grep: "${pattern}" found ${lineCount} match(es) in ${file}`);
        } catch {
          evidence.push(`grep: "${pattern}" not found in ${file}`);
          allOk = false;
        }
        break;
      }

      case 'test': {
        // TRUST BOUNDARY: test commands are provided by SKILL.md (Claude),
        // which is a trusted source. Arbitrary shell execution is intentional.
        const cmd = args.join(':');
        try {
          execSync(cmd, { cwd: projectDir, encoding: 'utf8', timeout: 60000 });
          evidence.push(`test: ${cmd} passed`);
        } catch (e) {
          evidence.push(`test: ${cmd} failed — ${e.message.split('\n')[0]}`);
          allOk = false;
        }
        break;
      }

      case 'lint': {
        // TRUST BOUNDARY: lint commands are provided by SKILL.md (Claude).
        const cmd = args.join(':');
        try {
          execSync(cmd, { cwd: projectDir, encoding: 'utf8', timeout: 30000 });
          evidence.push(`lint: clean`);
        } catch (e) {
          evidence.push(`lint: issues found — ${e.message.split('\n')[0]}`);
          allOk = false;
        }
        break;
      }

      case 'git-diff': {
        try {
          const diff = execFileSync('git', ['diff', '--stat'], {
            cwd: projectDir, encoding: 'utf8', timeout: 10000,
          }).trim();
          evidence.push(`git-diff: ${diff || 'no changes'}`);
        } catch {
          evidence.push('git-diff: not a git repo or git unavailable');
        }
        break;
      }

      case 'git-status': {
        try {
          const status = execFileSync('git', ['status', '--short'], {
            cwd: projectDir, encoding: 'utf8', timeout: 10000,
          }).trim();
          evidence.push(`git-status: ${status || 'clean'}`);
        } catch {
          evidence.push('git-status: not a git repo or git unavailable');
        }
        break;
      }

      default:
        evidence.push(`unknown check type: ${type}`);
        allOk = false;
    }
  }

  return { ok: allOk, evidence };
}
