// Screen state machine. No URL routing.
//
// Each screen module exports `mount(root, params)` and `unmount()`, and may export
// `pause()` and `resume()` for the app pause/resume events. `go(name, params)` calls
// `unmount` of the old screen (stop camera, timers, listeners), empties the root, then calls
// `mount` of the new one. Navigations run one after the other, in call order.

export const SCREENS = ['login', 'accessDenied', 'list', 'scanner', 'result'];

/**
 * Where the Android back button goes from each screen. `null` = leave the app (minimize).
 */
export const BACK_TARGETS = Object.freeze({
  result: 'list',
  scanner: 'list',
  list: null,
  login: null,
  accessDenied: null,
});

/**
 * @param {object} options
 * @param {{ replaceChildren(): void }} options.root  the element that holds the screen
 * @param {Record<string, { mount: Function, unmount: Function, pause?: Function, resume?: Function }>} options.screens
 * @param {(name: string, params: object) => void} [options.onChange]  called after each mount
 * @param {(error: unknown, phase: string, name: string) => void} [options.onError]
 */
export function createRouter({ root, screens, onChange = () => {}, onError = defaultOnError }) {
  for (const name of SCREENS) {
    const screen = screens[name];
    if (!screen || typeof screen.mount !== 'function' || typeof screen.unmount !== 'function') {
      throw new Error(`Screen "${name}" must export mount() and unmount().`);
    }
  }

  let current = null; // { name, params }
  let queue = Promise.resolve();

  async function run(phase, name, fn) {
    try {
      await fn();
    } catch (error) {
      onError(error, phase, name);
    }
  }

  async function doGo(name, params) {
    if (!SCREENS.includes(name)) throw new Error(`Unknown screen "${name}".`);
    if (current) {
      const old = current;
      await run('unmount', old.name, () => screens[old.name].unmount());
    }
    root.replaceChildren();
    current = { name, params };
    await run('mount', name, () => screens[name].mount(root, params));
    onChange(name, params);
  }

  /** Opens a screen. Resolves when the new screen is mounted. */
  function go(name, params = {}) {
    const step = queue.then(() => doGo(name, params));
    // A failed navigation does not block the next ones.
    queue = step.catch(() => {});
    return step;
  }

  /**
   * Handles the Android back button. Resolves to `true` when the router navigated, `false`
   * when the app must be left (the caller minimizes it).
   */
  async function back() {
    await queue;
    if (!current) return false;
    const target = BACK_TARGETS[current.name];
    if (!target) return false;
    await go(target);
    return true;
  }

  /** App paused: the current screen stops what it must (camera, torch, stream). */
  async function pause() {
    await queue;
    if (current && screens[current.name].pause) {
      await run('pause', current.name, () => screens[current.name].pause());
    }
  }

  /** App resumed: the current screen restarts what it needs. */
  async function resume() {
    await queue;
    if (current && screens[current.name].resume) {
      await run('resume', current.name, () => screens[current.name].resume());
    }
  }

  return {
    go,
    back,
    pause,
    resume,
    get current() {
      return current ? current.name : null;
    },
    get params() {
      return current ? current.params : null;
    },
  };
}

function defaultOnError(error, phase, name) {
  console.error(`router: ${phase} of "${name}" failed`, error);
}
