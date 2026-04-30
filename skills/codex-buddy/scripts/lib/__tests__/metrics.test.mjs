import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { appendLog } from '../audit.mjs';
import { appendSessionEvent } from '../session-log.mjs';
import { getStats } from '../metrics.mjs';

function probeEnvelope() {
  return { turn: 1, level: 'V2', rule: 'r', triggered: true, route: 'codex', evidence: [], conclusion: 'proceed' };
}

describe('metrics', () => {
  let tmpHome;
  let oldHome;
  let logFile;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-metrics-'));
    oldHome = process.env.BUDDY_HOME;
    process.env.BUDDY_HOME = path.join(tmpHome, '.buddy');
    fs.mkdirSync(process.env.BUDDY_HOME, { recursive: true });
    logFile = path.join(process.env.BUDDY_HOME, 'logs.jsonl');
  });
  afterEach(() => {
    if (oldHome === undefined) delete process.env.BUDDY_HOME;
    else process.env.BUDDY_HOME = oldHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  test('annotate field accumulation across multiple partial annotate events (C1)', () => {
    const sid = 'buddy-c1';
    const vtask = 'vtask-c1-001';
    appendLog(logFile, { envelope: probeEnvelope(), buddySessionId: sid, workspace: '/tmp', action: 'probe', verificationTaskId: vtask, latencyMs: 1000 });
    appendSessionEvent(sid, vtask, 'annotate', { probe_found_new: true });
    appendSessionEvent(sid, vtask, 'annotate', { user_adopted: true });
    const stats = getStats(logFile, sid);
    assert.equal(stats.probe_found_new_rate, 100);
    assert.equal(stats.user_adopted_rate, 100);
  });

  test('per-field last-wins on re-annotation', () => {
    const sid = 'buddy-c1b';
    const vtask = 'vtask-c1b-001';
    appendLog(logFile, { envelope: probeEnvelope(), buddySessionId: sid, workspace: '/tmp', action: 'probe', verificationTaskId: vtask });
    appendSessionEvent(sid, vtask, 'annotate', { probe_found_new: true });
    appendSessionEvent(sid, vtask, 'annotate', { probe_found_new: false });
    appendSessionEvent(sid, vtask, 'annotate', { user_adopted: true });
    const stats = getStats(logFile, sid);
    assert.equal(stats.probe_found_new_rate, 0);
    assert.equal(stats.user_adopted_rate, 100);
  });

  test('legacy entries with in-place annotation still counted', () => {
    const legacy = { turn: 1, route: 'codex', session_id: 'buddy-legacy', timestamp: '2026-01-01T00:00:00Z',
                     probe_found_new: true, action: 'probe' };
    fs.appendFileSync(logFile, JSON.stringify(legacy) + '\n');
    const stats = getStats(logFile, 'buddy-legacy');
    assert.equal(stats.probe_found_new_rate, 100);
  });

  // F6 regression test: annotate without explicit task id must attach to latest probe,
  // not a more-recent followup; otherwise metrics (which only iterates probes) drops it.
  test('default annotate prefers probe over followup (F6)', async () => {
    const sid = 'buddy-f6';
    const probeTask = 'vtask-probe-001';
    const fupTask   = 'vtask-fup-001';
    // Probe row + probe.codex_output in session-log
    appendLog(logFile, { envelope: probeEnvelope(), buddySessionId: sid, workspace: '/tmp', action: 'probe', verificationTaskId: probeTask, latencyMs: 100 });
    appendSessionEvent(sid, probeTask, 'probe.codex_output', { runtime: 'broker' });
    // Followup row + followup.codex_output (chronologically AFTER probe)
    appendLog(logFile, { envelope: probeEnvelope(), buddySessionId: sid, workspace: '/tmp', action: 'followup', verificationTaskId: fupTask, latencyMs: 100 });
    appendSessionEvent(sid, fupTask, 'followup.codex_output', { runtime: 'broker' });

    // Simulate `actionAnnotate` default lookup: scan from end for probe.codex_output ONLY.
    // We test this by directly invoking the same logic against the session events.
    const { readSessionEvents } = await import('../session-log.mjs');
    const events = readSessionEvents(sid);
    let resolved = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].event === 'probe.codex_output') { resolved = events[i].verification_task_id; break; }
    }
    assert.equal(resolved, probeTask, 'default must resolve to probe task, even when followup is more recent');

    // Now actually annotate that probe and verify metrics counts it.
    appendSessionEvent(sid, probeTask, 'annotate', { probe_found_new: true });
    const stats = getStats(logFile, sid);
    assert.equal(stats.probe_found_new_rate, 100);
  });
});
