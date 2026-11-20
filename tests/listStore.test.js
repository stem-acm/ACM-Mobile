import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createListStore, isInRoom } from '../src/js/listStore.js';

const now = new Date('2026-11-20T08:00:00.000Z');
const row = (id, checkOutTime = null) => ({ id, checkInTime: '2026-11-20T06:00:00.000Z', checkOutTime });
const ids = (store) => store.state.items.map((item) => item.id);
/** Rows `from` down to `to` (newest first, as the server). */
const range = (from, to) => Array.from({ length: from - to + 1 }, (_, i) => row(from - i));

test('page 1 then page 2 with the cursor of the server', () => {
  const store = createListStore();
  store.addPage(range(147, 128), { total: 47, hasMore: true, nextBefore: 128 });
  assert.equal(store.state.items.length, 20);
  assert.equal(store.state.total, 47);
  assert.equal(store.state.nextBefore, 128);
  assert.equal(store.state.hasMore, true);
  assert.equal(store.state.loaded, true);
  store.addPage(range(127, 108), { total: 47, hasMore: true, nextBefore: 108 });
  store.addPage(range(107, 101), { total: 47, hasMore: false, nextBefore: null });
  assert.equal(store.state.items.length, 47);
  assert.deepEqual(ids(store), range(147, 101).map((r) => r.id));
  assert.equal(store.state.hasMore, false);
  assert.equal(store.state.nextBefore, null);
  assert.equal(store.state.total, 47);
});

test('a row already present (live, then in a page) is not added twice', () => {
  const store = createListStore();
  store.addPage(range(110, 101), { total: 10, hasMore: false, nextBefore: null });
  assert.equal(store.addLive(row(111), now), true);
  assert.equal(store.state.total, 11);
  // Pull to refresh while the stream is open: the server page has 111 too.
  store.reset();
  store.addPage(range(111, 102), { total: 11, hasMore: true, nextBefore: 102 });
  assert.equal(store.addLive(row(111), now), false, 'the live event arrives after the page');
  assert.equal(store.state.total, 11);
  assert.equal(new Set(ids(store)).size, ids(store).length);
});

test('addPage skips duplicates inside a page and between pages', () => {
  const store = createListStore();
  assert.equal(store.addPage([row(5), row(5), row(4)], { total: 3, hasMore: true, nextBefore: 4 }), 2);
  assert.equal(store.addPage([row(4), row(3)], { total: 3, hasMore: false, nextBefore: null }), 1);
  assert.deepEqual(ids(store), [5, 4, 3]);
});

test('a live row goes to the top and adds 1 to the total', () => {
  const store = createListStore();
  store.addPage(range(120, 101), { total: 30, hasMore: true, nextBefore: 101 });
  store.addLive(row(131), now);
  assert.equal(ids(store)[0], 131);
  assert.equal(store.state.total, 31);
});

test('nextBefore never comes from a live row', () => {
  const store = createListStore();
  store.addPage(range(120, 101), { total: 30, hasMore: true, nextBefore: 101 });
  store.addLive(row(200), now);
  assert.equal(store.state.nextBefore, 101);
});

test('a live row that is already checked out is not added', () => {
  const store = createListStore();
  store.addPage([], { total: 0, hasMore: false, nextBefore: null });
  assert.equal(store.addLive(row(9, '2026-11-20T07:00:00.000Z'), now), false);
  assert.equal(store.addLive(row(10, '2026-11-20T09:00:00.000Z'), now), true);
  assert.equal(store.state.total, 1);
});

test('a live row before page 1 is kept; page 1 sets the server total', () => {
  const store = createListStore();
  store.addLive(row(50), now);
  store.addPage(range(50, 41), { total: 10, hasMore: false, nextBefore: null });
  assert.equal(store.state.items.length, 10);
  assert.equal(store.state.total, 10);
});

test('out-of-order live rows keep the newest-first order', () => {
  const store = createListStore();
  store.addPage([row(10), row(8)], { total: 2, hasMore: false, nextBefore: null });
  store.addLive(row(12), now);
  store.addLive(row(9), now);
  assert.deepEqual(ids(store), [12, 10, 9, 8]);
});

test('invalid rows are ignored', () => {
  const store = createListStore();
  assert.equal(store.addPage([null, { id: 'x' }, {}, row(1)], { total: 1, hasMore: false, nextBefore: null }), 1);
  assert.equal(store.addLive(null, now), false);
  assert.equal(store.addLive({ id: 1.5 }, now), false);
});

test('dropExpired removes the rows whose end time is past and lowers the total', () => {
  const store = createListStore();
  store.addPage(
    [row(4), row(3, '2026-11-20T07:59:00.000Z'), row(2, '2026-11-20T08:00:00.000Z'), row(1, '2026-11-20T09:00:00.000Z')],
    { total: 30, hasMore: true, nextBefore: 1 }
  );
  assert.deepEqual(store.dropExpired(now), [3, 2], 'the end time itself is out of the room');
  assert.deepEqual(ids(store), [4, 1]);
  assert.equal(store.state.total, 28);
  assert.equal(store.state.ids.has(3), false);
  assert.deepEqual(store.dropExpired(now), []);
});

test('reset empties everything', () => {
  const store = createListStore();
  store.addPage(range(5, 1), { total: 5, hasMore: false, nextBefore: null });
  store.reset();
  assert.deepEqual(store.state.items, []);
  assert.equal(store.state.ids.size, 0);
  assert.equal(store.state.total, 0);
  assert.equal(store.state.hasMore, false);
  assert.equal(store.state.loaded, false);
});

test('hasMore without a nextBefore is treated as the end', () => {
  const store = createListStore();
  store.addPage(range(3, 1), { total: 3, hasMore: true, nextBefore: null });
  assert.equal(store.state.hasMore, false);
});

test('on the last page the total is at least the number of rows shown', () => {
  const store = createListStore();
  store.addPage(range(3, 1), { total: 2, hasMore: false, nextBefore: null });
  assert.equal(store.state.total, 3);
});

test('empty list: total 0, loaded', () => {
  const store = createListStore();
  store.addPage([], { limit: 20, total: 0, hasMore: false, nextBefore: null });
  assert.equal(store.state.total, 0);
  assert.equal(store.state.loaded, true);
  assert.equal(store.state.hasMore, false);
});

test('isInRoom: empty, future and past check-out times', () => {
  assert.equal(isInRoom(row(1), now), true);
  assert.equal(isInRoom(row(1, ''), now), true);
  assert.equal(isInRoom(row(1, '2026-11-20T08:00:01.000Z'), now), true);
  assert.equal(isInRoom(row(1, '2026-11-20T08:00:00.000Z'), now), false);
});
