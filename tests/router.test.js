import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACK_TARGETS, SCREENS, createRouter } from '../src/js/router.js';

function fakeRoot() {
  return { cleared: 0, replaceChildren() { this.cleared++; } };
}

/** Screens that record their lifecycle calls in `log`. */
function fakeScreens(log, overrides = {}) {
  const screens = {};
  for (const name of SCREENS) {
    screens[name] = {
      mount: (root, params) => log.push(['mount', name, params]),
      unmount: () => log.push(['unmount', name]),
      pause: () => log.push(['pause', name]),
      resume: () => log.push(['resume', name]),
      ...(overrides[name] || {}),
    };
  }
  return screens;
}

test('the first go mounts the screen with its params', async () => {
  const log = [];
  const root = fakeRoot();
  const router = createRouter({ root, screens: fakeScreens(log) });
  await router.go('login', { message: 'Session expired' });
  assert.deepEqual(log, [['mount', 'login', { message: 'Session expired' }]]);
  assert.equal(router.current, 'login');
  assert.deepEqual(router.params, { message: 'Session expired' });
  assert.equal(root.cleared, 1);
});

test('go unmounts the old screen before it mounts the new one', async () => {
  const log = [];
  const router = createRouter({ root: fakeRoot(), screens: fakeScreens(log) });
  await router.go('list');
  await router.go('scanner');
  assert.deepEqual(log, [
    ['mount', 'list', {}],
    ['unmount', 'list'],
    ['mount', 'scanner', {}],
  ]);
});

test('navigations run in call order, even when not awaited', async () => {
  const log = [];
  const slow = { unmount: () => new Promise((r) => setTimeout(() => { log.push(['unmount', 'list']); r(); }, 10)) };
  const router = createRouter({ root: fakeRoot(), screens: fakeScreens(log, { list: slow }) });
  await router.go('list');
  router.go('scanner');
  await router.go('result', { result: { status: 'CHECKED_IN' } });
  assert.deepEqual(log.map((e) => `${e[0]}:${e[1]}`), [
    'mount:list',
    'unmount:list',
    'mount:scanner',
    'unmount:scanner',
    'mount:result',
  ]);
  assert.equal(router.current, 'result');
});

test('an unknown screen is refused and does not block later navigations', async () => {
  const log = [];
  const router = createRouter({ root: fakeRoot(), screens: fakeScreens(log) });
  await assert.rejects(router.go('settings'), /Unknown screen/);
  await router.go('list');
  assert.equal(router.current, 'list');
});

test('an error in unmount or mount is reported and the navigation goes on', async () => {
  const log = [];
  const errors = [];
  const router = createRouter({
    root: fakeRoot(),
    screens: fakeScreens(log, {
      scanner: { unmount: () => { throw new Error('camera'); } },
      result: { mount: () => { throw new Error('render'); } },
    }),
    onError: (error, phase, name) => errors.push(`${phase}:${name}:${error.message}`),
  });
  await router.go('scanner');
  await router.go('result');
  assert.equal(router.current, 'result');
  assert.deepEqual(errors, ['unmount:scanner:camera', 'mount:result:render']);
});

test('onChange is called after each mount', async () => {
  const changes = [];
  const router = createRouter({
    root: fakeRoot(),
    screens: fakeScreens([]),
    onChange: (name, params) => changes.push([name, params]),
  });
  await router.go('list');
  await router.go('scanner', { a: 1 });
  assert.deepEqual(changes, [['list', {}], ['scanner', { a: 1 }]]);
});

test('back table of the plan (M3)', () => {
  assert.deepEqual({ ...BACK_TARGETS }, {
    result: 'list',
    scanner: 'list',
    list: null,
    login: null,
    accessDenied: null,
  });
});

for (const [from, to] of [['result', 'list'], ['scanner', 'list']]) {
  test(`back from ${from} goes to ${to}`, async () => {
    const router = createRouter({ root: fakeRoot(), screens: fakeScreens([]) });
    await router.go(from);
    assert.equal(await router.back(), true);
    assert.equal(router.current, to);
  });
}

for (const name of ['list', 'login', 'accessDenied']) {
  test(`back from ${name} leaves the app`, async () => {
    const log = [];
    const router = createRouter({ root: fakeRoot(), screens: fakeScreens(log) });
    await router.go(name);
    assert.equal(await router.back(), false);
    assert.equal(router.current, name);
    assert.equal(log.filter((e) => e[0] === 'unmount').length, 0);
  });
}

test('back before any screen leaves the app', async () => {
  const router = createRouter({ root: fakeRoot(), screens: fakeScreens([]) });
  assert.equal(await router.back(), false);
});

test('back waits for a running navigation', async () => {
  const router = createRouter({ root: fakeRoot(), screens: fakeScreens([]) });
  router.go('scanner');
  assert.equal(await router.back(), true);
  assert.equal(router.current, 'list');
});

test('pause and resume reach the current screen only', async () => {
  const log = [];
  const router = createRouter({ root: fakeRoot(), screens: fakeScreens(log) });
  await router.go('scanner');
  await router.pause();
  await router.resume();
  assert.deepEqual(log.slice(1), [['pause', 'scanner'], ['resume', 'scanner']]);
});

test('pause and resume are optional on a screen', async () => {
  const log = [];
  const router = createRouter({
    root: fakeRoot(),
    screens: fakeScreens(log, { login: { pause: undefined, resume: undefined } }),
  });
  await router.go('login');
  await router.pause();
  await router.resume();
  assert.deepEqual(log, [['mount', 'login', {}]]);
});

test('a screen without mount or unmount is refused', () => {
  const screens = fakeScreens([]);
  delete screens.result.unmount;
  assert.throws(() => createRouter({ root: fakeRoot(), screens }), /result/);
});
