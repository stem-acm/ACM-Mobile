// Screens 4a–4e "Result" (plan M9). Full screen, one haptic and one beep at mount, no timer:
// the screen stays until a button or the Android back button (→ list) is used. FLAG_SECURE is
// on while the screen is shown (privacy screen), off at unmount: every way out goes through
// unmount, the 401/403 rule included.
//
//   4a CHECKED_IN      green   "Checked in"            photo, name, number, Activity
//   4b NOT_CHECKED_IN  red     "Not checked in"        photo, name, number, explanation
//   4c NO_SLOT         grey    "No check-in slot now"  name, number, today's slots
//   4d INVALID_BADGE   orange  "Badge not recognized"  the three possible causes
//   4e error           light   "Cannot verify"         the scanned number only, Retry
//
// 4a–4d: "Scan next" → scanner, "Back to list" → list. 4e: "Retry" sends the same badge
// again, "Back to scanner" → scanner. Only server data is shown; 4e never shows a status.

import { go } from '../nav.js';
import { api } from '../api.js';
import { disablePrivacyScreen, enablePrivacyScreen } from '../native.js';
import * as photos from '../photos.js';
import { play } from '../feedback.js';
import { dayName, memberName, slotLabel } from '../format.js';
import { variantOf, verifyBadge } from '../verify.js';
import { renderTemplate } from './dom.js';

export const TEXTS = Object.freeze({
  checkedIn: 'Checked in',
  forThisSlot: (slot) => `For this slot · ${slot}`,
  notCheckedIn: 'Not checked in',
  noScanInSlot: (slot) => `No scan in this slot · ${slot}`,
  noCheckinForSlot: 'The member has no check-in for the current slot.',
  noSlot: 'No check-in slot now',
  betweenSlots: 'between two slots',
  beforeFirstSlot: "before today's first slot",
  afterLastSlot: "after today's last slot",
  closedToday: 'closed today',
  todaysSlots: "Today's slots",
  ended: 'Ended',
  next: 'Next',
  nextSlot: 'Next slot',
  scanAgain: 'Scan the badge again during the next slot.',
  invalid: 'Badge not recognized',
  invalidSubtitle: 'This QR code is not a valid iPass badge',
  possibleCauses: 'Possible causes',
  causes: ['Signature does not match', 'Member no longer exists', 'Not an iPass QR code'],
  contactAdmin: 'Contact an admin.',
  cannotVerify: 'Cannot verify',
  cannotVerifyText: 'The app could not reach iPass. Check the network and try again.',
  scannedBadge: 'Scanned badge',
  tapRetry: 'Tap Retry when the connection is back.',
  member: (n) => `Member #${n}`,
  activity: 'Activity',
  scanNext: 'Scan next',
  backToList: 'Back to list',
  retry: 'Retry',
  retrying: 'Retrying…',
  backToScanner: 'Back to scanner',
});

const ICONS = {
  '4a': '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  '4b': '<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
  '4c': '<svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  '4d': '<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  '4e': '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M10.7 5.1A15 15 0 0 1 22 8.8"/><path d="M5 12.9a10 10 0 0 1 5.2-2.6"/><path d="M16.7 11a10 10 0 0 1 2.3 1.9"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01"/><path d="M3 3l18 18"/></svg>',
};

const INFO_ICON =
  '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

/**
 * Subtitle of 4c: `Friday 12:40 · between two slots`, from the server clock (`now`) and
 * `todaySlots`.
 */
export function noSlotSubtitle(result) {
  const now = result.now ? `${dayName(result.now.day)} ${result.now.time}` : '';
  const slots = Array.isArray(result.todaySlots) ? result.todaySlots : [];
  let where = TEXTS.betweenSlots;
  if (result.closedToday || slots.length === 0) where = TEXTS.closedToday;
  else if (!slots.some((slot) => slot.state === 'ended')) where = TEXTS.beforeFirstSlot;
  else if (!slots.some((slot) => slot.state === 'next' || slot.state === 'later')) where = TEXTS.afterLastSlot;
  return now ? `${now} · ${where}` : where;
}

let view = null;

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mount(root, params = {}) {
  const refs = renderTemplate(root, 'result');
  view = { refs, params, retrying: false };
  enablePrivacyScreen().catch((error) => console.warn('result: privacy screen failed', error));
  const variant = variantOf(params) || '4d';
  render(variant, params);
  play(variant);
}

export function unmount() {
  view = null;
  disablePrivacyScreen().catch((error) => console.warn('result: privacy screen failed', error));
}

