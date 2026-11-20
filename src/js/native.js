// The only file that touches window.Capacitor.
//
// Without a bundler the plugins are not imported: they are read from the bridge at run time
// (window.Capacitor.Plugins.<Name>). In a desktop browser (npm run dev) each function has a
// fallback, so the UI can be developed without a phone:
//   - back button:  the Escape key
//   - pause/resume: document visibility
//   - minimize:     a console message
//   - haptics, privacy screen: no-op
//   - token storage: sessionStorage
//   - scanner: not available (the local build has the "simulate a scan" box)
//   - camera: back lens only (`lensFacing: 'BACK'`), no switch

const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;

/** True inside the Android app, false in a desktop browser. */
export const isNative = Boolean(cap && cap.isNativePlatform && cap.isNativePlatform());

function plugin(name) {
  if (!isNative) return null;
  return (cap.Plugins && cap.Plugins[name]) || null;
}

// ---------------------------------------------------------------- App (back, pause/resume)

/**
 * Calls `handler()` when the Android back button is pressed. Returns a function that removes
 * the listener.
 */
export async function onBackButton(handler) {
  const App = plugin('App');
  if (App) {
    const listener = await App.addListener('backButton', () => handler());
    return () => listener.remove();
  }
  const onKey = (event) => {
    if (event.key === 'Escape') handler();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/**
 * Calls `handler(isActive)` when the app goes to the background (false) or comes back (true).
 * Returns a function that removes the listener.
 */
export async function onAppStateChange(handler) {
  const App = plugin('App');
  if (App) {
    const listener = await App.addListener('appStateChange', ({ isActive }) => handler(isActive));
    return () => listener.remove();
  }
  const onVisibility = () => handler(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', onVisibility);
  return () => document.removeEventListener('visibilitychange', onVisibility);
}

/** Leaves the app (Android back on a top-level screen). */
export async function minimizeApp() {
  const App = plugin('App');
  if (App) return App.minimizeApp();
  console.info('native: minimizeApp (no-op in the browser)');
}

// ---------------------------------------------------------------- Haptics

/** @param {'SUCCESS'|'WARNING'|'ERROR'} type */
export async function hapticNotification(type) {
  const Haptics = plugin('Haptics');
  if (!Haptics) return;
  try {
    await Haptics.notification({ type });
  } catch (error) {
    console.warn('native: haptics failed', error);
  }
}

// ---------------------------------------------------------------- Privacy screen (FLAG_SECURE)

export async function enablePrivacyScreen() {
  const PrivacyScreen = plugin('PrivacyScreen');
  if (PrivacyScreen) await PrivacyScreen.enable();
}

export async function disablePrivacyScreen() {
  const PrivacyScreen = plugin('PrivacyScreen');
  if (PrivacyScreen) await PrivacyScreen.disable();
}

// ---------------------------------------------------------------- Secure storage (token)

// Raw bridge methods of @aparajita/capacitor-secure-storage (its JS wrapper is not loaded
// without a bundler). The key prefix is the one of the wrapper.
const STORAGE_PREFIX = 'capacitor-storage_';

/** @returns {Promise<string|null>} */
export async function secureGet(key) {
  const SecureStorage = plugin('SecureStorage');
  if (SecureStorage) {
    const { data } = await SecureStorage.internalGetItem({ prefixedKey: STORAGE_PREFIX + key });
    return data ?? null;
  }
  return sessionStorage.getItem(key);
}

export async function secureSet(key, value) {
  const SecureStorage = plugin('SecureStorage');
  if (SecureStorage) {
    await SecureStorage.internalSetItem({ prefixedKey: STORAGE_PREFIX + key, data: value });
    return;
  }
  sessionStorage.setItem(key, value);
}

export async function secureRemove(key) {
  const SecureStorage = plugin('SecureStorage');
  if (SecureStorage) {
    await SecureStorage.internalRemoveItem({ prefixedKey: STORAGE_PREFIX + key });
    return;
  }
  sessionStorage.removeItem(key);
}

// ---------------------------------------------------------------- Barcode scanner (ML Kit)

/** True when a camera scanner is available (the Android app only). */
export function hasScanner() {
  return Boolean(plugin('BarcodeScanner'));
}

/** `code` of the error of `startQrScan` when the device has no back camera. */
export const NO_BACK_CAMERA = 'NO_BACK_CAMERA';

/**
 * True when an error message of `startScan` means "no camera for this lens". CameraX throws
 * `IllegalArgumentException` with "Provided camera selector unable to resolve a camera for the
 * given use case" or "No available camera can be found" (to confirm on a device, M1 answer 3).
 */
export function isNoCameraMessage(message) {
  return /unable to resolve a camera|no available camera|no camera|camera selector/i.test(String(message || ''));
}

/** False when the device has no camera at all (PackageManager.FEATURE_CAMERA_ANY). */
export async function isCameraSupported() {
  const BarcodeScanner = plugin('BarcodeScanner');
  if (!BarcodeScanner) return false;
  try {
    const { supported } = await BarcodeScanner.isSupported();
    return supported !== false;
  } catch {
    return true; // unknown: let startScan decide
  }
}

function scanner() {
  const BarcodeScanner = plugin('BarcodeScanner');
  if (!BarcodeScanner) throw new Error('The barcode scanner is not available in the browser.');
  return BarcodeScanner;
}

/** @returns {Promise<'granted'|'denied'|'prompt'|'prompt-with-rationale'|'limited'>} */
export async function checkCameraPermission() {
  const { camera } = await scanner().checkPermissions();
  return camera;
}

export async function requestCameraPermission() {
  const { camera } = await scanner().requestPermissions();
  return camera;
}

/**
 * Starts the back camera behind the WebView and calls `onCode(rawText)` for each QR code.
 * Returns a function that stops the scan and removes the listener.
 * The event name is `barcodeScanned` in plugin 6.2.0 (README); confirmed on a device in M1.
 */
export async function startQrScan(onCode) {
  const BarcodeScanner = scanner();
  const listener = await BarcodeScanner.addListener('barcodeScanned', (event) => {
    const raw = event && event.barcode ? event.barcode.rawValue : undefined;
    if (typeof raw === 'string') onCode(raw);
  });
  try {
    await BarcodeScanner.startScan({ formats: ['QR_CODE'], lensFacing: 'BACK' });
  } catch (error) {
    await listener.remove();
    // startScan made the WebView transparent before it failed: stopScan restores it.
    await BarcodeScanner.stopScan().catch(() => {});
    const message = error && error.message ? error.message : String(error);
    const wrapped = new Error(message);
    if (isNoCameraMessage(message)) wrapped.code = NO_BACK_CAMERA;
    throw wrapped;
  }
  return async () => {
    await listener.remove();
    await BarcodeScanner.stopScan();
  };
}

export async function stopQrScan() {
  const BarcodeScanner = plugin('BarcodeScanner');
  if (BarcodeScanner) await BarcodeScanner.stopScan();
}

export async function isTorchAvailable() {
  const BarcodeScanner = plugin('BarcodeScanner');
  if (!BarcodeScanner) return false;
  const { available } = await BarcodeScanner.isTorchAvailable();
  return available;
}

export async function toggleTorch() {
  await scanner().toggleTorch();
}

export async function disableTorch() {
  const BarcodeScanner = plugin('BarcodeScanner');
  if (BarcodeScanner) await BarcodeScanner.disableTorch();
}

/** Opens the Android settings of the app (camera permission refused). */
export async function openAppSettings() {
  await scanner().openSettings();
}
