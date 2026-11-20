// Start: config check, API client and session, first screen, back button, pause/resume.
//
// Fixture mode (desktop browser only): `npm run dev` opens the app on a fake API
// (fixtures.js) so that every screen works without a backend. Add `?fixtures=0` to the URL to
// use the real API of config.js instead (for example a build made with
// `npm run build:local -- --api http://localhost:5002 --no-sync`). The Android app never uses
// fixtures.

import { createRouter } from './router.js';
import { go, setRouter } from './nav.js';
import { isNative, minimizeApp, onAppStateChange, onBackButton } from './native.js';
import { api, configureApi } from './api.js';
import * as storage from './storage.js';
import { handleAuthFailure, initAuth, onSessionEnd, restore } from './auth.js';
import { configurePhotos } from './photos.js';
import * as photos from './photos.js';
import * as schedule from './schedule.js';
import { createFixtureFetch } from './fixtures.js';
import * as login from './screens/login.js';
import * as accessDenied from './screens/accessDenied.js';
import * as list from './screens/list.js';
import * as scanner from './screens/scanner.js';
import * as result from './screens/result.js';

function fatal(message) {
  document.getElementById('fatal-text').textContent = message;
  document.getElementById('fatal').hidden = false;
  document.getElementById('app').hidden = true;
}

/** True in a desktop browser unless the URL has `?fixtures=0`. */
function fixtureMode() {
  if (isNative) return false;
  return new URLSearchParams(window.location.search).get('fixtures') !== '0';
}

async function start() {
  const config = window.APP_CONFIG;
  if (!config || typeof config.API_BASE_URL !== 'string' || !config.API_BASE_URL) {
    fatal('src/config.js is missing. Run npm run build:local, build:staging or build:prod.');
    return;
  }

  const fixtures = fixtureMode();
  if (fixtures) console.info('app: fixture mode (fake API). Add ?fixtures=0 for the real API.');

  configureApi({
    baseUrl: config.API_BASE_URL,
    getToken: storage.getToken,
    fetchImpl: fixtures ? createFixtureFetch() : (...args) => window.fetch(...args),
    onAuthFailure: handleAuthFailure,
    onServerTime: (serverTime) => schedule.setServerTime(serverTime),
  });
  configurePhotos({
    baseUrl: config.API_BASE_URL,
    fetchBlob: (path) =>
      api.request('GET', `/uploads/${path.split('/').map(encodeURIComponent).join('/')}`, {
        responseType: 'blob',
      }),
  });
  initAuth({ api, storage, go });
  onSessionEnd(() => photos.clear());
  onSessionEnd(() => schedule.reset());

  const router = createRouter({
    root: document.getElementById('app'),
    screens: { login, accessDenied, list, scanner, result },
  });
  setRouter(router);

  await onBackButton(async () => {
    const navigated = await router.back();
    if (!navigated) await minimizeApp();
  });

  await onAppStateChange((isActive) => (isActive ? router.resume() : router.pause()));

  await storage.loadToken();
  const first = await restore();
  await router.go(first.screen, first.params);
}

start().catch((error) => {
  console.error(error);
  fatal('Unexpected error at start. Close the app and open it again.');
});
