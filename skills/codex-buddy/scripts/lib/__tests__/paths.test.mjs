// paths.mjs unit tests — stage6a official path pattern.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { getBuddyHome, resolveWorkspaceRoot, resolveStateDir, resolveBuddySessionFile } from '../paths.mjs';

describe('getBuddyHome', () => {
  let orig;
  beforeEach(() => { orig = process.env.BUDDY_HOME; });
  afterEach(() => { if (orig === undefined) delete process.env.BUDDY_HOME; else process.env.BUDDY_HOME = orig; });

  test('returns BUDDY_HOME when set', () => {
    process.env.BUDDY_HOME = '/tmp/test-buddy';
    assert.equal(getBuddyHome(), '/tmp/test-buddy');
  });

  test('falls back to ~/.buddy when BUDDY_HOME not set', () => {
    delete process.env.BUDDY_HOME;
    assert.equal(getBuddyHome(), path.join(os.homedir(), '.buddy'));
  });
});

describe('resolveWorkspaceRoot', () => {
  test('falls back to resolved cwd when not in a git repo', () => {
    // /tmp is not a git repo on most systems
    const result = resolveWorkspaceRoot('/tmp');
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  test('returns cwd when git unavailable or path non-existent', () => {
    const result = resolveWorkspaceRoot('/nonexistent/path/xyz');
    assert.equal(result, path.resolve('/nonexistent/path/xyz'));
  });

  test('returns a string for real project root', () => {
    // Use this repo — git IS available here.
    const result = resolveWorkspaceRoot(process.cwd());
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0, 'workspace root must be non-empty');
  });
});

describe('resolveStateDir', () => {
  let origBuddyHome, origPluginData, tmpDir;

  beforeEach(() => {
    origBuddyHome = process.env.BUDDY_HOME;
    origPluginData = process.env.CLAUDE_PLUGIN_DATA;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-paths-'));
    process.env.BUDDY_HOME = path.join(tmpDir, '.buddy');
    delete process.env.CLAUDE_PLUGIN_DATA;
  });
  afterEach(() => {
    if (origBuddyHome === undefined) delete process.env.BUDDY_HOME;
    else process.env.BUDDY_HOME = origBuddyHome;
    if (origPluginData === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = origPluginData;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns path under BUDDY_HOME/state by default', () => {
    const dir = resolveStateDir('/some/project');
    assert.ok(dir.startsWith(path.join(tmpDir, '.buddy', 'state')),
      `expected dir under BUDDY_HOME/state, got: ${dir}`);
  });

  test('uses CLAUDE_PLUGIN_DATA/state when set', () => {
    const pluginData = path.join(tmpDir, 'plugin-data');
    process.env.CLAUDE_PLUGIN_DATA = pluginData;
    const dir = resolveStateDir('/some/project');
    assert.ok(dir.startsWith(path.join(pluginData, 'state')),
      `expected dir under CLAUDE_PLUGIN_DATA/state, got: ${dir}`);
  });

  test('dir name contains slug and 16-char hex hash', () => {
    const dir = resolveStateDir('/my/cool-repo');
    const basename = path.basename(dir);
    // Format: <slug>-<hash16>
    const match = basename.match(/^(.+)-([0-9a-f]{16})$/);
    assert.ok(match, `dir basename "${basename}" should match <slug>-<hash16>`);
  });

  test('two different cwd paths → two different state dirs', () => {
    const dir1 = resolveStateDir('/project/alpha');
    const dir2 = resolveStateDir('/project/beta');
    assert.notEqual(dir1, dir2, 'different cwds must produce different state dirs');
  });

  test('same cwd always produces the same state dir (idempotent)', () => {
    const dir1 = resolveStateDir('/project/gamma');
    const dir2 = resolveStateDir('/project/gamma');
    assert.equal(dir1, dir2);
  });
});

describe('resolveBuddySessionFile', () => {
  let origBuddyHome, tmpDir;
  beforeEach(() => {
    origBuddyHome = process.env.BUDDY_HOME;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-paths-'));
    process.env.BUDDY_HOME = path.join(tmpDir, '.buddy');
    delete process.env.CLAUDE_PLUGIN_DATA;
  });
  afterEach(() => {
    if (origBuddyHome === undefined) delete process.env.BUDDY_HOME;
    else process.env.BUDDY_HOME = origBuddyHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns path ending with buddy-session.json', () => {
    const file = resolveBuddySessionFile('/some/repo');
    assert.ok(file.endsWith('buddy-session.json'), `got: ${file}`);
  });

  test('parent dir matches resolveStateDir', () => {
    const file = resolveBuddySessionFile('/some/repo');
    const dir = resolveStateDir('/some/repo');
    assert.equal(path.dirname(file), dir);
  });
});
