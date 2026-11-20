// fetch wrapper of the iPass API (plan M4).
//
// Every response is the envelope `{ success, message, data }` (+ `pagination` on lists).
// `request` returns `{ data, pagination, message }` or throws an `ApiError` whose `kind` is:
//
//   unauthorized  401            forbidden  403           rate_limited  429
//   invalid       other 4xx      server     5xx, or a 2xx that is not the envelope
//   timeout       no answer in time          network    fetch rejected (offline, DNS, CORS)
//   aborted       the caller cancelled the request
//
// Global rule for calls with `auth: true`: 401 and 403 call `onAuthFailure(kind)` before the
// error is thrown (auth.js ends the session: Login "Session expired", or screen 1b).

export class ApiError extends Error {
  /**
   * @param {string} kind
   * @param {{ status?: number, message?: string, data?: unknown }} [details]
   */
  constructor(kind, { status = 0, message = '', data = null } = {}) {
    super(message || kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.data = data;
  }
}

/** The error kind of an HTTP status, or null for a 2xx. */
export function kindForStatus(status) {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'invalid';
  return 'server';
}

/**
 * Errors that give the "Cannot verify" result (4e) on a scan and the "Cannot reach iPass"
 * state elsewhere: the server could not answer, the answer is not a status.
 */
const CANNOT_VERIFY_KINDS = new Set(['rate_limited', 'server', 'timeout', 'network']);

export function isCannotVerify(error) {
  return error instanceof ApiError && CANNOT_VERIFY_KINDS.has(error.kind);
}

/** Short English texts for the states that are not in the mockups (plan Q4). */
export function describeError(error) {
  switch (error && error.kind) {
    case 'network':
    case 'timeout':
      return 'Cannot reach iPass. Check the Wi-Fi and try again.';
    case 'rate_limited':
      return 'Too many requests. Wait a minute and try again.';
    case 'server':
      return 'iPass did not answer correctly. Try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

/**
 * Reads the envelope of a response body. Returns `{ data, pagination, message }`, or null
 * when the text is not the envelope.
 */
export function parseEnvelope(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || typeof body.success !== 'boolean') return null;
  return {
    success: body.success,
    data: body.data === undefined ? null : body.data,
    pagination: body.pagination || null,
    message: typeof body.message === 'string' ? body.message : '',
  };
}

/** `path` + query string; null and undefined values are left out. */
export function buildPath(path, query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) params.append(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}${path.includes('?') ? '&' : '?'}${text}` : path;
}

/**
 * @param {object} options
 * @param {string} options.baseUrl  API base URL without a trailing slash
 * @param {() => string|null} options.getToken
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(kind: 'unauthorized'|'forbidden') => void} [options.onAuthFailure]
 * @param {(serverTime: string) => void} [options.onServerTime]
 * @param {number} [options.defaultTimeoutMs]
 */
export function createApiClient({
  baseUrl,
  getToken,
  fetchImpl = (...args) => fetch(...args),
  onAuthFailure = () => {},
  onServerTime = () => {},
  defaultTimeoutMs = 10000,
}) {
  /**
   * @param {string} method
   * @param {string} path  starts with /api/ or /uploads/
   * @param {object} [options]
   * @param {unknown} [options.body]  sent as JSON
   * @param {Record<string, unknown>} [options.query]
   * @param {boolean} [options.auth]  send the token and apply the 401/403 rule (default true)
   * @param {number} [options.timeoutMs]  0 = no timeout (streams)
   * @param {'json'|'blob'|'stream'} [options.responseType]
   * @param {AbortSignal} [options.signal]
   */
  async function request(
    method,
    path,
    { body, query, auth = true, timeoutMs = defaultTimeoutMs, responseType = 'json', signal } = {}
  ) {
    const headers = { Accept: responseType === 'stream' ? 'text/event-stream' : 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : null;
    const onCallerAbort = () => controller.abort();
    let streaming = false;
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    const failed = (error) => {
      if (timedOut) return new ApiError('timeout', { message: 'The request timed out' });
      if (signal && signal.aborted) return new ApiError('aborted', { message: 'Aborted' });
      return new ApiError('network', { message: error && error.message ? error.message : 'Network error' });
    };

    try {
      let response;
      try {
        response = await fetchImpl(baseUrl + buildPath(path, query), {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: 'omit',
          signal: controller.signal,
        });
      } catch (error) {
        throw failed(error);
      }

      const kind = kindForStatus(response.status);
      if (kind || responseType === 'json') {
        let text;
        try {
          text = await response.text();
        } catch (error) {
          throw failed(error);
        }
        const envelope = parseEnvelope(text);
        if (kind) {
          if (auth && (kind === 'unauthorized' || kind === 'forbidden')) onAuthFailure(kind);
          throw new ApiError(kind, {
            status: response.status,
            message: envelope ? envelope.message : '',
            data: envelope ? envelope.data : null,
          });
        }
        if (!envelope || !envelope.success) {
          throw new ApiError('server', {
            status: response.status,
            message: envelope ? envelope.message : 'Unexpected response',
          });
        }
        if (envelope.data && typeof envelope.data.serverTime === 'string') {
          onServerTime(envelope.data.serverTime);
        }
        return { data: envelope.data, pagination: envelope.pagination, message: envelope.message };
      }

      if (responseType === 'blob') {
        try {
          return await response.blob();
        } catch (error) {
          throw failed(error);
        }
      }
      // Stream: the caller reads response.body; its signal still aborts the body.
      streaming = true;
      return response;
    } finally {
      if (timer) clearTimeout(timer);
      if (signal && !streaming) signal.removeEventListener('abort', onCallerAbort);
    }
  }

  return {
    request,
    /** URL of the SSE stream with the token in the query (EventSource fallback, risk K1). */
    urlWithToken(path) {
      const token = getToken() || '';
      return `${baseUrl}${buildPath(path, { auth: token })}`;
    },
    baseUrl,
  };
}

// ---------------------------------------------------------------- Shared instance

let client = null;

/** Called once by app.js with the base URL from config.js. */
export function configureApi(options) {
  client = createApiClient(options);
  return client;
}

function current() {
  if (!client) throw new Error('api: configureApi() was not called.');
  return client;
}

/** The shared client (same methods as `createApiClient`). */
export const api = {
  request: (...args) => current().request(...args),
  urlWithToken: (...args) => current().urlWithToken(...args),
  get baseUrl() {
    return current().baseUrl;
  },
};
