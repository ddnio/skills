/**
 * kimi-adapter.mjs — Kimi CLI execution adapter for codex-buddy
 *
 * Kimi is the exec-only path (no broker equivalent).
 * Invocation: kimi --print --afk -p "<prompt>"
 * Output:     parsed via parsers/kimi-repr-v1.mjs
 *
 * Returns: { raw, parsed: {think, text, sessionId}, parseStatus,
 *            parserVersion, model: 'kimi', exitCode }
 */

import { spawnSync } from 'node:child_process';
import { parse, version as parserVersion } from './parsers/kimi-repr-v1.mjs';

export const MODEL = 'kimi';

/**
 * Build kimi CLI argument list for a one-shot probe.
 * @param {string} prompt — the full evidence+task prompt
 * @param {object} [opts]
 * @param {string} [opts.model]        — override kimi model (not passed by default)
 * @param {string} [opts.workDir]      — working directory override
 * @returns {string[]}
 */
export function buildProbeArgs(prompt, opts = {}) {
  const args = ['--print', '--afk', '-p', prompt];
  if (opts.model) args.unshift('-m', opts.model);
  return args;
}

/**
 * Execute kimi one-shot probe.
 * @param {string} prompt
 * @param {object} opts
 * @param {string} [opts.projectDir]   — cwd for kimi invocation
 * @param {string} [opts.model]        — optional model override (user-requested only)
 * @param {number} [opts.timeoutMs]    — spawn timeout (default 120s)
 * @returns {{ exitCode: number, raw: string, parsed: object,
 *             parseStatus: string, parserVersion: string, model: 'kimi' }}
 */
export function execKimi(prompt, opts = {}) {
  const args = buildProbeArgs(prompt, { model: opts.model });
  const timeoutMs = opts.timeoutMs ?? 120_000;

  let result;
  try {
    result = spawnSync('kimi', args, {
      cwd: opts.projectDir || process.cwd(),
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MiB
    });
  } catch (spawnErr) {
    const raw = spawnErr.message || 'kimi spawn failed';
    return { exitCode: -1, raw, parsed: { think: [], text: [], sessionId: null },
             parseStatus: 'failed', parserVersion, model: MODEL };
  }

  const stdout = result.stdout || '';
  const parsed = parse(stdout);

  return {
    exitCode: result.status ?? -1,
    raw: stdout,
    parsed,
    parseStatus: parsed.parseStatus,
    parserVersion,
    model: MODEL,
  };
}

/**
 * Preflight check: verify kimi CLI is installed and functional.
 * @returns {{ ok: boolean, version: string|null, error: string|null }}
 */
export function preflight() {
  try {
    const r = spawnSync('kimi', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (r.status === 0) {
      const versionLine = (r.stdout || '').trim().split('\n')[0] || '';
      return { ok: true, version: versionLine || null, error: null };
    }
    return { ok: false, version: null,
             error: `kimi --version exited ${r.status}: ${(r.stderr || '').slice(0, 200)}` };
  } catch (e) {
    return { ok: false, version: null, error: e.message || 'kimi not found' };
  }
}
