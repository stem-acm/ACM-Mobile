import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApiClient } from '../src/js/api.js';
import {
  VERIFY_PATH,
  VERIFY_TIMEOUT_MS,
  isVerifyData,
  localInvalidResult,
  notABadgeParams,
  paramsForError,
  variantOf,
  verifyBadge,
} from '../src/js/verify.js';
import { feedbackFor } from '../src/js/feedback.js';
import { retryVerify } from '../src/js/screens/result.js';
import { cannotVerify, fixtureBadge, simulatedScans, verifyResults } from '../src/js/fixtures.js';

const badge = { registrationNumber: 42, signature: 'b'.repeat(64) };

/** A request function backed by the real API client and a fake fetch. */
function client(respond) {
  const calls = [];
  const authFailures = [];
  const api = createApiClient({
    baseUrl: 'https://api.example.org',
    getToken: () => 'tok',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
      return respond(url, init, calls.length);
    },
    onAuthFailure: (kind) => authFailures.push(kind),
  });
  return { request: api.request, calls, authFailures };
}

const ok = (data) => new Response(JSON.stringify({ success: true, message: 'Badge verified', data }), { status: 200 });
const fail = (status) =>
  new Response(JSON.stringify({ success: false, message: `status ${status}`, data: null }), { status });

// ---------------------------------------------------------------- 200: one variant per status

for (const [status, variant] of [
  ['CHECKED_IN', '4a'],
  ['NOT_CHECKED_IN', '4b'],
  ['NO_SLOT', '4c'],
  ['INVALID_BADGE', '4d'],
]) {
  test(`verify: 200 ${status} → result ${variant} with the server data`, async () => {
    const t = client(() => ok(verifyResults[status]));
    const params = await verifyBadge(t.request, badge);
    assert.deepEqual(params, { result: verifyResults[status], badge });
    assert.equal(variantOf(params), variant);
  });
}

test('verify: POST /api/checkins/verify with the badge, the token and an 8 s timeout', async () => {
  const t = client(() => ok(verifyResults.CHECKED_IN));
  await verifyBadge(t.request, badge);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, `https://api.example.org${VERIFY_PATH}`);
  assert.equal(t.calls[0].init.method, 'POST');
  assert.equal(t.calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(t.calls[0].body, { registrationNumber: 42, signature: badge.signature });
  assert.equal(VERIFY_TIMEOUT_MS, 8000);
});

test('verify: INVALID_BADGE of the backend keeps the schedule fields, member/slot/checkIn null', async () => {
  const t = client(() => ok(verifyResults.INVALID_BADGE));
  const params = await verifyBadge(t.request, badge);
  assert.equal(params.result.member, null);
  assert.equal(params.result.slot, null);
  assert.ok(Array.isArray(params.result.todaySlots));
});

// ---------------------------------------------------------------- Errors

for (const [name, respond, kind] of [
  ['429 (60 per minute per user)', () => fail(429), 'rate_limited'],
  ['500', () => fail(500), 'server'],
  ['502 with an HTML body', () => new Response('<html>Bad gateway</html>', { status: 502 }), 'server'],
  ['network error', () => { throw new TypeError('Failed to fetch'); }, 'network'],
]) {
  test(`verify: ${name} → 4e "Cannot verify" with the scanned badge, no status`, async () => {
    const t = client(respond);
    const params = await verifyBadge(t.request, badge);
    assert.deepEqual(params, { error: true, kind, badge });
    assert.equal(variantOf(params), '4e');
    assert.equal(params.result, undefined, '4e never carries a status');
  });
}

