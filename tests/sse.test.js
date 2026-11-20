import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/js/api.js';
import { createListStore } from '../src/js/listStore.js';
import {
  BACKOFF_MS,
  WATCHDOG_MS,
  createCheckinStream,
  createSseParser,
  parseCheckinMessage,
} from '../src/js/sse.js';

const checkin = (id) => ({
  id,
  registrationNumber: 7,
  checkInTime: '2026-11-20T06:00:00.000Z',
  checkOutTime: null,
  Member: { registrationNumber: 7, firstName: 'A', lastName: 'B', profileImage: null },
  Activity: { id: 1, name: 'Robotics' },
});
const message = (id) => `data: ${JSON.stringify({ type: 'new-checkin', data: checkin(id) })}\n\n`;

// ---------------------------------------------------------------- Parser

test('parser: one event per blank line; comments (heartbeat) skipped', () => {
  const parser = createSseParser();
  const events = parser.push('data: {"type":"connected"}\n\n:heartbeat\n\n' + message(1));
  assert.deepEqual(events.map((e) => e.data), ['{"type":"connected"}', JSON.stringify({ type: 'new-checkin', data: checkin(1) })]);
  assert.equal(events[0].event, 'message');
});

test('parser: an event split across chunks, in the middle of a line', () => {
  const parser = createSseParser();
  const text = message(2);
  const out = [];
  for (let i = 0; i < text.length; i += 7) out.push(...parser.push(text.slice(i, i + 7)));
  assert.equal(out.length, 1);
  assert.equal(parseCheckinMessage(out[0].data).id, 2);
});

test('parser: CRLF and CR line ends, CRLF split between chunks', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: a\r'), []);
  assert.deepEqual(parser.push('\n\r\n').map((e) => e.data), ['a']);
  assert.deepEqual(parser.push('data: b\r\rdata: c\n\n').map((e) => e.data), ['b', 'c']);
});

test('parser: several data lines are joined with a newline; event and id fields', () => {
  const parser = createSseParser();
  const [event] = parser.push('event: tick\nid: 9\ndata: one\ndata:two\n\n');
  assert.deepEqual(event, { event: 'tick', data: 'one\ntwo', id: '9' });
});

test('parser: an event without data is not dispatched', () => {
  assert.deepEqual(createSseParser().push('event: x\n\n'), []);
});

test('parseCheckinMessage: only new-checkin with an integer id', () => {
  assert.equal(parseCheckinMessage(JSON.stringify({ type: 'new-checkin', data: checkin(3) })).id, 3);
  assert.equal(parseCheckinMessage('{"type":"connected"}'), null);
  assert.equal(parseCheckinMessage('{"type":"new-checkin","data":{"id":"3"}}'), null);
  assert.equal(parseCheckinMessage('{"type":"new-checkin"}'), null);
  assert.equal(parseCheckinMessage('not json'), null);
});

test('live events and pages together: no duplicate by id', () => {
  const store = createListStore();
  const now = new Date('2026-11-20T08:00:00.000Z');
  store.addPage([checkin(11), checkin(10)], { total: 2, hasMore: false, nextBefore: null });
  const parser = createSseParser();
  for (const event of parser.push(message(12) + message(12) + message(11))) {
    const row = parseCheckinMessage(event.data);
    if (row) store.addLive(row, now);
  }
  assert.deepEqual(store.state.items.map((r) => r.id), [12, 11, 10]);
  assert.equal(store.state.total, 3);
});

