// Screen 2 "Checked in now" (plan M7).
//
// Header "Checked in now (N)" (N = server total) and the current slot; Sign out icon (the only
// sign-out of the app). Cards newest first; 20 per page with the cursor of the server; the next
// page loads 200 px before the bottom. Live check-ins (SSE) at the top, de-duplicated by id.
// Pull to refresh reloads page 1. Floating "Scan badge" button → scanner.

import { go } from '../nav.js';
import { api, describeError } from '../api.js';
import { signOut } from '../auth.js';
import { createListStore } from '../listStore.js';
import * as photos from '../photos.js';
import * as schedule from '../schedule.js';
import { createCheckinStream } from '../sse.js';
import { NO_SLOT_TEXT, memberName, memberNumber, slotLabel, timeInZone } from '../format.js';
import { renderTemplate } from './dom.js';

export const PAGE_SIZE = 20;
const NEAR_BOTTOM_PX = 200;
const PULL_THRESHOLD_PX = 70;
const PULL_MAX_PX = 100;
const TICK_MS = 60000;

export const TEXTS = Object.freeze({
  empty: 'No member is checked in now.',
  loading: 'Loading…',
  loadingMore: 'Loading more…',
  loadMoreFailed: 'Could not load more',
  allShown: (n) => `All ${n} ${n === 1 ? 'member' : 'members'} shown`,
});

let view = null;

function isAuthOrAbort(error) {
  const kind = error && error.kind;
  return kind === 'unauthorized' || kind === 'forbidden' || kind === 'aborted';
}

export function mount(root) {
  const refs = renderTemplate(root, 'list');
  const store = createListStore();
  view = {
    refs,
    store,
    mounted: true,
    seq: 0, // page-1 requests; a late answer of an older request is ignored
    slot: undefined, // undefined = not known yet, null = no slot now
    timeZone: schedule.cached() ? schedule.cached().timezone : undefined,
    firstError: null,
    notice: null,
    moreFailed: false,
    refreshing: false,
    cards: new Map(), // id → { element, photo }
    observer: null,
    stream: null,
    tick: null,
    pull: { active: false, startY: 0, distance: 0 },
  };

  refs.signOut.addEventListener('click', () => signOut());
  refs.scan.addEventListener('click', () => go('scanner'));
  refs.stateRetry.addEventListener('click', () => loadFirst());
  refs.noticeRetry.addEventListener('click', () => loadFirst());
  refs.footerRetry.addEventListener('click', () => {
    view.moreFailed = false;
    loadMore();
  });
  refs.scroll.addEventListener('scroll', onScroll, { passive: true });
  refs.scroll.addEventListener('touchstart', onTouchStart, { passive: true });
  refs.scroll.addEventListener('touchmove', onTouchMove, { passive: false });
  refs.scroll.addEventListener('touchend', onTouchEnd, { passive: true });
  refs.scroll.addEventListener('touchcancel', onTouchEnd, { passive: true });

  if (typeof IntersectionObserver === 'function') {
    view.observer = new IntersectionObserver(onCardsVisible, {
      root: refs.scroll,
      rootMargin: '200px 0px',
    });
  }

  view.stream = createCheckinStream({
    openStream: (signal) =>
      api.request('GET', '/api/sse/checkins', { responseType: 'stream', timeoutMs: 15000, signal }),
    eventSourceUrl: () => api.urlWithToken('/api/sse/checkins'),
    onCheckin,
    onReconnect: () => loadFirst(),
  });

  if (!schedule.cached()) {
    // For the slot line of the minute tick; the page itself carries the slot of the server.
    schedule.load(api).catch(() => {});
  }

  render();
  loadFirst();
  startLive();
}

export function unmount() {
  if (!view) return;
  view.mounted = false;
  view.seq++;
  stopLive();
  if (view.observer) view.observer.disconnect();
  view = null;
}

/** App paused: close the stream (risk K1, plan M3). */
export function pause() {
  if (view) stopLive();
}

/** App resumed: open the stream again and reload page 1 (missed check-ins, risk K12). */
export function resume() {
  if (!view) return;
  startLive();
  loadFirst();
}

function startLive() {
  view.stream.start();
  if (!view.tick) view.tick = setInterval(onTick, TICK_MS);
}

