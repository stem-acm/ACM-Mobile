// Screen 3 "Scanner" (plan M8).
//
// Header: ✕ (→ list) and "Badge check", nothing else. Current-slot card from the schedule,
// loaded at mount and every 60 s. Back camera only (no switch button), continuous scan; the
// camera is drawn behind the WebView, so the body class `scanner-active` makes the page
// transparent while it runs (risk K11). Torch button when the device has a flash.
//
// Each code: the same text within 3 s is ignored (qr.js); a text that is not an iPass badge
// opens 4d at once, without a network call; a badge stops the scan, shows "Checking…" and is
// sent to POST /api/checkins/verify (verify.js), then the result screen opens.
//
// Local build only (APP_CONFIG.LOCAL_BUILD): the box "Local build only · simulate a scan"
// opens each result with fixture data, without a network call.

import { go } from '../nav.js';
import { api } from '../api.js';
import * as native from '../native.js';
import * as schedule from '../schedule.js';
import { slotLabel } from '../format.js';
import { createScanMemory, parseBadge } from '../qr.js';
import { notABadgeParams, verifyBadge } from '../verify.js';
import { simulatedScans } from '../fixtures.js';
import { renderTemplate } from './dom.js';

const SLOT_REFRESH_MS = 60000;

/** Texts of the scanner states that are not in the mockups (plan Q4). */
export const TEXTS = Object.freeze({
  hint: 'Point the back camera at the QR code on the badge',
  browserHint: 'The camera works in the Android app only.',
  permissionTitle: 'Camera access is off',
  permissionText: 'Allow the camera for iPass Badge Check in the app settings to scan badges.',
  openSettings: 'Open settings',
  noBackCamera: 'This device has no back camera',
  failedTitle: 'The camera could not start',
  failedText: 'Close the other apps that use the camera, then try again.',
  tryAgain: 'Try again',
  slotOpen: 'Current slot · open',
  slotNone: 'No slot now · next slot',
  slotClosed: 'Closed today · next slot',
  closedToday: 'Closed today',
  noSlotPlanned: 'No slot planned',
  slotLoading: 'Current slot',
  scheduleError: 'Cannot load the schedule',
  simulateTitle: 'Local build only · simulate a scan',
});

/** The scanner memory lives as long as the app: "Scan next" does not read the same badge at once. */
const memory = createScanMemory();

let view = null;

export function mount(root) {
  const refs = renderTemplate(root, 'scanner');
  view = {
    refs,
    stopScan: null, // stops the running camera
    cameraSeq: 0, // a start that finishes after a stop or an unmount is cancelled
    starting: null,
    torchOn: false,
    controller: null, // verify request
    slotTimer: null,
    scheduleFailed: false,
  };
  memory.setBusy(false);

  refs.close.addEventListener('click', () => go('list'));
  refs.torch.addEventListener('click', onTorch);
  if (window.APP_CONFIG && window.APP_CONFIG.LOCAL_BUILD === true) {
    refs.simulateSlot.replaceWith(simulateBox());
  } else {
    refs.simulateSlot.remove();
  }

  renderSlot();
  loadSlot();
  view.slotTimer = setInterval(loadSlot, SLOT_REFRESH_MS);
  startCamera();
}

export async function unmount() {
  if (!view) return;
  const v = view;
  view = null;
  clearInterval(v.slotTimer);
  if (v.controller) v.controller.abort();
  memory.setBusy(false);
  await stopCamera(v);
}

/** App paused: stop the scan, torch off (plan M3). */
export async function pause() {
  if (view) await stopCamera(view);
}

/** App resumed (also after the app settings): restart the camera and the slot card. */
export function resume() {
  if (!view) return;
  loadSlot();
  if (!view.controller) startCamera();
}

// ---------------------------------------------------------------- Slot card

function loadSlot() {
  const v = view;
  if (!v) return;
  schedule
    .load(api)
    .then(() => {
      v.scheduleFailed = false;
    })
    .catch(() => {
      v.scheduleFailed = true;
    })
    .finally(() => {
      if (view === v) renderSlot();
    });
}

/** Label and value of the slot card for an overview of `schedule.slotOverview`. */
export function slotCardText(overview) {
  if (overview.slot) return { open: true, label: TEXTS.slotOpen, value: slotLabel(overview.slot) };
  const next = overview.nextSlot ? slotLabel(overview.nextSlot) : null;
  if (!next) return { open: false, label: TEXTS.closedToday, value: TEXTS.noSlotPlanned };
  return { open: false, label: overview.closedToday ? TEXTS.slotClosed : TEXTS.slotNone, value: next };
}

function renderSlot() {
  if (!view) return;
  const { slotLabel: label, slotValue, slotDot } = view.refs;
  const cached = schedule.cached();
  let text = { open: null, label: TEXTS.slotLoading, value: view.scheduleFailed ? TEXTS.scheduleError : '…' };
  if (cached) {
    try {
      text = slotCardText(schedule.slotOverview(schedule.now(), cached.schedule, cached.timezone));
    } catch {
      /* unknown zone: keep the loading text */
    }
  }
  label.textContent = text.label;
  slotValue.textContent = text.value;
  slotDot.classList.toggle('open', text.open === true);
  slotDot.classList.toggle('closed', text.open === false);
}

