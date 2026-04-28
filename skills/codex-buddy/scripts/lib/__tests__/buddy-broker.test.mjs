/**
 * buddy-broker.test.mjs — W7 lifecycle tests.
 *
 * Covers spawn → connect → ping → shutdown round-trip, stale lock recovery,
 * and pure helpers (getWorktreeHash, getBrokerPaths). Codex forwarding is W8.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getWorktreeHash,
  getBrokerPaths,
  isBrokerAlive,
  spawnBroker,
  sendCommand,
  sendShutdown,
} from '../buddy-broker.mjs';

const FIXTURE_PROJECT = '/tmp/buddy-broker-test-project';
let TEST_HOME;
let prevBuddyHome;

before(() => {
  prevBuddyHome = process.env.BUDDY_HOME;
  TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-broker-test-'));
  process.env.BUDDY_HOME = TEST_HOME;
  fs.mkdirSync(FIXTURE_PROJECT, { recursive: true });
});

after(() => {
  if (prevBuddyHome === undefined) delete process.env.BUDDY_HOME;
  else process.env.BUDDY_HOME = prevBuddyHome;
  try { fs.rmSync(TEST_HOME, { recursive: true, force: true }); } catch {}
});

describe('buddy-broker — pure helpers', () => {
  test('getWorktreeHash is deterministic for the same path', () => {
    const a = getWorktreeHash('/foo/bar');
    const b = getWorktreeHash('/foo/bar');
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{8}$/);
  });

  test('getWorktreeHash differs across paths', () => {
    const a = getWorktreeHash('/foo/bar');
    const b = getWorktreeHash('/foo/baz');
    assert.notEqual(a, b);
  });

  test('getBrokerPaths places sock/pid under BUDDY_HOME with hash suffix', () => {
    const paths = getBrokerPaths(TEST_HOME, '/foo/bar');
    assert.ok(paths.sockPath.startsWith(TEST_HOME));
    assert.ok(paths.pidPath.startsWith(TEST_HOME));
    assert.match(paths.sockPath, /broker-[0-9a-f]{8}\.sock$/);
    assert.match(paths.pidPath, /broker-[0-9a-f]{8}\.pid$/);
    assert.equal(paths.hash.length, 8);
  });
});

describe('buddy-broker — lifecycle round-trip', () => {
  test('spawn → ping → shutdown', async () => {
    const paths = getBrokerPaths(TEST_HOME, FIXTURE_PROJECT);
    const { pid } = await spawnBroker({ projectRoot: FIXTURE_PROJECT, home: TEST_HOME });
    try {
      assert.ok(pid > 0);
      assert.ok(fs.existsSync(paths.sockPath), 'sock file should exist');
      assert.ok(fs.existsSync(paths.pidPath), 'pid file should exist');
      assert.equal(await isBrokerAlive(paths), true);

      const pong = await sendCommand(paths, { method: 'ping' });
      assert.equal(pong.result?.ok, true);
    } finally {
      await sendShutdown(paths);
    }
    // After shutdown: sock + pid removed, isBrokerAlive false
    await waitGone(paths.sockPath);
    assert.equal(fs.existsSync(paths.sockPath), false);
    assert.equal(fs.existsSync(paths.pidPath), false);
    assert.equal(await isBrokerAlive(paths), false);
  });

  test('stale lock recovery: nonexistent PID + leftover sock → isBrokerAlive false', async () => {
    const projectRoot = '/tmp/buddy-broker-stale-' + Date.now();
    fs.mkdirSync(projectRoot, { recursive: true });
    const paths = getBrokerPaths(TEST_HOME, projectRoot);
    // Create a fake stale state: sock file (regular file, not a real socket) +
    // pid pointing to PID 999999 (very unlikely to exist).
    fs.writeFileSync(paths.sockPath, '');
    fs.writeFileSync(paths.pidPath, '999999');
    assert.equal(await isBrokerAlive(paths), false);
  });

  test('spawn cleans up stale lock from a dead prior run', async () => {
    const projectRoot = '/tmp/buddy-broker-stale2-' + Date.now();
    fs.mkdirSync(projectRoot, { recursive: true });
    const paths = getBrokerPaths(TEST_HOME, projectRoot);
    fs.writeFileSync(paths.sockPath, '');
    fs.writeFileSync(paths.pidPath, '999999');

    const { pid } = await spawnBroker({ projectRoot, home: TEST_HOME });
    try {
      assert.ok(pid > 0);
      assert.equal(await isBrokerAlive(paths), true);
      const pong = await sendCommand(paths, { method: 'ping' });
      assert.equal(pong.result?.ok, true);
    } finally {
      await sendShutdown(paths);
    }
  });

  test('sendShutdown is idempotent when broker already gone', async () => {
    const projectRoot = '/tmp/buddy-broker-idem-' + Date.now();
    fs.mkdirSync(projectRoot, { recursive: true });
    const paths = getBrokerPaths(TEST_HOME, projectRoot);
    // No broker running: sendShutdown should resolve without throwing.
    await sendShutdown(paths);
    await sendShutdown(paths); // second call also fine
  });
});

async function waitGone(p, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(p)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}
