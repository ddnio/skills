// Stage6a: per-cwd buddy_session_id isolation tests (updated for official path pattern).
// Validates that loadBuddySession/saveBuddySession route by cwd and never
// let two concurrent worktrees share the same buddy session id via
// the global ~/.buddy/buddy-session.json pointer.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { saveBuddySession, loadBuddySession } from '../codex-adapter.mjs';
import { resolveBuddySessionFile } from '../paths.mjs';

describe('buddy session id isolation (stage5e)', () => {
  let tmpHome;
  let oldHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-sid-'));
    oldHome = process.env.BUDDY_HOME;
    process.env.BUDDY_HOME = path.join(tmpHome, '.buddy');
  });
  afterEach(() => {
    if (oldHome === undefined) delete process.env.BUDDY_HOME;
    else process.env.BUDDY_HOME = oldHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  test('save+load round-trip via cwd', () => {
    saveBuddySession('buddy-aaa', { cwd: '/path/to/worktree-A' });
    assert.equal(loadBuddySession({ cwd: '/path/to/worktree-A' }), 'buddy-aaa');
  });

  test('two worktrees produce isolated buddy sids (no global pointer race)', () => {
    saveBuddySession('buddy-aaa', { cwd: '/path/to/worktree-A' });
    saveBuddySession('buddy-bbb', { cwd: '/path/to/worktree-B' });
    // Each cwd reads its own — last writer does NOT win across cwds.
    assert.equal(loadBuddySession({ cwd: '/path/to/worktree-A' }), 'buddy-aaa');
    assert.equal(loadBuddySession({ cwd: '/path/to/worktree-B' }), 'buddy-bbb');
  });

  test('per-cwd file written under state/<slug>-<hash16>/buddy-session.json (stage6a)', () => {
    saveBuddySession('buddy-xyz', { cwd: '/some/repo' });
    const file = resolveBuddySessionFile('/some/repo');
    assert.ok(fs.existsSync(file), `expected per-cwd file at ${file}`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.buddy_session_id, 'buddy-xyz');
    assert.equal(data.cwd, '/some/repo');
    // Verify new path format: must NOT use the old by-cwd/<hash8> layout.
    assert.ok(!file.includes('by-cwd'), `path should not use legacy by-cwd layout, got: ${file}`);
    assert.ok(file.endsWith('buddy-session.json'), `file should be named buddy-session.json, got: ${file}`);
  });

  test('legacy global pointer still written for back-compat', () => {
    saveBuddySession('buddy-legacy-write', { cwd: '/repo' });
    const legacyFile = path.join(process.env.BUDDY_HOME, 'buddy-session.json');
    assert.ok(fs.existsSync(legacyFile), 'legacy global file must still be written');
    assert.equal(JSON.parse(fs.readFileSync(legacyFile, 'utf8')).buddy_session_id, 'buddy-legacy-write');
  });

  test('load with no cwd falls back to legacy global file', () => {
    // Pre-stage5e data: only the legacy global file exists.
    fs.mkdirSync(process.env.BUDDY_HOME, { recursive: true });
    fs.writeFileSync(path.join(process.env.BUDDY_HOME, 'buddy-session.json'),
      JSON.stringify({ buddy_session_id: 'buddy-legacy-only' }));
    assert.equal(loadBuddySession(), 'buddy-legacy-only',
      'no cwd → must fall back to legacy global file (back-compat)');
  });

  test('load with cwd that has no per-cwd file falls back to legacy', () => {
    fs.mkdirSync(process.env.BUDDY_HOME, { recursive: true });
    fs.writeFileSync(path.join(process.env.BUDDY_HOME, 'buddy-session.json'),
      JSON.stringify({ buddy_session_id: 'buddy-legacy' }));
    // No per-cwd file written. Must fall back rather than return null.
    assert.equal(loadBuddySession({ cwd: '/never-saved' }), 'buddy-legacy');
  });

  test('load returns null when neither per-cwd nor legacy exists', () => {
    fs.mkdirSync(process.env.BUDDY_HOME, { recursive: true });
    assert.equal(loadBuddySession({ cwd: '/no-where' }), null);
    assert.equal(loadBuddySession(), null);
  });
});
