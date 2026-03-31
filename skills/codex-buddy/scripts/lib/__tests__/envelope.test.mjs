import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvelope } from '../envelope.mjs';

describe('envelope', () => {
  test('creates envelope with all required fields', () => {
    const env = createEnvelope({
      turn: 18,
      level: 'V2',
      rule: 'floor:correctness',
      route: 'local',
      evidence: ['test:3 passed', 'lint:clean'],
      conclusion: 'proceed',
    });

    assert.equal(env.turn, 18);
    assert.equal(env.level, 'V2');
    assert.equal(env.triggered, true);
    assert.equal(env.route, 'local');
    assert.deepEqual(env.evidence, ['test:3 passed', 'lint:clean']);
    assert.equal(env.conclusion, 'proceed');
  });

  test('includes optional fields when provided', () => {
    const env = createEnvelope({
      turn: 5,
      level: 'V3',
      rule: 'floor:destructive',
      route: 'codex',
      evidence: ['codex: reviewed migration'],
      conclusion: 'stop',
      confidence: 'high',
      unverified: ['rollback plan'],
    });

    assert.equal(env.confidence, 'high');
    assert.deepEqual(env.unverified, ['rollback plan']);
  });

  test('defaults unverified to empty array', () => {
    const env = createEnvelope({
      turn: 1, level: 'V2', rule: 'vlevel:V2',
      route: 'local', evidence: [], conclusion: 'proceed',
    });

    assert.deepEqual(env.unverified, []);
  });
});
