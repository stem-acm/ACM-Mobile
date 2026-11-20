// Session: launch check, login, end of session, sign out (plan M4).
//
// The dependencies are given by app.js through `initAuth`, so that the tests can use fakes.

export const PERMISSION = 'checkins.verify';

/** Texts of the login and session messages (agreed texts + plan Q4 defaults). */
export const MESSAGES = Object.freeze({
  invalid: 'Invalid username or password',
  expired: 'Session expired',
  empty: 'Enter your username and password.',
  inactive: 'This account is not active. Contact an admin.',
  rateLimited: 'Too many sign-in attempts on this network. Wait 15 minutes and try again.',
  network: 'Cannot reach iPass. Check the Wi-Fi and try again.',
  server: 'iPass did not answer correctly. Try again.',
});

/** Error of `login` with the text to show on the Login screen. */
export class LoginError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'LoginError';
    this.kind = kind;
  }
}

let deps = null;
let sessionActive = false;
let ending = null;
let lastUser = null; // { username, role } of the last account seen, for screen 1b
const endHooks = new Set();

/**
 * @param {object} options
 * @param {{ request: Function }} options.api
 * @param {{ getToken: Function, setToken: Function, clearToken: Function }} options.storage
 * @param {(screen: string, params?: object) => unknown} options.go
 */
export function initAuth({ api, storage, go }) {
  deps = { api, storage, go };
  sessionActive = false;
  ending = null;
  lastUser = null;
}

function need() {
  if (!deps) throw new Error('auth: initAuth() was not called.');
  return deps;
}

/** True when the user object of the API has the badge check permission. */
export function hasVerifyPermission(user) {
  return Boolean(user && user.permissions && user.permissions[PERMISSION] === true);
}

/**
 * Params of screen 1b: "Signed in as <username>" and the role chip. `user` is null when the
 * account is not known (the screen then hides that block).
 */
export function accessDeniedParams(user = lastUser) {
  if (!user || typeof user.username !== 'string') return { user: null };
  return { user: { username: user.username, role: typeof user.role === 'string' ? user.role : '' } };
}

function remember(user) {
  lastUser = user && typeof user.username === 'string' ? { username: user.username, role: user.role } : null;
}

/** Registers a function called at each end of session (free photos, close the stream…). */
export function onSessionEnd(fn) {
  endHooks.add(fn);
  return () => endHooks.delete(fn);
}

export function isSessionActive() {
  return sessionActive;
}

/**
 * Launch check. Returns the first screen: `{ screen, params }`.
 * No token → Login. Token → GET /api/auth/token: permission → list; no permission → the
 * token is dropped → 1b; 401 → Login "Session expired"; network or server error → list with
 * the token kept (the list shows "Cannot reach iPass" and Retry).
 */
export async function restore() {
  const { api, storage } = need();
  if (!storage.getToken()) return { screen: 'login', params: {} };
  sessionActive = false; // the 401/403 rule must not navigate during the launch check
  try {
    const { data } = await api.request('GET', '/api/auth/token');
    remember(data);
    if (!hasVerifyPermission(data)) {
      await storage.clearToken();
      return { screen: 'accessDenied', params: accessDeniedParams() };
    }
    sessionActive = true;
    return { screen: 'list', params: {} };
  } catch (error) {
    const kind = error && error.kind;
    if (kind === 'unauthorized' || kind === 'invalid') {
      await storage.clearToken();
      return { screen: 'login', params: { message: MESSAGES.expired } };
    }
    if (kind === 'forbidden') {
      await storage.clearToken();
      return { screen: 'accessDenied', params: accessDeniedParams(null) };
    }
    sessionActive = true;
    return { screen: 'list', params: { offline: true } };
  }
}

/**
 * POST /api/auth/login. Resolves to the next screen (`list`, or `accessDenied` when the role
 * has no badge check permission: the token is then not stored). Throws a LoginError.
 */
export async function login(username, password) {
  const { api, storage } = need();
  let data;
  try {
    ({ data } = await api.request('POST', '/api/auth/login', {
      body: { username, password },
      auth: false,
    }));
  } catch (error) {
    const kind = error && error.kind;
    const status = error && error.status;
    if (kind === 'unauthorized' || status === 404) throw new LoginError(MESSAGES.invalid, kind);
    if (kind === 'forbidden') throw new LoginError(MESSAGES.inactive, kind);
    if (kind === 'rate_limited') throw new LoginError(MESSAGES.rateLimited, kind);
    if (kind === 'invalid') throw new LoginError(MESSAGES.empty, kind);
    if (kind === 'network' || kind === 'timeout') throw new LoginError(MESSAGES.network, kind);
    throw new LoginError(MESSAGES.server, kind || 'server');
  }
  if (!data || typeof data.token !== 'string' || !data.user) {
    throw new LoginError(MESSAGES.server, 'server');
  }
  remember(data.user);
  if (!hasVerifyPermission(data.user)) return { screen: 'accessDenied', params: accessDeniedParams() };
  await storage.setToken(data.token);
  sessionActive = true;
  ending = null;
  return { screen: 'list', params: {} };
}

/**
 * Ends the session: deletes the token, runs the end hooks (photos freed, stream closed), then
 * opens `screen`. Several calls at the same time (4 photos get a 401 together) end it once.
 */
export function endSession(screen = 'login', params = {}) {
  if (ending) return ending;
  const { storage, go } = need();
  sessionActive = false;
  ending = (async () => {
    await storage.clearToken();
    for (const hook of endHooks) {
      try {
        await hook();
      } catch (error) {
        console.warn('auth: end-of-session hook failed', error);
      }
    }
    await go(screen, params);
  })();
  return ending;
}

/** The 401/403 rule of the API client (plan M4, C3). */
export function handleAuthFailure(kind) {
  if (!sessionActive) return;
  if (kind === 'unauthorized') endSession('login', { message: MESSAGES.expired });
  else if (kind === 'forbidden') endSession('accessDenied', accessDeniedParams());
}

/** Sign out icon of the list: no server route, the token is dropped. */
export function signOut() {
  return endSession('login');
}
