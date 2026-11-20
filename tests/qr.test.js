import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPEAT_WINDOW_MS, createScanMemory, parseBadge } from '../src/js/qr.js';

const SIG = 'a3f1'.repeat(16); // 64 hexadecimal characters, as HMAC-SHA256 hex
const qr = (value) => JSON.stringify(value);

test('parseBadge: valid iPass badge', () => {
  assert.deepEqual(parseBadge(qr({ registrationNumber: 42, signature: SIG })), {
    registrationNumber: 42,
    signature: SIG,
  });
});

test('parseBadge: spaces around the JSON and extra fields are accepted, only the two fields are kept', () => {
  assert.deepEqual(parseBadge(`  ${qr({ registrationNumber: 7, signature: SIG.toUpperCase(), v: 1 })}\n`), {
    registrationNumber: 7,
    signature: SIG.toUpperCase(),
  });
});

for (const [name, raw] of [
  ['plain number (legacy badge)', '42'],
  ['number as JSON text', qr(42)],
  ['URL', 'https://example.org/badge/42'],
  ['Wi-Fi code', 'WIFI:S:club;T:WPA;P:secret;;'],
  ['empty text', ''],
  ['JSON null', 'null'],
  ['JSON array', qr([42, SIG])],
  ['JSON without signature', qr({ registrationNumber: 42 })],
  ['JSON without number', qr({ signature: SIG })],
  ['registrationNumber as a string', qr({ registrationNumber: '42', signature: SIG })],
  ['registrationNumber 0', qr({ registrationNumber: 0, signature: SIG })],
  ['registrationNumber negative', qr({ registrationNumber: -3, signature: SIG })],
  ['registrationNumber float', qr({ registrationNumber: 4.2, signature: SIG })],
  ['registrationNumber too large', '{"registrationNumber":1e20,"signature":"' + SIG + '"}'],
  ['signature of 63 characters', qr({ registrationNumber: 42, signature: SIG.slice(1) })],
  ['signature of 65 characters', qr({ registrationNumber: 42, signature: SIG + 'a' })],
  ['signature not hexadecimal', qr({ registrationNumber: 42, signature: 'z'.repeat(64) })],
  ['signature empty', qr({ registrationNumber: 42, signature: '' })],
  ['signature as a number', qr({ registrationNumber: 42, signature: 123 })],
  ['broken JSON', '{"registrationNumber":42,'],
]) {
  test(`parseBadge: ${name} → null (4d without a network call)`, () => {
    assert.equal(parseBadge(raw), null);
  });
}

test('parseBadge: a value that is not a string → null', () => {
  assert.equal(parseBadge(undefined), null);
  assert.equal(parseBadge({ registrationNumber: 42, signature: SIG }), null);
});

test('scan memory: window is 3 s', () => {
  assert.equal(REPEAT_WINDOW_MS, 3000);
});

test('scan memory: same text at 2.9 s ignored, at 3.1 s accepted', () => {
  const memory = createScanMemory();
  assert.equal(memory.accept('A', 10000), true);
  assert.equal(memory.accept('A', 10100), false);
  assert.equal(memory.accept('A', 12900), false);
  assert.equal(memory.accept('A', 13100), true);
});

test('scan memory: another text at 1 s is accepted at once', () => {
  const memory = createScanMemory();
  assert.equal(memory.accept('A', 0), true);
  assert.equal(memory.accept('B', 1000), true);
  // B is now the last text: A again is accepted, B again is not.
  assert.equal(memory.accept('B', 1500), false);
  assert.equal(memory.accept('A', 2000), true);
});

test('scan memory: exactly 3 s later is accepted', () => {
  const memory = createScanMemory();
  assert.equal(memory.accept('A', 0), true);
  assert.equal(memory.accept('A', 2999), false);
  assert.equal(memory.accept('A', 3000), true);
});

test('scan memory: every code is ignored while a verification runs, and not remembered', () => {
  const memory = createScanMemory();
  memory.setBusy(true);
  assert.equal(memory.busy, true);
  assert.equal(memory.accept('A', 0), false);
  assert.equal(memory.accept('B', 10), false);
  memory.setBusy(false);
  assert.equal(memory.accept('B', 20), true, 'B was not remembered while busy');
});

test('scan memory: the memory survives "Scan next" (no reset between scans)', () => {
  const memory = createScanMemory();
  assert.equal(memory.accept('A', 0), true);
  memory.setBusy(true); // verification
  memory.setBusy(false); // result shown, then "Scan next"
  assert.equal(memory.accept('A', 1500), false);
});

test('scan memory: reset forgets the last text', () => {
  const memory = createScanMemory();
  memory.accept('A', 0);
  memory.reset();
  assert.equal(memory.accept('A', 100), true);
});

test('scan memory: a custom window', () => {
  const memory = createScanMemory({ windowMs: 500 });
  assert.equal(memory.accept('A', 0), true);
  assert.equal(memory.accept('A', 499), false);
  assert.equal(memory.accept('A', 500), true);
});
