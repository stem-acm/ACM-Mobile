import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  buildPath,
  createApiClient,
  describeError,
  isCannotVerify,
  kindForStatus,
  parseEnvelope,
} from '../src/js/api.js';

const envelope = (data, extra = {}) => JSON.stringify({ success: true, message: 'ok', data, ...extra });

/** A fake fetch that records the calls and answers with `respond(url, init)`. */
function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  fn.calls = calls;
  return fn;
}

function client(respond, options = {}) {
  const fetchImpl = fakeFetch(respond);
  const authFailures = [];
  const serverTimes = [];
  const api = createApiClient({
    baseUrl: 'https://api.example.org',
    getToken: () => 'tok',
    fetchImpl,
    onAuthFailure: (kind) => authFailures.push(kind),
    onServerTime: (t) => serverTimes.push(t),
    ...options,
  });
  return { api, fetchImpl, authFailures, serverTimes };
}

const status = (code, body = JSON.stringify({ success: false, message: `status ${code}`, data: null })) =>
  () => new Response(body, { status: code });

test('status → kind mapping of plan M4', () => {
  assert.equal(kindForStatus(200), null);
  assert.equal(kindForStatus(201), null);
  assert.equal(kindForStatus(401), 'unauthorized');
  assert.equal(kindForStatus(403), 'forbidden');
  assert.equal(kindForStatus(429), 'rate_limited');
  assert.equal(kindForStatus(400), 'invalid');
  assert.equal(kindForStatus(404), 'invalid');
  assert.equal(kindForStatus(422), 'invalid');
  assert.equal(kindForStatus(500), 'server');
  assert.equal(kindForStatus(502), 'server');
  assert.equal(kindForStatus(503), 'server');
});

test('parseEnvelope reads success, data, pagination, message', () => {
  assert.deepEqual(parseEnvelope(envelope({ a: 1 }, { pagination: { total: 3 } })), {
    success: true,
    data: { a: 1 },
    pagination: { total: 3 },
    message: 'ok',
  });
  assert.equal(parseEnvelope('<html>proxy error</html>'), null);
  assert.equal(parseEnvelope('{"data":1}'), null);
  assert.equal(parseEnvelope(''), null);
  assert.equal(parseEnvelope('null'), null);
});

test('buildPath adds the query and skips empty values', () => {
  assert.equal(buildPath('/api/checkins/in-room', { limit: 20, before: null }), '/api/checkins/in-room?limit=20');
  assert.equal(buildPath('/a', { limit: 20, before: 1001 }), '/a?limit=20&before=1001');
  assert.equal(buildPath('/a', undefined), '/a');
  assert.equal(buildPath('/a?x=1', { y: 2 }), '/a?x=1&y=2');
});

test('200: returns data and pagination; Bearer header, credentials omit, base URL', async () => {
  const { api, fetchImpl } = client(() => new Response(envelope({ checkins: [] }, { pagination: { total: 0, nextBefore: null } })));
  const result = await api.request('GET', '/api/checkins/in-room', { query: { limit: 20 } });
  assert.deepEqual(result.data, { checkins: [] });
  assert.deepEqual(result.pagination, { total: 0, nextBefore: null });
  const [{ url, init }] = fetchImpl.calls;
  assert.equal(url, 'https://api.example.org/api/checkins/in-room?limit=20');
  assert.equal(init.method, 'GET');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.body, undefined);
});

test('a JSON body is sent with its content type', async () => {
  const { api, fetchImpl } = client(() => new Response(envelope({ token: 't' })));
  await api.request('POST', '/api/auth/login', { body: { username: 'a', password: 'b' }, auth: false });
  const { init } = fetchImpl.calls[0];
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, '{"username":"a","password":"b"}');
  assert.equal(init.headers.Authorization, undefined, 'auth: false sends no token');
});

test('serverTime of a response goes to onServerTime', async () => {
  const { api, serverTimes } = client(() => new Response(envelope({ serverTime: '2026-11-20T07:30:00.000Z' })));
  await api.request('GET', '/api/checkins/in-room');
  assert.deepEqual(serverTimes, ['2026-11-20T07:30:00.000Z']);
});

