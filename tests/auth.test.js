import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/js/api.js';
import {
  LoginError,
  MESSAGES,
  handleAuthFailure,
  hasVerifyPermission,
  initAuth,
  isSessionActive,
  login,
  onSessionEnd,
  restore,
  signOut,
} from '../src/js/auth.js';

const user = (verify) => ({ id: 1, username: 'v', role: 'volunteer', permissions: { 'checkins.verify': verify } });

function setup({ token = null, respond }) {
  const storage = {
    token,
    getToken() { return this.token; },
    async setToken(value) { this.token = value; },
    async clearToken() { this.token = null; },
  };
  const screens = [];
  const calls = [];
  const api = {
    request: async (method, path, options = {}) => {
      calls.push({ method, path, options });
      return respond(method, path, options);
    },
  };
  initAuth({ api, storage, go: async (screen, params = {}) => screens.push([screen, params]) });
  return { storage, screens, calls };
}

const fail = (kind, status = 0) => () => {
  throw new ApiError(kind, { status });
};

test('hasVerifyPermission reads permissions["checkins.verify"]', () => {
  assert.equal(hasVerifyPermission(user(true)), true);
  assert.equal(hasVerifyPermission(user(false)), false);
  assert.equal(hasVerifyPermission({ permissions: {} }), false);
  assert.equal(hasVerifyPermission(null), false);
});

test('restore: no token → Login, no request', async () => {
  const t = setup({ respond: () => assert.fail('no request') });
  assert.deepEqual(await restore(), { screen: 'login', params: {} });
  assert.equal(t.calls.length, 0);
});

test('restore: token with the permission → list', async () => {
  const t = setup({ token: 'tok', respond: () => ({ data: user(true) }) });
  assert.deepEqual(await restore(), { screen: 'list', params: {} });
  assert.equal(t.calls[0].path, '/api/auth/token');
  assert.equal(t.storage.token, 'tok');
  assert.equal(isSessionActive(), true);
});

test('restore: token without the permission → token dropped, 1b', async () => {
  const t = setup({ token: 'tok', respond: () => ({ data: user(false) }) });
  assert.deepEqual(await restore(), {
    screen: 'accessDenied',
    params: { user: { username: 'v', role: 'volunteer' } },
  });
  assert.equal(t.storage.token, null);
});

test('restore: 401 → token dropped, Login "Session expired"', async () => {
  const t = setup({ token: 'tok', respond: fail('unauthorized', 401) });
  assert.deepEqual(await restore(), { screen: 'login', params: { message: 'Session expired' } });
  assert.equal(t.storage.token, null);
  assert.deepEqual(t.screens, [], 'restore returns the screen; the 401 rule does not navigate');
});

test('restore: network error → list, token kept', async () => {
  const t = setup({ token: 'tok', respond: fail('network') });
  assert.deepEqual(await restore(), { screen: 'list', params: { offline: true } });
  assert.equal(t.storage.token, 'tok');
});

test('login: 200 with the permission stores the token → list', async () => {
  const t = setup({ respond: () => ({ data: { token: 'new', user: user(true) } }) });
  assert.deepEqual(await login('v', 'pw'), { screen: 'list', params: {} });
  assert.equal(t.storage.token, 'new');
  assert.deepEqual(t.calls[0].options, { body: { username: 'v', password: 'pw' }, auth: false });
});

test('login: 200 without the permission → 1b, token not stored', async () => {
  const intern = { ...user(false), username: 'intern', role: 'intern' };
  const t = setup({ respond: () => ({ data: { token: 'new', user: intern } }) });
  assert.deepEqual(await login('intern', 'pw'), {
    screen: 'accessDenied',
    params: { user: { username: 'intern', role: 'intern' } },
  });
  assert.equal(t.storage.token, null);
});

for (const [kind, status, text] of [
  ['unauthorized', 401, MESSAGES.invalid],
  ['invalid', 404, MESSAGES.invalid],
  ['forbidden', 403, MESSAGES.inactive],
  ['rate_limited', 429, MESSAGES.rateLimited],
  ['invalid', 422, MESSAGES.empty],
  ['network', 0, MESSAGES.network],
  ['timeout', 0, MESSAGES.network],
  ['server', 500, MESSAGES.server],
]) {
  test(`login: ${status || kind} → "${text}"`, async () => {
    setup({ respond: fail(kind, status) });
    await assert.rejects(login('v', 'pw'), (error) => error instanceof LoginError && error.message === text);
  });
}

test('401 during the session → end hooks, token deleted, Login "Session expired", once', async () => {
  const t = setup({ respond: () => ({ data: { token: 'new', user: user(true) } }) });
  await login('v', 'pw');
  let hooks = 0;
  const off = onSessionEnd(() => hooks++);
  handleAuthFailure('unauthorized');
  handleAuthFailure('unauthorized'); // four photos fail together
  await new Promise((r) => setImmediate(r));
  assert.equal(t.storage.token, null);
  assert.equal(hooks, 1);
  assert.deepEqual(t.screens, [['login', { message: 'Session expired' }]]);
  off();
});

test('403 during the session → token deleted, screen 1b', async () => {
  const t = setup({ respond: () => ({ data: { token: 'new', user: user(true) } }) });
  await login('v', 'pw');
  handleAuthFailure('forbidden');
  await new Promise((r) => setImmediate(r));
  assert.equal(t.storage.token, null);
  assert.deepEqual(t.screens, [['accessDenied', { user: { username: 'v', role: 'volunteer' } }]]);
});

test('signOut → token deleted, Login without a message', async () => {
  const t = setup({ respond: () => ({ data: { token: 'new', user: user(true) } }) });
  await login('v', 'pw');
  await signOut();
  assert.equal(t.storage.token, null);
  assert.deepEqual(t.screens, [['login', {}]]);
  assert.equal(isSessionActive(), false);
});
