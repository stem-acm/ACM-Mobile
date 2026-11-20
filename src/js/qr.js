// QR text of a member badge: parsing and the 3 s memory of the scanner (plan M8). Pure.
//
// An iPass badge holds the JSON `{"registrationNumber":42,"signature":"<64 hex>"}`: the
// signature is the HMAC-SHA256 hex of the number (ACM-Backend src/utils/qrUtils.ts). Any other
// text (a legacy badge with a plain number, a URL, a Wi-Fi code) is refused in the app, without
// a network call (conflict C16).

/** Time during which the same QR text is ignored. */
export const REPEAT_WINDOW_MS = 3000;

const SIGNATURE = /^[0-9a-f]{64}$/i;

/**
 * The badge of a QR text: `{ registrationNumber, signature }`, or null when the text is not an
 * iPass badge.
 * @param {unknown} raw
 */
export function parseBadge(raw) {
  if (typeof raw !== 'string') return null;
  let value;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { registrationNumber, signature } = value;
  if (typeof registrationNumber !== 'number' || !Number.isSafeInteger(registrationNumber)) return null;
  if (registrationNumber <= 0) return null;
  if (typeof signature !== 'string' || !SIGNATURE.test(signature)) return null;
  return { registrationNumber, signature };
}

/**
 * The scanner memory. The camera reports the same code many times per second; `accept` lets a
 * text through once, then ignores the same text for `windowMs`. Another text is accepted at
 * once. While `busy` (a verification runs) every code is ignored and nothing is remembered.
 * The memory lives as long as the app, so "Scan next" does not read the same badge again at
 * once.
 */
export function createScanMemory({ windowMs = REPEAT_WINDOW_MS } = {}) {
  let lastText = null;
  let lastAt = -Infinity;
  let busy = false;

  return {
    /**
     * @param {string} raw
     * @param {number} now  milliseconds (Date.now())
     * @returns {boolean} true when the code must be handled
     */
    accept(raw, now) {
      if (busy || typeof raw !== 'string') return false;
      if (raw === lastText && now - lastAt < windowMs) return false;
      lastText = raw;
      lastAt = now;
      return true;
    },
    setBusy(value) {
      busy = Boolean(value);
    },
    get busy() {
      return busy;
    },
    /** Forgets the last text (sign-out). */
    reset() {
      lastText = null;
      lastAt = -Infinity;
      busy = false;
    },
  };
}