for (const [code, kind] of [[401, 'unauthorized'], [403, 'forbidden']]) {
  test(`${code} with auth: the 401/403 rule runs, then ${kind} is thrown`, async () => {
    const { api, authFailures } = client(status(code));
    await assert.rejects(api.request('GET', '/api/checkins/in-room'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, kind);
      assert.equal(error.status, code);
      assert.equal(error.message, `status ${code}`);
      return true;
    });
    assert.deepEqual(authFailures, [kind]);
  });

  test(`${code} with auth: false (login) does not run the rule`, async () => {
    const { api, authFailures } = client(status(code));
    await assert.rejects(api.request('POST', '/api/auth/login', { auth: false, body: {} }), { kind });
    assert.deepEqual(authFailures, []);
  });
}

for (const [code, kind] of [[429, 'rate_limited'], [422, 'invalid'], [404, 'invalid'], [500, 'server'], [503, 'server']]) {
  test(`${code} gives ${kind} and no auth rule`, async () => {
    const { api, authFailures } = client(status(code));
    await assert.rejects(api.request('POST', '/api/checkins/verify', { body: {} }), { kind, status: code });
    assert.deepEqual(authFailures, []);
  });
}

test('a 5xx with an HTML body (proxy) is a server error', async () => {
  const { api } = client(status(502, '<html>Bad gateway</html>'));
  await assert.rejects(api.request('GET', '/api/x'), { kind: 'server', status: 502 });
});

test('a 200 that is not the envelope (captive portal) is a server error', async () => {
  const { api } = client(() => new Response('<html>Login to Wi-Fi</html>', { status: 200 }));
  await assert.rejects(api.request('GET', '/api/x'), { kind: 'server' });
});

test('a 200 with success: false is a server error', async () => {
  const { api } = client(() => new Response('{"success":false,"message":"no","data":null}', { status: 200 }));
  await assert.rejects(api.request('GET', '/api/x'), { kind: 'server', message: 'no' });
});

test('fetch rejects (offline, DNS, CORS) → network', async () => {
  const { api } = client(() => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(api.request('GET', '/api/x'), { kind: 'network' });
});

test('no answer in time → timeout (the request is aborted)', async () => {
  let aborted = false;
  const { api } = client((url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    })
  );
  await assert.rejects(api.request('GET', '/api/x', { timeoutMs: 20 }), { kind: 'timeout' });
  assert.equal(aborted, true);
});

test('the caller signal aborts → aborted, not network', async () => {
  const controller = new AbortController();
  const { api } = client((url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })
  );
  const pending = api.request('GET', '/api/x', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { kind: 'aborted' });
});

test('blob response type returns the blob; a 401 on a photo runs the rule', async () => {
  const { api, authFailures } = client((url) =>
    url.endsWith('/uploads/members/a.jpg')
      ? new Response(new Blob(['img'], { type: 'image/jpeg' }))
      : new Response('{"success":false,"message":"x","data":null}', { status: 401 })
  );
  const blob = await api.request('GET', '/uploads/members/a.jpg', { responseType: 'blob' });
  assert.equal(await blob.text(), 'img');
  await assert.rejects(api.request('GET', '/uploads/members/b.jpg', { responseType: 'blob' }), { kind: 'unauthorized' });
  assert.deepEqual(authFailures, ['unauthorized']);
});

test('stream response type returns the response with an event-stream Accept header', async () => {
  const { api, fetchImpl } = client(() => new Response('data: {}\n\n', { status: 200 }));
  const response = await api.request('GET', '/api/sse/checkins', { responseType: 'stream', timeoutMs: 0 });
  assert.equal(await response.text(), 'data: {}\n\n');
  assert.equal(fetchImpl.calls[0].init.headers.Accept, 'text/event-stream');
});

test('urlWithToken puts the token in ?auth= (EventSource fallback only)', () => {
  const { api } = client(() => new Response(''));
  assert.equal(api.urlWithToken('/api/sse/checkins'), 'https://api.example.org/api/sse/checkins?auth=tok');
});

test('isCannotVerify: 429, 5xx, timeout, network; not 401/403/422', () => {
  for (const kind of ['rate_limited', 'server', 'timeout', 'network']) {
    assert.equal(isCannotVerify(new ApiError(kind)), true, kind);
  }
  for (const kind of ['unauthorized', 'forbidden', 'invalid', 'aborted']) {
    assert.equal(isCannotVerify(new ApiError(kind)), false, kind);
  }
  assert.equal(isCannotVerify(new Error('x')), false);
});

test('describeError gives a text for each kind', () => {
  assert.match(describeError(new ApiError('network')), /Cannot reach iPass/);
  assert.match(describeError(new ApiError('timeout')), /Cannot reach iPass/);
  assert.match(describeError(new ApiError('rate_limited')), /Too many/);
  assert.match(describeError(new ApiError('server')), /did not answer/);
});
