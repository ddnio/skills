// Validates that what appendLog writes conforms to schemas/audit-row-v2.schema.json,
// and that the schema rejects malformed rows (negative tests).
//
// Hand-rolled JSON-Schema-subset validator (no ajv dep) — implements: required,
// type, enum, const, minimum, format:date-time, array items, additionalProperties.
// Rationale (Codex F4): keep all-Node-stdlib for marketplace single-skill tool.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';

import { appendLog } from '../audit.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '../../../schemas/audit-row-v2.schema.json');

function loadSchema() { return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')); }

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function typeOK(val, expected) {
  const types = Array.isArray(expected) ? expected : [expected];
  for (const t of types) {
    if (t === 'null' && val === null) return true;
    if (t === 'string' && typeof val === 'string') return true;
    if (t === 'integer' && Number.isInteger(val)) return true;
    if (t === 'number' && typeof val === 'number' && Number.isFinite(val)) return true;
    if (t === 'boolean' && typeof val === 'boolean') return true;
    if (t === 'array' && Array.isArray(val)) return true;
    if (t === 'object' && val && typeof val === 'object' && !Array.isArray(val)) return true;
  }
  return false;
}

function checkValue(val, prop, fieldPath) {
  const errs = [];
  if (prop.type !== undefined && !typeOK(val, prop.type)) {
    errs.push(`${fieldPath} type mismatch: expected ${prop.type}, got ${val === null ? 'null' : typeof val}`);
    return errs;
  }
  if (prop.enum && !prop.enum.includes(val)) errs.push(`${fieldPath} enum mismatch: ${JSON.stringify(val)} not in ${JSON.stringify(prop.enum)}`);
  if (prop.const !== undefined && val !== prop.const) errs.push(`${fieldPath} const mismatch: expected ${prop.const}, got ${val}`);
  if (prop.minimum !== undefined && typeof val === 'number' && val < prop.minimum) errs.push(`${fieldPath} minimum violated: ${val} < ${prop.minimum}`);
  if (prop.minLength !== undefined && typeof val === 'string' && val.length < prop.minLength) errs.push(`${fieldPath} minLength violated`);
  if (prop.format === 'date-time' && typeof val === 'string' && !ISO_DATE_TIME.test(val)) errs.push(`${fieldPath} format date-time violated: ${val}`);
  if (prop.items && Array.isArray(val)) {
    val.forEach((item, i) => { errs.push(...checkValue(item, prop.items, `${fieldPath}[${i}]`)); });
  }
  return errs;
}

export function assertValidAuditRowV2(row, schema = loadSchema()) {
  const errors = [];
  for (const req of schema.required || []) {
    if (!(req in row)) errors.push(`missing required: ${req}`);
  }
  for (const [k, v] of Object.entries(row)) {
    const prop = schema.properties[k];
    if (!prop) {
      if (schema.additionalProperties === false) errors.push(`unknown field: ${k}`);
      continue;
    }
    errors.push(...checkValue(v, prop, k));
  }
  return errors;
}

describe('audit-row-v2.schema.json conformance', () => {
  let tmpDir, logFile;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-schema-'));
    logFile = path.join(tmpDir, 'logs.jsonl');
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  test('appendLog probe row conforms to v2 schema', () => {
    appendLog(logFile, {
      envelope: { turn: 1, level: 'V2', rule: 'r', triggered: true, route: 'codex', evidence: ['ok'], conclusion: 'proceed' },
      buddySessionId: 'buddy-001', workspace: '/tmp', action: 'probe', verificationTaskId: 'vtask-x', latencyMs: 100,
    });
    const row = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    const errs = assertValidAuditRowV2(row);
    assert.deepEqual(errs, [], `must conform; got: ${errs.join('; ')}`);
  });

  test('appendLog local row conforms', () => {
    appendLog(logFile, {
      envelope: { turn: 0, level: 'V2', rule: 'manual', triggered: true, route: 'local', evidence: [], conclusion: 'proceed' },
      buddySessionId: 'buddy-002', workspace: '/tmp', action: 'local', verificationTaskId: 'vtask-l',
    });
    const row = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    const errs = assertValidAuditRowV2(row);
    assert.deepEqual(errs, [], `local must conform; got: ${errs.join('; ')}`);
  });

  // Negative tests — schema must catch malformed rows.
  test('rejects row missing v2 metadata (e.g. legacy row)', () => {
    const legacy = { turn: 1, level: 'V2', rule: 'r', triggered: true, route: 'codex', evidence: [], conclusion: 'proceed',
                     session_id: 'old', timestamp: '2026-01-01T00:00:00Z' };
    const errs = assertValidAuditRowV2(legacy);
    assert.ok(errs.some(e => e.includes('missing required: schema_version')), 'must require schema_version');
    assert.ok(errs.some(e => e.includes('missing required: ts')), 'must require ts');
    assert.ok(errs.some(e => e.includes('missing required: buddy_session_id')), 'must require buddy_session_id');
    assert.ok(errs.some(e => e.includes('unknown field: session_id')), 'session_id is now an unknown field');
    assert.ok(errs.some(e => e.includes('unknown field: timestamp')), 'timestamp is now an unknown field');
  });

  test('rejects row with negative turn', () => {
    const row = {
      schema_version: 2, ts: '2026-04-30T00:00:00.000Z', buddy_session_id: 's', verification_task_id: 'v',
      workspace: '/w', action: 'probe',
      turn: -1, level: 'V2', rule: 'r', triggered: true, route: 'codex', evidence: [], conclusion: 'proceed',
    };
    const errs = assertValidAuditRowV2(row);
    assert.ok(errs.some(e => e.includes('turn minimum violated')), `expected turn minimum error; got: ${errs.join(';')}`);
  });

  test('rejects row with malformed ts', () => {
    const row = {
      schema_version: 2, ts: 'not-a-date', buddy_session_id: 's', verification_task_id: 'v',
      workspace: '/w', action: 'probe',
      turn: 0, level: 'V2', rule: 'r', triggered: true, route: 'codex', evidence: [], conclusion: 'proceed',
    };
    const errs = assertValidAuditRowV2(row);
    assert.ok(errs.some(e => e.includes('ts format date-time violated')), `expected ts format error; got: ${errs.join(';')}`);
  });

  test('rejects row with non-string evidence items', () => {
    const row = {
      schema_version: 2, ts: '2026-04-30T00:00:00.000Z', buddy_session_id: 's', verification_task_id: 'v',
      workspace: '/w', action: 'probe',
      turn: 0, level: 'V2', rule: 'r', triggered: true, route: 'codex',
      evidence: [123, 'ok'], conclusion: 'proceed',
    };
    const errs = assertValidAuditRowV2(row);
    assert.ok(errs.some(e => e.includes('evidence[0] type mismatch')), `expected evidence[0] type error; got: ${errs.join(';')}`);
  });

  test('rejects row with bad enum (action)', () => {
    const row = {
      schema_version: 2, ts: '2026-04-30T00:00:00.000Z', buddy_session_id: 's', verification_task_id: 'v',
      workspace: '/w', action: 'bogus',
      turn: 0, level: 'V2', rule: 'r', triggered: true, route: 'codex', evidence: [], conclusion: 'proceed',
    };
    const errs = assertValidAuditRowV2(row);
    assert.ok(errs.some(e => e.includes('action enum mismatch')));
  });

  test('rejects row with non-2 schema_version', () => {
    const row = {
      schema_version: 1, ts: '2026-04-30T00:00:00.000Z', buddy_session_id: 's', verification_task_id: 'v',
      workspace: '/w', action: 'probe',
      turn: 0, level: 'V2', rule: 'r', triggered: true, route: 'codex', evidence: [], conclusion: 'proceed',
    };
    const errs = assertValidAuditRowV2(row);
    assert.ok(errs.some(e => e.includes('schema_version const mismatch')));
  });

  test('rejects row with null verification_task_id (v2 requires string)', () => {
    const row = {
      schema_version: 2, ts: '2026-04-30T00:00:00.000Z', buddy_session_id: 's', verification_task_id: null,
      workspace: '/w', action: 'probe',
      turn: 0, level: 'V2', rule: 'r', triggered: true, route: 'codex', evidence: [], conclusion: 'proceed',
    };
    const errs = assertValidAuditRowV2(row);
    assert.ok(errs.some(e => e.includes('verification_task_id type mismatch')));
  });
});
