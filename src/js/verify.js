// Badge verification: POST /api/checkins/verify and the mapping of its answer to the result
// screen (plan M8 step 4, M9). Pure apart from the `request` function given by the caller.
//
//   200 with a known status     → result 4a–4d with the server data
//   invalid (422, other 4xx)    → 4d INVALID_BADGE (the server refused the badge)
//   rate_limited, server, timeout, network → 4e "Cannot verify" with the scanned badge
//   unauthorized, forbidden     → null: the 401/403 rule of api.js/auth.js already navigates
//   aborted                     → null: the screen was left during the request
//
// 4e never shows a guessed status: an unknown status or a body that is not the expected
// object is a server error.

import { ApiError } from './api.js';

export const VERIFY_PATH = '/api/checkins/verify';
export const VERIFY_TIMEOUT_MS = 8000;

export const STATUSES = Object.freeze(['CHECKED_IN', 'NOT_CHECKED_IN', 'NO_SLOT', 'INVALID_BADGE']);

/** Result variant of each status (screen names of the design). */
export const VARIANTS = Object.freeze({
  CHECKED_IN: '4a',
  NOT_CHECKED_IN: '4b',
  NO_SLOT: '4c',
  INVALID_BADGE: '4d',
});

/**
 * `data` of an INVALID_BADGE that the app decides alone (a QR that is not an iPass badge, or a
 * 422): the screen 4d only shows fixed texts.
 */
export function localInvalidResult() {
  return {
    status: 'INVALID_BADGE',
    member: null,
    slot: null,
    checkIn: null,
    nextSlot: null,
    todaySlots: [],
    closedToday: false,
    now: null,
    local: true,
  };
}

/** Params of the result screen for a QR text that is not an iPass badge (no network call). */
export function notABadgeParams() {
  return { result: localInvalidResult(), badge: null };
}

/** True when `data` is a verify answer the result screen can show. */
export function isVerifyData(data) {
  if (!data || typeof data !== 'object' || !STATUSES.includes(data.status)) return false;
  if (data.status === 'INVALID_BADGE') return true;
  const member = data.member;
  if (!member || typeof member !== 'object' || !Number.isFinite(member.registrationNumber)) return false;
  if ((data.status === 'CHECKED_IN' || data.status === 'NOT_CHECKED_IN') && !data.slot) return false;
  return true;
}

/**
 * Params of the result screen for an error of the verify request, or null when the screen must
 * not change (401/403 handled by auth.js, request aborted).
 * @param {unknown} error
 * @param {{ registrationNumber: number, signature: string }} badge
 */
export function paramsForError(error, badge) {
  const kind = error instanceof ApiError ? error.kind : 'network';
  if (kind === 'unauthorized' || kind === 'forbidden' || kind === 'aborted') return null;
  if (kind === 'invalid') return { result: localInvalidResult(), badge };
  // rate_limited, server, timeout, network, and anything unexpected.
  return { error: true, kind, badge };
}

/**
 * Sends the badge and returns the params of the result screen, or null (see paramsForError).
 * Never throws.
 * @param {(method: string, path: string, options: object) => Promise<{ data: unknown }>} request
 * @param {{ registrationNumber: number, signature: string }} badge
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
 */
export async function verifyBadge(request, badge, { signal, timeoutMs = VERIFY_TIMEOUT_MS } = {}) {
  let data;
  try {
    ({ data } = await request('POST', VERIFY_PATH, {
      body: { registrationNumber: badge.registrationNumber, signature: badge.signature },
      timeoutMs,
      signal,
    }));
  } catch (error) {
    return paramsForError(error, badge);
  }
  if (!isVerifyData(data)) return { error: true, kind: 'server', badge };
  return { result: data, badge };
}

/**
 * The variant of result params: `4a`–`4d`, `4e` (cannot verify), or null.
 * @param {{ result?: { status: string }, error?: boolean }} params
 */
export function variantOf(params) {
  if (!params) return null;
  if (params.error) return '4e';
  return (params.result && VARIANTS[params.result.status]) || null;
}
