// The JWT, and only the JWT, in secure storage (Android Keystore through native.js; in the
// desktop browser sessionStorage). The permissions are never stored: they are read again at
// each launch (plan M4). The token is also kept in memory so that the API client, the photo
// loader and the SSE stream can read it without waiting.

import { secureGet, secureRemove, secureSet } from './native.js';

const TOKEN_KEY = 'ipass.token';

let token = null;

/** Reads the stored token once, at launch. */
export async function loadToken() {
  try {
    token = (await secureGet(TOKEN_KEY)) || null;
  } catch (error) {
    console.warn('storage: cannot read the token', error);
    token = null;
  }
  return token;
}

/** The token in memory, or null. */
export function getToken() {
  return token;
}

export async function setToken(value) {
  token = value;
  await secureSet(TOKEN_KEY, value);
}

export async function clearToken() {
  token = null;
  try {
    await secureRemove(TOKEN_KEY);
  } catch (error) {
    console.warn('storage: cannot delete the token', error);
  }
}
