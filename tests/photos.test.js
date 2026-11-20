import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AVATAR, createPhotoCache, normalizePhotoPath } from '../src/js/photos.js';

const BASE = 'https://api.example.org';

test('normalizePhotoPath: list profileImage and verify photoUrl give the same path', () => {
  assert.equal(normalizePhotoPath('members/3f1c2a.jpg'), 'members/3f1c2a.jpg'); // in-room item
  assert.equal(normalizePhotoPath('/uploads/members/3f1c2a.jpg'), 'members/3f1c2a.jpg'); // verify
  assert.equal(normalizePhotoPath('uploads/members/3f1c2a.jpg'), 'members/3f1c2a.jpg');
  assert.equal(normalizePhotoPath(`${BASE}/uploads/members/3f1c2a.jpg`, BASE), 'members/3f1c2a.jpg');
  assert.equal(normalizePhotoPath('  members/a.png  '), 'members/a.png');
  assert.equal(normalizePhotoPath('/uploads/members/a.png?v=2'), 'members/a.png');
});

test('normalizePhotoPath: no photo, default avatar, other origins and traversal → null', () => {
  for (const value of [null, undefined, '', '   ', 42, 'user.png', '/uploads/user.png']) {
    assert.equal(normalizePhotoPath(value), null, String(value));
  }
  assert.equal(normalizePhotoPath('https://evil.example.org/uploads/members/a.jpg', BASE), null);
  assert.equal(normalizePhotoPath('blob:https://localhost/1234'), null);
  assert.equal(normalizePhotoPath('data:image/png;base64,AAA'), null);
  assert.equal(normalizePhotoPath('/uploads/../.env'), null);
  assert.equal(normalizePhotoPath('members/../../secret'), null);
  assert.equal(normalizePhotoPath('members//a.jpg'), null);
});

/** A photo cache with fake fetch and fake object URLs. */
function setup(options = {}) {
  const fetched = [];
  const revoked = [];
  let next = 0;
  const waiting = [];
  const cache = createPhotoCache({
    fetchBlob: (path) => {
      fetched.push(path);
      if (options.manual) {
        return new Promise((resolve, reject) => waiting.push({ path, resolve, reject }));
      }
      if (path.includes('broken')) return Promise.reject(new Error('401'));
      return Promise.resolve({ path });
    },
    createObjectURL: (blob) => `blob:${blob.path}#${++next}`,
    revokeObjectURL: (url) => revoked.push(url),
    ...options.cache,
  });
  return { cache, fetched, revoked, waiting };
}

test('load: empty path → default avatar without a download', async () => {
  const { cache, fetched } = setup();
  assert.equal(await cache.load(null), DEFAULT_AVATAR);
  assert.equal(await cache.load(''), DEFAULT_AVATAR);
  assert.deepEqual(fetched, []);
});

test('load: one download per path for the session (list and result share it)', async () => {
  const { cache, fetched } = setup();
  const a = await cache.load('members/a.jpg');
  const b = await cache.load('/uploads/members/a.jpg');
  assert.equal(a, 'blob:members/a.jpg#1');
  assert.equal(b, a);
  assert.deepEqual(fetched, ['members/a.jpg']);
});

test('load: two calls at the same time share one download', async () => {
  const { cache, fetched } = setup();
  const [a, b] = await Promise.all([cache.load('members/a.jpg'), cache.load('members/a.jpg')]);
  assert.equal(a, b);
  assert.equal(fetched.length, 1);
});

test('load: a failure gives the default avatar and is not cached', async () => {
  const { cache, fetched } = setup();
  assert.equal(await cache.load('members/broken.jpg'), DEFAULT_AVATAR);
  assert.equal(await cache.load('members/broken.jpg'), DEFAULT_AVATAR);
  assert.equal(fetched.length, 2, 'tried again');
  assert.equal(cache.size, 0);
});

test('at most 4 downloads at a time', async () => {
  const { cache, waiting } = setup({ manual: true });
  const loads = Array.from({ length: 7 }, (_, i) => cache.load(`members/${i}.jpg`));
  await Promise.resolve();
  assert.equal(waiting.length, 4);
  assert.equal(cache.active, 4);
  waiting[0].resolve({ path: 'members/0.jpg' });
  await new Promise((r) => setImmediate(r));
  assert.equal(waiting.length, 5);
  for (const job of waiting.slice(1)) job.resolve({ path: job.path });
  await new Promise((r) => setImmediate(r));
  for (const job of waiting.slice(5)) job.resolve({ path: job.path });
  const urls = await Promise.all(loads);
  assert.equal(new Set(urls).size, 7);
  assert.equal(cache.active, 0);
});

test('cache keeps at most maxEntries; the least recently used is revoked', async () => {
  const { cache, revoked } = setup({ cache: { maxEntries: 2 } });
  const a = await cache.load('members/a.jpg');
  await cache.load('members/b.jpg');
  await cache.load('members/a.jpg'); // a is used again: b is now the oldest
  await cache.load('members/c.jpg');
  assert.equal(cache.size, 2);
  assert.deepEqual(revoked, ['blob:members/b.jpg#2']);
  assert.equal(await cache.load('members/a.jpg'), a);
});

test('the default limit is 150 entries', async () => {
  const { cache, revoked } = setup();
  for (let i = 0; i < 151; i++) await cache.load(`members/${i}.jpg`);
  assert.equal(cache.size, 150);
  assert.deepEqual(revoked, ['blob:members/0.jpg#1']);
});

test('clear revokes every URL (sign-out)', async () => {
  const { cache, revoked } = setup();
  const a = await cache.load('members/a.jpg');
  const b = await cache.load('members/b.jpg');
  cache.clear();
  assert.deepEqual(revoked.sort(), [a, b].sort());
  assert.equal(cache.size, 0);
});

test('a download that ends after clear is revoked and not cached', async () => {
  const { cache, waiting, revoked } = setup({ manual: true });
  const pending = cache.load('members/a.jpg');
  const queued = Array.from({ length: 5 }, (_, i) => cache.load(`members/q${i}.jpg`));
  await Promise.resolve();
  cache.clear();
  waiting[0].resolve({ path: 'members/a.jpg' });
  assert.equal(await pending, DEFAULT_AVATAR);
  assert.equal(revoked.length, 1);
  assert.equal(cache.size, 0);
  // The queued downloads end with the default avatar instead of hanging.
  for (const job of waiting.slice(1)) job.resolve({ path: job.path });
  const results = await Promise.all(queued);
  assert.ok(results.every((url) => url === DEFAULT_AVATAR));
});