// ---------------------------------------------------------------- Stream client

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    /** Moves the clock and runs the timers that are due, in order. */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await flush();
      }
      now = end;
    },
    get count() {
      return pending.size;
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A server whose streams the test controls. */
function fakeServer() {
  const connections = [];
  const encoder = new TextEncoder();
  async function openStream(signal) {
    const conn = { signal, closed: false };
    connections.push(conn);
    if (conn.fail) throw conn.fail;
    if (fakeServer.nextFailure) {
      const failure = fakeServer.nextFailure;
      fakeServer.nextFailure = null;
      throw failure;
    }
    const body = new ReadableStream({
      start(controller) {
        conn.send = (text) => controller.enqueue(encoder.encode(text));
        conn.end = () => controller.close();
        signal.addEventListener('abort', () => {
          conn.closed = true;
          try {
            controller.error(new DOMException('Aborted', 'AbortError'));
          } catch {
            /* already closed */
          }
        });
      },
    });
    return new Response(body);
  }
  return { connections, openStream };
}

function setup({ failures = [] } = {}) {
  const timers = fakeTimers();
  const server = fakeServer();
  const received = [];
  const states = [];
  let reconnects = 0;
  const openStream = async (signal) => {
    const failure = failures.shift();
    if (failure) {
      server.connections.push({ failed: true });
      throw failure;
    }
    return server.openStream(signal);
  };
  const stream = createCheckinStream({
    openStream,
    onCheckin: (row) => received.push(row.id),
    onReconnect: () => reconnects++,
    onState: (s) => states.push(s),
    timers,
  });
  return { timers, server, received, states, stream, reconnects: () => reconnects };
}

test('stream: delivers new check-ins, skips connected and heartbeats', async () => {
  const t = setup();
  t.stream.start();
  await flush();
  const conn = t.server.connections[0];
  conn.send('data: {"type":"connected"}\n\n');
  conn.send(':heartbeat\n\n');
  conn.send(message(5).slice(0, 10));
  conn.send(message(5).slice(10));
  await flush();
  assert.deepEqual(t.received, [5]);
  assert.equal(t.reconnects(), 0, 'the first connection is not a reconnect');
  t.stream.stop();
  await flush();
  assert.equal(conn.closed, true);
});

test('stream: reconnect after 1 s then 2 s then 5 s; onReconnect after the new connection', async () => {
  const t = setup();
  t.stream.start();
  await flush();
  assert.equal(t.server.connections.length, 1);
  t.server.connections[0].end(); // the server closes the stream
  await flush();

  fakeServer.nextFailure = new ApiError('network');
  await t.timers.advance(999);
  assert.equal(t.server.connections.length, 1, 'no attempt before 1 s');
  await t.timers.advance(1);
  assert.equal(t.server.connections.length, 2, 'attempt 1 after 1 s (fails)');

  fakeServer.nextFailure = new ApiError('timeout');
  await t.timers.advance(1999);
  assert.equal(t.server.connections.length, 2, 'no attempt before 2 s');
  await t.timers.advance(1);
  assert.equal(t.server.connections.length, 3, 'attempt 2 after 2 s (fails)');

  await t.timers.advance(4999);
  assert.equal(t.server.connections.length, 3, 'no attempt before 5 s');
  await t.timers.advance(1);
  assert.equal(t.server.connections.length, 4, 'attempt 3 after 5 s (works)');
  assert.equal(t.reconnects(), 1, 'page 1 is reloaded after the reconnect');
  t.server.connections[3].send(message(8));
  await flush();
  assert.deepEqual(t.received, [8]);

  // After a working connection the backoff starts again at 1 s.
  t.server.connections[3].end();
  await flush();
  await t.timers.advance(1000);
  assert.equal(t.server.connections.length, 5);
  assert.equal(t.reconnects(), 2);
  t.stream.stop();
});

test('stream: the wait stays at 30 s after five failures', async () => {
  const t = setup();
  t.stream.start();
  await flush();
  t.server.connections[0].end();
  await flush();
  let total = 0;
  for (const wait of [1000, 2000, 5000, 10000, 30000, 30000]) {
    fakeServer.nextFailure = new ApiError('server');
    const before = t.server.connections.length;
    await t.timers.advance(wait - 1);
    assert.equal(t.server.connections.length, before, `no attempt before ${wait} ms`);
    await t.timers.advance(1);
    assert.equal(t.server.connections.length, before + 1, `attempt after ${wait} ms`);
    total += wait;
  }
  assert.equal(total, 78000);
  assert.deepEqual(BACKOFF_MS, [1000, 2000, 5000, 10000, 30000]);
  t.stream.stop();
  assert.equal(t.timers.count, 0, 'stop cancels the planned reconnect');
});

test('stream: watchdog reconnects after 75 s without a byte; heartbeats keep it open', async () => {
  const t = setup();
  t.stream.start();
  await flush();
  const conn = t.server.connections[0];
  await t.timers.advance(30000);
  conn.send(':heartbeat\n\n');
  await flush();
  await t.timers.advance(WATCHDOG_MS - 1);
  assert.equal(conn.closed, false, 'the heartbeat restarted the watchdog');
  await t.timers.advance(1);
  assert.equal(conn.closed, true, 'no byte for 75 s: the connection is closed');
  await t.timers.advance(1000);
  assert.equal(t.server.connections.length, 2);
  t.stream.stop();
});

for (const kind of ['unauthorized', 'forbidden']) {
  test(`stream: ${kind} on connect stops without reconnect`, async () => {
    const t = setup({ failures: [new ApiError(kind)] });
    t.stream.start();
    await flush();
    await t.timers.advance(60000);
    assert.equal(t.server.connections.length, 1);
    assert.equal(t.stream.running, false);
    assert.equal(t.states.at(-1), 'stopped');
  });
}

test('stream: stop during a wait cancels the reconnect; start opens again', async () => {
  const t = setup({ failures: [new ApiError('network')] });
  t.stream.start();
  await flush();
  assert.equal(t.states.at(-1), 'waiting');
  t.stream.stop();
  await t.timers.advance(60000);
  assert.equal(t.server.connections.length, 1);
  t.stream.start();
  await flush();
  assert.equal(t.server.connections.length, 2);
  assert.equal(t.states.at(-1), 'open');
  t.stream.stop();
});

test('stream: falls back to EventSource with ?auth= when the body cannot be streamed', async () => {
  const sources = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  const timers = fakeTimers();
  const received = [];
  const stream = createCheckinStream({
    openStream: async () => ({ status: 200, body: null }),
    eventSourceUrl: () => 'https://api.example.org/api/sse/checkins?auth=tok',
    EventSourceImpl: FakeEventSource,
    onCheckin: (row) => received.push(row.id),
    timers,
  });
  stream.start();
  await flush();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://api.example.org/api/sse/checkins?auth=tok');
  sources[0].onopen();
  sources[0].onmessage({ data: JSON.stringify({ type: 'new-checkin', data: checkin(4) }) });
  assert.deepEqual(received, [4]);
  // An error closes it and uses the backoff; the next attempt uses EventSource directly.
  sources[0].onerror();
  assert.equal(sources[0].closed, true);
  await timers.advance(1000);
  assert.equal(sources.length, 2);
  stream.stop();
  assert.equal(sources[1].closed, true);
});