function stopLive() {
  view.stream.stop();
  if (view.tick) clearInterval(view.tick);
  view.tick = null;
}

// ---------------------------------------------------------------- Data

/** Loads page 1. The cards on screen stay until the new page arrives (test H7). */
async function loadFirst() {
  if (!view) return;
  const v = view;
  const seq = ++v.seq;
  v.store.state.loading = true;
  v.firstError = null;
  render();
  try {
    const { data, pagination } = await api.request('GET', '/api/checkins/in-room', {
      query: { limit: PAGE_SIZE },
    });
    if (!v.mounted || seq !== v.seq) return;
    v.store.reset();
    v.store.addPage(data && data.checkins, pagination);
    v.slot = data ? data.slot || null : null;
    if (data && typeof data.timezone === 'string') v.timeZone = data.timezone;
    v.notice = null;
    v.moreFailed = false;
    v.refs.scroll.scrollTop = 0;
  } catch (error) {
    if (!v.mounted || seq !== v.seq || isAuthOrAbort(error)) return;
    if (v.store.state.items.length) v.notice = describeError(error);
    else v.firstError = error;
  } finally {
    if (v.mounted && seq === v.seq) {
      v.store.state.loading = false;
      v.refreshing = false;
      render();
      fillScreen();
    }
  }
}

/** Loads the next page with `before = nextBefore`. */
async function loadMore() {
  if (!view) return;
  const v = view;
  const { state } = v.store;
  if (!state.loaded || !state.hasMore || state.loading || v.moreFailed) return;
  const seq = v.seq;
  state.loading = true;
  render();
  try {
    const { data, pagination } = await api.request('GET', '/api/checkins/in-room', {
      query: { limit: PAGE_SIZE, before: state.nextBefore },
    });
    if (!v.mounted || seq !== v.seq) return;
    v.store.addPage(data && data.checkins, pagination);
    if (data && data.slot !== undefined) v.slot = data.slot;
  } catch (error) {
    if (!v.mounted || seq !== v.seq || isAuthOrAbort(error)) return;
    v.moreFailed = true;
  } finally {
    if (v.mounted && seq === v.seq) {
      state.loading = false;
      render();
      fillScreen();
    }
  }
}

/** When the cards do not fill the screen and there is more, load again. */
function fillScreen() {
  if (!view) return;
  const { scroll } = view.refs;
  if (scroll.scrollHeight - scroll.clientHeight < NEAR_BOTTOM_PX) loadMore();
}

function onScroll() {
  if (!view) return;
  const { scroll } = view.refs;
  if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < NEAR_BOTTOM_PX) loadMore();
}

function onCheckin(row) {
  if (!view) return;
  if (view.store.addLive(row, schedule.now())) render();
}

/** Each minute: drop the check-ins whose end time is past, new slot line. */
function onTick() {
  if (!view) return;
  const now = schedule.now();
  view.store.dropExpired(now);
  const cached = schedule.cached();
  if (cached) {
    try {
      view.slot = schedule.currentSlot(now, cached.schedule, cached.timezone);
    } catch {
      /* keep the slot of the server */
    }
  }
  render();
}

// ---------------------------------------------------------------- Pull to refresh

function setPull(distance) {
  view.pull.distance = distance;
  const { ptr, ptrSpinner } = view.refs;
  ptr.style.height = view.refreshing ? '' : `${distance}px`;
  ptr.classList.toggle('ready', distance >= PULL_THRESHOLD_PX);
  ptrSpinner.style.transform = `rotate(${distance * 3}deg)`;
}

function onTouchStart(event) {
  if (!view || view.refreshing || view.refs.scroll.scrollTop > 0) return;
  view.pull.active = true;
  view.pull.startY = event.touches[0].clientY;
}

function onTouchMove(event) {
  if (!view || !view.pull.active) return;
  const dy = event.touches[0].clientY - view.pull.startY;
  if (dy <= 0 || view.refs.scroll.scrollTop > 0) {
    setPull(0);
    return;
  }
  event.preventDefault(); // no scroll bounce while pulling
  setPull(Math.min(dy * 0.5, PULL_MAX_PX));
}

function onTouchEnd() {
  if (!view || !view.pull.active) return;
  view.pull.active = false;
  const ready = view.pull.distance >= PULL_THRESHOLD_PX;
  setPull(0);
  if (ready) refresh();
}