// ---------------------------------------------------------------- Camera

function showMessage(title, text = '', action = null) {
  const { refs } = view;
  refs.frame.hidden = Boolean(title);
  refs.hint.hidden = Boolean(title);
  refs.message.hidden = !title;
  refs.messageTitle.textContent = title || '';
  refs.messageText.textContent = text;
  refs.messageText.hidden = !text;
  refs.messageAction.hidden = !action;
  refs.messageAction.onclick = null;
  if (action) {
    refs.messageAction.textContent = action.label;
    refs.messageAction.onclick = action.run;
  }
}

function startCamera() {
  const v = view;
  if (!v) return Promise.resolve();
  if (v.starting) return v.starting;
  v.starting = doStartCamera(v).finally(() => {
    v.starting = null;
  });
  return v.starting;
}

async function doStartCamera(v) {
  if (v.stopScan) return;
  const seq = ++v.cameraSeq;
  const live = () => view === v && seq === v.cameraSeq;
  showMessage(null);

  if (!native.hasScanner()) {
    // Desktop browser: no camera; the frame stays as a picture.
    v.refs.hint.textContent = TEXTS.browserHint;
    return;
  }
  v.refs.hint.textContent = TEXTS.hint;

  try {
    if (!(await native.isCameraSupported())) {
      if (live()) showMessage(TEXTS.noBackCamera);
      return;
    }
    let permission = await native.checkCameraPermission();
    if (!live()) return;
    if (permission !== 'granted' && permission !== 'limited') {
      permission = await native.requestCameraPermission();
      if (!live()) return;
    }
    if (permission !== 'granted' && permission !== 'limited') {
      showMessage(TEXTS.permissionTitle, TEXTS.permissionText, {
        label: TEXTS.openSettings,
        run: () => native.openAppSettings().catch(() => {}).then(() => startCamera()),
      });
      return;
    }

    const stop = await native.startQrScan((raw) => handleScannedText(raw));
    if (!live()) {
      await stop().catch(() => {});
      return;
    }
    v.stopScan = stop;
    setTransparent(true);
    const torch = await native.isTorchAvailable().catch(() => false);
    if (live()) v.refs.torch.hidden = !torch;
  } catch (error) {
    if (!live()) return;
    console.warn('scanner: camera failed', error);
    if (error && error.code === native.NO_BACK_CAMERA) {
      showMessage(TEXTS.noBackCamera);
    } else {
      showMessage(TEXTS.failedTitle, TEXTS.failedText, { label: TEXTS.tryAgain, run: () => startCamera() });
    }
  }
}

/** The page is transparent while the camera runs behind the WebView. */
function setTransparent(on) {
  document.documentElement.classList.toggle('scanner-active', on);
  document.body.classList.toggle('scanner-active', on);
}

async function stopCamera(v) {
  v.cameraSeq++;
  setTransparent(false);
  v.refs.torch.hidden = true;
  setTorch(v, false);
  const stop = v.stopScan;
  v.stopScan = null;
  if (v.torchOn) await native.disableTorch().catch(() => {});
  v.torchOn = false;
  if (stop) await stop().catch((error) => console.warn('scanner: stop failed', error));
}

function setTorch(v, on) {
  v.refs.torch.setAttribute('aria-pressed', String(on));
  v.refs.torch.setAttribute('aria-label', on ? 'Turn off torch' : 'Turn on torch');
  v.refs.torch.classList.toggle('on', on);
}

async function onTorch() {
  const v = view;
  if (!v || !v.stopScan) return;
  try {
    await native.toggleTorch();
    v.torchOn = !v.torchOn;
    setTorch(v, v.torchOn);
  } catch (error) {
    console.warn('scanner: torch failed', error);
  }
}

// ---------------------------------------------------------------- Codes

/**
 * One code from the camera (also usable from the console of the desktop browser).
 * @param {string} raw
 */
export async function handleScannedText(raw, now = Date.now()) {
  const v = view;
  if (!v || !memory.accept(raw, now)) return;
  const badge = parseBadge(raw);
  memory.setBusy(true);
  if (!badge) {
    // Not an iPass badge: 4d at once, no network call.
    await go('result', notABadgeParams());
    return;
  }

  v.refs.checking.hidden = false;
  v.refs.line.hidden = true;
  await stopCamera(v);
  v.controller = new AbortController();
  const params = await verifyBadge(api.request, badge, { signal: v.controller.signal });
  if (view !== v) return; // left during the request (✕, back, 401/403)
  v.controller = null;
  memory.setBusy(false);
  if (params) {
    await go('result', params);
    return;
  }
  v.refs.checking.hidden = true;
  v.refs.line.hidden = false;
  startCamera();
}

// ---------------------------------------------------------------- Local build

function simulateBox() {
  const box = document.createElement('div');
  box.className = 'simulate';
  const title = document.createElement('span');
  title.className = 'simulate-title';
  title.textContent = TEXTS.simulateTitle;
  const grid = document.createElement('div');
  grid.className = 'simulate-grid';
  for (const item of simulatedScans) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'simulate-btn';
    button.textContent = item.label;
    button.addEventListener('click', () => go(item.screen, item.params));
    grid.append(button);
  }
  box.append(title, grid);
  return box;
}