test('verify: timeout → 4e', async () => {
  const t = client((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const params = await verifyBadge(t.request, badge, { timeoutMs: 20 });
  assert.deepEqual(params, { error: true, kind: 'timeout', badge });
});

test('verify: 200 with an unknown status or a broken body → 4e (never a guessed status)', async () => {
  for (const data of [{ status: 'MAYBE' }, null, { status: 'CHECKED_IN', member: null }, { status: 'CHECKED_IN', member: { registrationNumber: 42 }, slot: null }]) {
    const t = client(() => ok(data));
    assert.deepEqual(await verifyBadge(t.request, badge), { error: true, kind: 'server', badge });
  }
});

test('verify: 422 → 4d decided by the app', async () => {
  const t = client(() => fail(422));
  const params = await verifyBadge(t.request, badge);
  assert.equal(variantOf(params), '4d');
  assert.equal(params.result.status, 'INVALID_BADGE');
  assert.equal(params.result.member, null);
});

for (const [status, kind] of [[401, 'unauthorized'], [403, 'forbidden']]) {
  test(`verify: ${status} → null (the 401/403 rule navigates), onAuthFailure("${kind}")`, async () => {
    const t = client(() => fail(status));
    assert.equal(await verifyBadge(t.request, badge), null);
    assert.deepEqual(t.authFailures, [kind]);
  });
}

test('verify: aborted (scanner left) → null', async () => {
  const controller = new AbortController();
  const t = client((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const pending = verifyBadge(t.request, badge, { signal: controller.signal });
  controller.abort();
  assert.equal(await pending, null);
});

test('paramsForError: each error class', () => {
  assert.deepEqual(paramsForError(new ApiError('rate_limited'), badge), { error: true, kind: 'rate_limited', badge });
  assert.deepEqual(paramsForError(new ApiError('server'), badge), { error: true, kind: 'server', badge });
  assert.deepEqual(paramsForError(new ApiError('timeout'), badge), { error: true, kind: 'timeout', badge });
  assert.deepEqual(paramsForError(new ApiError('network'), badge), { error: true, kind: 'network', badge });
  assert.deepEqual(paramsForError(new Error('boom'), badge), { error: true, kind: 'network', badge });
  assert.equal(paramsForError(new ApiError('unauthorized'), badge), null);
  assert.equal(paramsForError(new ApiError('forbidden'), badge), null);
  assert.equal(paramsForError(new ApiError('aborted'), badge), null);
  assert.equal(variantOf(paramsForError(new ApiError('invalid', { status: 422 }), badge)), '4d');
});

// ---------------------------------------------------------------- Retry (4e)

test('Retry re-sends the same badge; success → the matching variant', async () => {
  const t = client((url, init, n) => (n === 1 ? fail(503) : ok(verifyResults.NOT_CHECKED_IN)));
  const first = await verifyBadge(t.request, badge);
  assert.equal(variantOf(first), '4e');
  const second = await retryVerify(t.request, first);
  assert.equal(t.calls.length, 2);
  assert.deepEqual(t.calls[1].body, t.calls[0].body);
  assert.deepEqual(t.calls[1].body, { registrationNumber: 42, signature: badge.signature });
  assert.equal(variantOf(second), '4b');
});

test('Retry that fails again stays on 4e with the same badge', async () => {
  const t = client(() => { throw new TypeError('offline'); });
  const first = await verifyBadge(t.request, badge);
  const second = await retryVerify(t.request, first);
  assert.equal(variantOf(second), '4e');
  assert.deepEqual(second.badge, badge);
  assert.deepEqual(t.calls.map((c) => c.body), [t.calls[0].body, t.calls[0].body]);
});

test('Retry of the simulated "Offline" result sends the fixture badge', async () => {
  const t = client(() => ok(verifyResults.CHECKED_IN));
  await retryVerify(t.request, cannotVerify);
  assert.deepEqual(t.calls[0].body, { ...fixtureBadge });
});

// ---------------------------------------------------------------- Local results

test('a QR that is not a badge gives a local INVALID_BADGE (4d) without a badge', () => {
  const params = notABadgeParams();
  assert.equal(variantOf(params), '4d');
  assert.equal(params.badge, null);
  assert.deepEqual(localInvalidResult().member, null);
});

test('isVerifyData accepts every fixture result', () => {
  for (const data of Object.values(verifyResults)) assert.equal(isVerifyData(data), true, data.status);
});

test('variantOf: unknown params → null', () => {
  assert.equal(variantOf(null), null);
  assert.equal(variantOf({ result: { status: 'X' } }), null);
});

test('simulate box: six buttons in the agreed order, each to its screen', () => {
  assert.deepEqual(simulatedScans.map((s) => s.label), ['Checked in', 'Not checked', 'No slot', 'Invalid', 'Offline', 'Intern login']);
  assert.deepEqual(simulatedScans.map((s) => (s.screen === 'result' ? variantOf(s.params) : s.screen)), ['4a', '4b', '4c', '4d', '4e', 'accessDenied']);
});

test('feedback: success / error / warning haptic and high / low / neutral tone', () => {
  assert.equal(feedbackFor('4a').haptic, 'SUCCESS');
  assert.equal(feedbackFor('4b').haptic, 'ERROR');
  for (const v of ['4c', '4d', '4e']) assert.equal(feedbackFor(v).haptic, 'WARNING');
  assert.ok(feedbackFor('4a').frequency > feedbackFor('4c').frequency);
  assert.ok(feedbackFor('4b').frequency < feedbackFor('4c').frequency);
});
