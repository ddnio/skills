import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { appendLog, getCallCount, AUDIT_SCHEMA_VERSION } from '../audit.mjs';

describe('audit (v2 strict)', () => {
  let tmpDir;
  let logFile;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-audit-'));
    logFile = path.join(tmpDir, 'logs.jsonl');
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  test('appendLog writes a v2 row with required canonical fields', () => {
    const envelope = { turn: 1, level: 'V2', rule: 'r', triggered: true, route: 'codex', evidence: ['ok'], conclusion: 'proceed' };
    appendLog(logFile, {
      envelope,
      buddySessionId: 'buddy-001',
      workspace: '/tmp/project',
      action: 'probe',
      verificationTaskId: 'vtask-abc',
      latencyMs: 1234,
    });
    const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    assert.equal(entry.schema_version, AUDIT_SCHEMA_VERSION);
    assert.equal(entry.buddy_session_id, 'buddy-001');
    assert.equal(entry.verification_task_id, 'vtask-abc');
    assert.equal(entry.workspace, '/tmp/project');
    assert.equal(entry.action, 'probe');
    assert.equal(entry.latency_ms, 1234);
    assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(entry.session_id, undefined);
    assert.equal(entry.timestamp, undefined);
  });

  test('appendLog drops envelope keys that are not in ENVELOPE_KEYS whitelist', () => {
    const envelope = {
      turn: 0, level: 'V2', rule: 'r', triggered: true, route: 'local', evidence: [], conclusion: 'proceed',
      // Stale aliases / unknown fields the caller might leak:
      session_id: 'wrong', timestamp: 'fake-ts', schema_version: 999, buddy_session_id: 'leaked',
      workspace: '/wrong', verification_task_id: 'vtask-leaked', message: 'leaked',
      anything_random: 'x',
    };
    appendLog(logFile, {
      envelope,
      buddySessionId: 'buddy-correct',
      workspace: '/correct',
      action: 'local',
      verificationTaskId: 'vtask-real',
    });
    const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    // Canonical wins:
    assert.equal(entry.schema_version, AUDIT_SCHEMA_VERSION);
    assert.equal(entry.buddy_session_id, 'buddy-correct');
    assert.equal(entry.verification_task_id, 'vtask-real');
    assert.equal(entry.workspace, '/correct');
    // Stale aliases stripped (NOT just shadowed):
    assert.equal(entry.session_id, undefined);
    assert.equal(entry.timestamp, undefined);
    assert.equal(entry.anything_random, undefined);
    assert.equal(entry.message, undefined);
  });

  test('appendLog rejects missing required options', () => {
    const env = { turn: 0, level: 'V2', rule: 'r', triggered: true, route: 'local', evidence: [], conclusion: 'proceed' };
    assert.throws(() => appendLog(logFile, { envelope: env, workspace: '/tmp', action: 'local', verificationTaskId: 'v1' }),
      /buddySessionId required/);
    assert.throws(() => appendLog(logFile, { envelope: env, buddySessionId: 's', action: 'local', verificationTaskId: 'v1' }),
      /workspace required/);
    assert.throws(() => appendLog(logFile, { envelope: env, buddySessionId: 's', workspace: '/tmp', action: 'local' }),
      /verificationTaskId required/);
    assert.throws(() => appendLog(logFile, { envelope: env, buddySessionId: 's', workspace: '/tmp', action: 'wrong', verificationTaskId: 'v' }),
      /action must be one of/);
  });

  test('getCallCount counts codex calls; legacy session_id fallback', () => {
    const env = { turn: 1, level: 'V2', rule: 'r', triggered: true, route: 'codex', evidence: [], conclusion: 'proceed' };
    appendLog(logFile, { envelope: env, buddySessionId: 'buddy-001', workspace: '/tmp', action: 'probe', verificationTaskId: 'v1' });
    appendLog(logFile, { envelope: { ...env, route: 'local' }, buddySessionId: 'buddy-001', workspace: '/tmp', action: 'local', verificationTaskId: 'v2' });
    appendLog(logFile, { envelope: env, buddySessionId: 'buddy-001', workspace: '/tmp', action: 'probe', verificationTaskId: 'v3' });
    fs.appendFileSync(logFile, JSON.stringify({ turn: 4, route: 'codex', session_id: 'buddy-001', timestamp: '2026-01-01T00:00:00Z' }) + '\n');
    assert.equal(getCallCount(logFile, 'buddy-001'), 3);
  });

  test('annotateLastEntry export removed', async () => {
    const mod = await import('../audit.mjs');
    assert.equal(mod.annotateLastEntry, undefined);
  });
});