/** Pull to refresh: reload from page 1. */
function refresh() {
  view.refreshing = true;
  view.moreFailed = false;
  loadFirst();
}

// ---------------------------------------------------------------- Rendering

function render() {
  if (!view) return;
  const { refs, store } = view;
  const { state } = store;

  refs.count.textContent = state.loaded ? `(${state.total})` : '';
  if (view.slot !== undefined) refs.slot.textContent = slotLabel(view.slot) || NO_SLOT_TEXT;

  refs.ptr.classList.toggle('refreshing', view.refreshing);
  refs.notice.hidden = !view.notice;
  refs.noticeText.textContent = view.notice || '';

  renderCards();

  // Whole-list states: first load, first load failed, empty.
  const empty = state.items.length === 0;
  let stateText = '';
  let stateSpinner = false;
  let stateRetry = false;
  if (empty && view.firstError) {
    stateText = describeError(view.firstError);
    stateRetry = true;
  } else if (empty && !state.loaded) {
    stateText = TEXTS.loading;
    stateSpinner = !view.refreshing;
  } else if (empty) {
    stateText = TEXTS.empty;
  }
  refs.state.hidden = !stateText || (view.refreshing && !view.firstError && !state.loaded);
  refs.stateText.textContent = stateText;
  refs.stateSpinner.hidden = !stateSpinner;
  refs.stateRetry.hidden = !stateRetry;

  // Footer: loading more, failed, end of the list.
  let footerText = '';
  let footerSpinner = false;
  let footerRetry = false;
  if (!empty && state.loaded) {
    if (view.moreFailed) {
      footerText = `${TEXTS.loadMoreFailed} ·`;
      footerRetry = true;
    } else if (state.hasMore) {
      footerText = state.loading ? TEXTS.loadingMore : '';
      footerSpinner = state.loading;
    } else {
      footerText = TEXTS.allShown(state.total);
    }
  }
  refs.footerText.textContent = footerText;
  refs.footerSpinner.hidden = !footerSpinner;
  refs.footerRetry.hidden = !footerRetry;
}

/** Keeps one card element per id, in the order of the store. */
function renderCards() {
  const { refs, store, cards } = view;
  for (const [id, card] of cards) {
    if (!store.state.ids.has(id)) {
      if (view.observer) view.observer.unobserve(card.element);
      card.element.remove();
      cards.delete(id);
    }
  }
  let previous = null;
  for (const row of store.state.items) {
    let card = cards.get(row.id);
    if (!card) {
      card = createCard(row);
      cards.set(row.id, card);
    }
    const expected = previous ? previous.nextSibling : refs.cards.firstChild;
    if (card.element !== expected) refs.cards.insertBefore(card.element, expected);
    if (!card.observed) {
      card.observed = true;
      if (view.observer) view.observer.observe(card.element);
      else loadPhoto(card);
    }
    previous = card.element;
  }
}

function createCard(row) {
  const holder = document.createElement('div');
  const refs = renderTemplate(holder, 'card');
  const element = holder.firstElementChild;
  const member = row.Member || {};
  element.dataset.id = String(row.id);
  refs.name.textContent = memberName(member) || memberNumber(row.registrationNumber);
  refs.number.textContent = memberNumber(member.registrationNumber ?? row.registrationNumber);
  refs.start.textContent = timeInZone(row.checkInTime, view.timeZone);
  refs.activity.textContent = (row.Activity && row.Activity.name) || '—';
  refs.end.textContent = timeInZone(row.checkOutTime, view.timeZone);
  refs.photo.addEventListener('error', () => {
    if (!refs.photo.src.endsWith(photos.DEFAULT_AVATAR)) refs.photo.src = photos.DEFAULT_AVATAR;
  });
  return { element, photo: refs.photo, path: member.profileImage || null, observed: false };
}

function loadPhoto(card) {
  if (card.loading) return;
  card.loading = true;
  photos.load(card.path).then((url) => {
    if (card.element.isConnected && url !== photos.DEFAULT_AVATAR) card.photo.src = url;
  });
}

function onCardsVisible(entries) {
  if (!view) return;
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    view.observer.unobserve(entry.target);
    const card = view.cards.get(Number(entry.target.dataset.id));
    if (card) loadPhoto(card);
  }
}
