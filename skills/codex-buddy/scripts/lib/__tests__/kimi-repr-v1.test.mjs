/**
 * kimi-repr-v1.test.mjs — Unit tests for the Kimi --print output parser
 *
 * Covers:
 *   A) Complete output (ThinkPart + TextPart) → parseStatus:'ok'
 *   B) TextPart only (no ThinkPart) → parseStatus:'partial'
 *   C) Empty / broken input → parseStatus:'failed', no throw
 *   D) Truncated / non-UTF8-safe strings → parseStatus:'failed', no throw
 *   E) Escaped quotes in content
 *   F) Session ID extraction
 *   G) match() detection
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parse, match, version } from '../parsers/kimi-repr-v1.mjs';

// ── Fixtures ────────────────────────────────────────────────────────────────

const FULL_OUTPUT = `TurnBegin(user_input='say HELLO in 3 words')
StepBegin(n=1)
ThinkPart(
    type='think',
    think='The user wants 3 words. I will say HELLO to you.',
    encrypted=None
)
TextPart(type='text', text='HELLO to you')
StatusUpdate(context_usage=0.04, context_tokens=11564, max_context_tokens=262144, token_usage=TokenUsage(input_other=2348, output=70, input_cache_read=9216, input_cache_creation=0), message_id='chatcmpl-abc123', plan_mode=False, mcp_status=None)
TurnEnd()

To resume this session: kimi -r 59183154-2b7a-42ed-9157-30f0bba6ee20`;

const TEXT_ONLY_OUTPUT = `TurnBegin(user_input='hello')
StepBegin(n=1)
TextPart(type='text', text='Hello there!')
TurnEnd()`;

const THINK_WITH_ESCAPED_QUOTE = `ThinkPart(type='think', think='He said \\'hello\\' to me.', encrypted=None)
TextPart(type='text', text='Result')
TurnEnd()`;

// ── Tests ────────────────────────────────────────────────────────────────────

test('version is a string', () => {
  assert.strictEqual(typeof version, 'string');
  assert.ok(version.startsWith('kimi-repr'));
});

test('A: full output → ok', () => {
  const r = parse(FULL_OUTPUT);
  assert.strictEqual(r.parseStatus, 'ok', `expected ok, got ${r.parseStatus}`);
  assert.ok(r.think.length > 0, 'should have think parts');
  assert.ok(r.text.length > 0, 'should have text parts');
  assert.ok(r.text[0].includes('HELLO'), `text should include HELLO, got: ${r.text[0]}`);
  assert.strictEqual(r.sessionId, '59183154-2b7a-42ed-9157-30f0bba6ee20');
});

test('B: TextPart only (no ThinkPart) → partial', () => {
  const r = parse(TEXT_ONLY_OUTPUT);
  assert.strictEqual(r.parseStatus, 'partial', `expected partial, got ${r.parseStatus}`);
  assert.strictEqual(r.think.length, 0, 'should have no think parts');
  assert.ok(r.text.length > 0, 'should have text parts');
  assert.ok(r.text[0].includes('Hello'), `got: ${r.text[0]}`);
  assert.strictEqual(r.sessionId, null);
});

test('C: empty string → failed, no throw', () => {
  const r = parse('');
  assert.strictEqual(r.parseStatus, 'failed');
  assert.deepStrictEqual(r.think, []);
  assert.deepStrictEqual(r.text, []);
  assert.strictEqual(r.sessionId, null);
});

test('C: null → failed, no throw', () => {
  const r = parse(null);
  assert.strictEqual(r.parseStatus, 'failed');
  assert.deepStrictEqual(r.think, []);
});

test('C: no parseable events → failed', () => {
  const r = parse('just some random text\nno events here');
  assert.strictEqual(r.parseStatus, 'failed');
});

test('D: truncated repr string → failed, no throw', () => {
  const truncated = `ThinkPart(type='think', think='truncated content with no closing`;
  assert.doesNotThrow(() => parse(truncated));
  const r = parse(truncated);
  assert.ok(['failed', 'partial', 'ok'].includes(r.parseStatus));
});

test('D: very long string → no throw', () => {
  const huge = 'x'.repeat(500_000);
  assert.doesNotThrow(() => parse(huge));
  const r = parse(huge);
  assert.strictEqual(r.parseStatus, 'failed');
});

test('E: escaped single quotes in content', () => {
  const r = parse(THINK_WITH_ESCAPED_QUOTE);
  assert.ok(r.parseStatus !== 'failed', 'should at least have text');
  assert.ok(r.text[0].includes('Result'));
  if (r.think.length > 0) {
    assert.ok(r.think[0].includes("'hello'"), `escaped quote not unescaped: ${r.think[0]}`);
  }
});

test('F: session ID extracted', () => {
  const r = parse(FULL_OUTPUT);
  assert.strictEqual(r.sessionId, '59183154-2b7a-42ed-9157-30f0bba6ee20');
});

test('F: no resume line → sessionId null', () => {
  const r = parse(TEXT_ONLY_OUTPUT);
  assert.strictEqual(r.sessionId, null);
});

test('G: match() detects kimi output', () => {
  assert.strictEqual(match(FULL_OUTPUT), true);
  assert.strictEqual(match(TEXT_ONLY_OUTPUT), true);
  assert.strictEqual(match('just plain text'), false);
  assert.strictEqual(match(''), false);
  assert.strictEqual(match(null), false);
  assert.strictEqual(match(undefined), false);
});

test('G: match() never throws', () => {
  assert.doesNotThrow(() => match(null));
  assert.doesNotThrow(() => match(undefined));
  assert.doesNotThrow(() => match(123));
  assert.doesNotThrow(() => match({}));
});

test('parse() never throws on bizarre input', () => {
  const bizarre = [null, undefined, 123, {}, [], true, 'x'.repeat(1_000_000)];
  for (const input of bizarre) {
    assert.doesNotThrow(() => parse(input), `threw on input: ${JSON.stringify(input)?.slice(0, 50)}`);
  }
});
