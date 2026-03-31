import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { appendLog, getCallCount, getBudgetRemaining, BUDGET_LIMIT } from '../audit.mjs';

describe('audit', () => {
  let tmpDir;
  let logFile;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-audit-'));
    logFile = path.join(tmpDir, 'logs.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('appendLog writes valid JSONL with metadata', () => {
    const envelope = { turn: 1, level: 'V2', rule: 'floor:correctness', triggered: true, route: 'local', evidence: ['test:ok'], conclusion: 'proceed' };
    appendLog(logFile, envelope, 'sess-001', '/tmp/project');

    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);

    const entry = JSON.parse(lines[0]);
    assert.equal(entry.session_id, 'sess-001');
    assert.equal(entry.workspace, '/tmp/project');
    assert.equal(entry.turn, 1);
    assert.ok(entry.timestamp);
    assert.ok(typeof entry.latency_ms === 'undefined' || typeof entry.latency_ms === 'number');
  });

  test('getCallCount counts codex calls for a session', () => {
    appendLog(logFile, { turn: 1, route: 'codex', conclusion: 'proceed' }, 'sess-001', '/tmp');
    appendLog(logFile, { turn: 2, route: 'local', conclusion: 'proceed' }, 'sess-001', '/tmp');
    appendLog(logFile, { turn: 3, route: 'codex', conclusion: 'proceed' }, 'sess-001', '/tmp');

    assert.equal(getCallCount(logFile, 'sess-001'), 2);
  });

  test('getBudgetRemaining returns correct remaining budget', () => {
    appendLog(logFile, { turn: 1, route: 'codex', conclusion: 'proceed' }, 'sess-001', '/tmp');
    assert.equal(getBudgetRemaining(logFile, 'sess-001'), BUDGET_LIMIT - 1);
  });

  test('getBudgetRemaining returns full budget for new session', () => {
    assert.equal(getBudgetRemaining(logFile, 'new-sess'), BUDGET_LIMIT);
  });
});
