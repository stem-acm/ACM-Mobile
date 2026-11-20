// Live check-ins: GET /api/sse/checkins (plan M7, risk K1).
//
// A `fetch` stream with the Authorization header (the token stays out of the URL); when the
// WebView cannot read a response body as a stream, `EventSource` with `?auth=` as the web does.
// Reconnect after 1, 2, 5, 10, 30 s; after each reconnect `onReconnect` reloads page 1 (missed
// events). Watchdog: no byte for 75 s (heartbeat every 30 s) → reconnect. 401/403 on connect
// → no reconnect (the API client already applied the rule of M4).

export const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
export const WATCHDOG_MS = 75000;

/**
 * Incremental parser of a `text/event-stream`. `push(text)` returns the events completed by
 * this chunk: `{ event, data, id }`. Comment lines (`:heartbeat`) are skipped.
 */
export function createSseParser() {
  let buffer = '';
  let dataLines = [];
  let eventName = '';
  let lastId = '';

  function dispatch(out) {
    if (dataLines.length) out.push({ event: eventName || 'message', data: dataLines.join('\n'), id: lastId });
    dataLines = [];
    eventName = '';
  }

  return {
    push(chunk) {
      buffer += chunk;
      const out = [];
      let index;
      // A line ends with \n, \r\n or \r. Keep a trailing \r: the \n can come in the next chunk.
      while ((index = buffer.search(/\r\n|\n|\r(?!$)/)) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + (buffer.startsWith('\r\n', index) ? 2 : 1));
        if (line === '') {
          dispatch(out);
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') dataLines.push(value);
        else if (field === 'event') eventName = value;
        else if (field === 'id') lastId = value;
      }
      return out;
    },
  };
}

/**
 * The check-in of a `data:` text `{"type":"new-checkin","data":{…}}`, or null for any other
 * message (`connected`, bad JSON, a row without id).
 */
export function parseCheckinMessage(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return null;
  }
  if (!message || message.type !== 'new-checkin') return null;
  const row = message.data;
  return row && typeof row === 'object' && Number.isInteger(row.id) ? row : null;
}

/**
 * @param {object} options
 * @param {(signal: AbortSignal) => Promise<Response>} options.openStream
 *   api.request('GET', '/api/sse/checkins', { responseType: 'stream', timeoutMs, signal })
 * @param {() => string} [options.eventSourceUrl]  URL with ?auth= for the fallback
 * @param {typeof EventSource} [options.EventSourceImpl]
 * @param {(row: object) => void} options.onCheckin
 * @param {() => void} [options.onReconnect]  called when a connection opens after a lost one
 * @param {(state: string) => void} [options.onState]  connecting | open | waiting | stopped
 * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
 */
export function createCheckinStream({
  openStream,
  eventSourceUrl,
  EventSourceImpl = typeof EventSource === 'undefined' ? undefined : EventSource,
  onCheckin,
  onReconnect = () => {},
  onState = () => {},
  timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) },
}) {
  let running = false;
  let attempt = 0; // failed connections in a row
  let everOpened = false;
  let controller = null;
  let source = null;
  let retryTimer = null;
  let watchdog = null;
  let useEventSource = false;
  let session = 0;

  function setState(value) {
    try {
      onState(value);
    } catch {
      /* the UI hook must not break the stream */
    }
  }

  function clearWatchdog() {
    if (watchdog) timers.clearTimeout(watchdog);
    watchdog = null;
  }

  function kickWatchdog(mySession) {
    clearWatchdog();
    watchdog = timers.setTimeout(() => {
      if (mySession === session) lost(mySession);
    }, WATCHDOG_MS);
  }

  function closeCurrent() {
    clearWatchdog();
    if (controller) controller.abort();
    controller = null;
    if (source) source.close();
    source = null;
  }

  function opened(mySession) {
    if (mySession !== session) return;
    attempt = 0;
    setState('open');
    if (everOpened) {
      try {
        onReconnect();
      } catch (error) {
        console.warn('sse: onReconnect failed', error);
      }
    }
    everOpened = true;
  }

  function handleData(text) {
    const row = parseCheckinMessage(text);
    if (row) onCheckin(row);
  }

  /** The connection is lost or failed: wait, then connect again. */
  function lost(mySession) {
    if (!running || mySession !== session) return;
    session++;
    closeCurrent();
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt++;
    setState('waiting');
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      connect();
    }, wait);
  }

  function stopForGood() {
    running = false;
    session++;
    closeCurrent();
    setState('stopped');
  }

  async function connectFetch(mySession) {
    controller = new AbortController();
    const response = await openStream(controller.signal);
    if (mySession !== session) return;
    const reader = response && response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) {
      // The WebView does not stream response bodies: use EventSource from now on.
      useEventSource = Boolean(EventSourceImpl && eventSourceUrl);
      if (controller) controller.abort();
      if (useEventSource) return connectEventSource(mySession);
      throw new Error('sse: streaming is not available');
    }
    opened(mySession);
    kickWatchdog(mySession);
    const decoder = new TextDecoder();
    const parser = createSseParser();
    for (;;) {
      const { value, done } = await reader.read();
      if (mySession !== session) return;
      if (done) throw new Error('sse: stream ended');
      kickWatchdog(mySession);
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        if (event.event === 'message') handleData(event.data);
      }
    }
  }

  function connectEventSource(mySession) {
    source = new EventSourceImpl(eventSourceUrl());
    source.onopen = () => {
      opened(mySession);
      kickWatchdog(mySession);
    };
    source.onmessage = (event) => {
      if (mySession !== session) return;
      kickWatchdog(mySession);
      handleData(event.data);
    };
    // EventSource reconnects by itself without a backoff and without telling why: close it
    // and use the backoff of this module.
    source.onerror = () => lost(mySession);
  }

  function connect() {
    if (!running) return;
    const mySession = ++session;
    setState('connecting');
    if (useEventSource) {
      connectEventSource(mySession);
      return;
    }
    connectFetch(mySession).catch((error) => {
      if (mySession !== session) return;
      const kind = error && error.kind;
      if (kind === 'unauthorized' || kind === 'forbidden' || kind === 'aborted') {
        stopForGood();
        return;
      }
      lost(mySession);
    });
  }

  return {
    /** Opens the stream (no-op when already running). */
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      everOpened = false;
      connect();
    },
    /** Closes the stream and cancels a planned reconnect. */
    stop() {
      if (retryTimer) timers.clearTimeout(retryTimer);
      retryTimer = null;
      stopForGood();
    },
    get running() {
      return running;
    },
  };
}