function render(variant, params) {
  const { refs } = view;
  const result = params.result || {};
  refs.screen.dataset.variant = variant;
  refs.icon.innerHTML = ICONS[variant];
  refs.card.replaceChildren();

  if (variant === '4a') {
    refs.title.textContent = TEXTS.checkedIn;
    refs.subtitle.textContent = TEXTS.forThisSlot(slotLabel(result.slot));
    memberBlock(result.member, true);
    refs.card.append(el('div', 'divider'));
    const facts = el('dl', 'result-facts');
    const fact = el('div');
    fact.append(el('dt', 'label-caps', TEXTS.activity), el('dd', '', (result.checkIn && result.checkIn.activity) || '—'));
    facts.append(fact);
    refs.card.append(facts);
  } else if (variant === '4b') {
    refs.title.textContent = TEXTS.notCheckedIn;
    refs.subtitle.textContent = TEXTS.noScanInSlot(slotLabel(result.slot));
    memberBlock(result.member, true);
    refs.card.append(el('div', 'divider'));
    const info = el('div', 'result-info');
    info.innerHTML = INFO_ICON;
    info.append(el('span', '', TEXTS.noCheckinForSlot));
    refs.card.append(info);
  } else if (variant === '4c') {
    refs.title.textContent = TEXTS.noSlot;
    refs.subtitle.textContent = noSlotSubtitle(result);
    memberBlock(result.member, false);
    refs.card.append(el('div', 'divider'));
    refs.card.append(slotsBlock(result));
    refs.card.append(el('p', 'result-note', TEXTS.scanAgain));
  } else if (variant === '4d') {
    refs.title.textContent = TEXTS.invalid;
    refs.subtitle.textContent = TEXTS.invalidSubtitle;
    refs.card.append(el('span', 'label-caps', TEXTS.possibleCauses));
    const list = el('ul', 'causes');
    for (const cause of TEXTS.causes) list.append(el('li', '', cause));
    refs.card.append(list, el('div', 'divider'), el('p', 'result-note', TEXTS.contactAdmin));
  } else {
    refs.title.textContent = TEXTS.cannotVerify;
    refs.subtitle.textContent = TEXTS.cannotVerifyText;
    const number = params.badge ? params.badge.registrationNumber : '?';
    refs.card.append(
      el('span', 'label-caps', TEXTS.scannedBadge),
      el('span', 'scanned-number', TEXTS.member(number)),
      el('span', 'result-note', TEXTS.tapRetry)
    );
  }

  if (variant === '4e') {
    setButton(refs.primary, TEXTS.retry, onRetry);
    setButton(refs.secondary, TEXTS.backToScanner, () => go('scanner'));
  } else {
    setButton(refs.primary, TEXTS.scanNext, () => go('scanner'));
    setButton(refs.secondary, TEXTS.backToList, () => go('list'));
  }
}

function setButton(button, label, onClick) {
  button.textContent = label;
  button.disabled = false;
  button.onclick = onClick;
}

function memberBlock(member, withPhoto) {
  const { refs } = view;
  const row = el('div', withPhoto ? 'result-member' : 'result-member compact');
  if (withPhoto) {
    const img = el('img', 'result-photo');
    img.alt = '';
    img.src = photos.DEFAULT_AVATAR;
    img.addEventListener('error', () => {
      if (!img.src.endsWith(photos.DEFAULT_AVATAR)) img.src = photos.DEFAULT_AVATAR;
    });
    const current = view;
    photos.load(member && member.photoUrl).then((url) => {
      if (view === current && url !== photos.DEFAULT_AVATAR) img.src = url;
    });
    row.append(img);
  }
  const id = el('div', 'result-id');
  id.append(
    el('span', 'result-name', memberName(member)),
    el('span', 'result-number', member ? TEXTS.member(member.registrationNumber) : '')
  );
  row.append(id);
  refs.card.append(row);
}

function slotsBlock(result) {
  const block = el('div', 'today-slots');
  const slots = Array.isArray(result.todaySlots) ? result.todaySlots : [];
  if (slots.length) {
    block.append(el('span', 'label-caps', TEXTS.todaysSlots));
    for (const slot of slots) {
      const row = el('div', `slot-row slot-${slot.state}`);
      row.append(el('span', '', slotLabel({ start: slot.start, end: slot.end })));
      if (slot.state === 'ended') row.append(el('span', 'slot-state', TEXTS.ended));
      else if (slot.state === 'next') row.append(el('span', 'chip chip-blue', TEXTS.next));
      else row.append(el('span', 'slot-state'));
      block.append(row);
    }
  }
  // After the last slot of today, or on a closed day: the next slot is on another day.
  if (result.nextSlot && !slots.some((slot) => slot.state === 'next')) {
    block.append(el('span', 'label-caps', TEXTS.nextSlot));
    const row = el('div', 'slot-row slot-next');
    row.append(el('span', '', slotLabel(result.nextSlot)), el('span', 'chip chip-blue', TEXTS.next));
    block.append(row);
  }
  return block;
}

/** 4e Retry: the same badge again. Success → the matching variant; failure → stays, no beep. */
async function onRetry() {
  const v = view;
  if (!v || v.retrying) return;
  const { badge } = v.params;
  if (!badge) return;
  v.retrying = true;
  const { primary } = v.refs;
  primary.disabled = true;
  primary.replaceChildren(el('span', 'spinner spinner-light'), document.createTextNode(` ${TEXTS.retrying}`));
  const params = await retryVerify(api.request, v.params);
  if (view !== v) return; // left, or the 401/403 rule navigated
  v.retrying = false;
  if (params && !params.error) {
    v.params = params;
    const variant = variantOf(params);
    render(variant, params);
    play(variant);
    return;
  }
  setButton(primary, TEXTS.retry, onRetry);
}

/**
 * Sends the badge of 4e params again (exported for the tests).
 * @returns {Promise<object|null>} params of the result screen, or null
 */
export function retryVerify(request, params) {
  return verifyBadge(request, params.badge);
}
