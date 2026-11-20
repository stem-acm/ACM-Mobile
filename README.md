# iPass Badge Check (ACM-Mobile)

Android app for admins and volunteers. It scans the QR code of a member badge and tells whether
the member is checked in for the current slot. The app never creates a check-in.

Plain HTML/CSS/JS (no framework, no bundler), Capacitor 6.2.1, `webDir: "src"`.
Plan: `../MOBILE-APP-IMPLEMENTATION-PLAN.md`, section 9.

Status: tasks M1–M12 done in code (scaffold, build scripts, router and native adapter, API
client and session, member photos, schedule and time formats, screen 2 "Checked in now",
scanner, results 4a–4e, Login and 1b, icon and splash, this README). The checks that need a
phone are listed under "Device checks still open".

## Requirements

- Node 18 or later (developed with Node 20.17), npm.
- To build the APK: JDK 17, Android Studio with SDK Platform 34 and build-tools (plan R1).

## Commands

| Command | What it does |
|---------|--------------|
| `npm install` | Installs the exact plugin versions of `package-lock.json`. |
| `npm run build:local` | `src/config.js` + `capacitor.config.json` for the local Docker stack (`http://10.0.2.2:5002`, cleartext on), then `npx cap sync android`. |
| `npm run build:local -- --api http://<LAN IP>:5002` | The same, for a real phone on the LAN. `--api` is refused for staging and prod. |
| `npm run build:staging` | `https://ipass-staging.srv2134605.hstgr.cloud`, cleartext off. |
| `npm run build:prod` | `https://ipass.srv2134605.hstgr.cloud`, cleartext off. |
| `npm run dev` | Static server for `src/` on port 3000 (`PORT=… npm run dev` for another port). Run a build first. |
| `npm test` | `node --test tests/` (no test framework to install). |

Add `--no-sync` to a build command (`npm run build:local -- --no-sync`) to write the two files
without `cap sync`.

`src/config.js` and `capacitor.config.json` are generated and git-ignored. Staging and
production refuse an API URL that does not start with `https://`.

## Build the APK

`npx cap add android` is never run again: `android/` is committed. Rule: local = debug only;
production = release only; staging = debug, or release when the test must cover the signed
build. Before each production build raise `versionCode` and `versionName` in
`android/app/build.gradle` and commit.

### On the Android Studio computer (plan R1, R2)

One-time setup: Node 18 or later, JDK 17, Android Studio with SDK Platform 34 and build-tools,
`git clone` of this repository. Release only: create the keystore on this computer and write
`android/keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`); both
stay outside git (`git status` must not list them), with a backup in a safe place: a lost
keystore means that no update can be installed over the old app.

```
git pull
npm install
npm run build:local          # or build:staging / build:prod (writes the config, runs cap sync)
npx cap open android         # then Run in Android Studio
# or, without the IDE:
cd android && ./gradlew assembleDebug      # local, staging
cd android && ./gradlew assembleRelease    # production, signed
```

### On this Mac, without Android Studio

JDK 17 and the Android SDK are installed in the user folders:

```
export JAVA_HOME=$HOME/Library/Java/JavaVirtualMachines/jdk-17.0.21.1+2/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
npm run build:local && (cd android && ./gradlew assembleDebug)
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk` (release:
`android/app/build/outputs/apk/release/app-release.apk`). No emulator or device is installed on
this Mac: copy the APK to a phone (`adb install -r app-debug.apk`, or a file transfer). A debug
APK and a release APK have different signatures: uninstall before changing from one to the
other.

Acceptance (plan R2): the login screen of a staging build shows "staging"; a production build
shows no environment name and no "simulate a scan" box.

## Desktop browser

`js/native.js` is the only file that touches `window.Capacitor`. In a desktop browser:

- Android back button = the Escape key; pause/resume = tab visibility;
- minimize, haptics, privacy screen: no-op;
- token storage: `sessionStorage`;
- **fixture mode** (default in the browser): a fake API (`js/fixtures.js`, `createFixtureFetch`)
  answers login, launch check, schedule, in-room (47 check-ins, cursor pages of 20), photos and
  the SSE stream (a new check-in every 20 s). Any username and password signs in; username
  `intern` gives screen 1b; password `wrong` gives "Invalid username or password".
  Add `?fixtures=0` to the URL to use the real API of `config.js` instead, for example after
  `npm run build:local -- --api http://localhost:5002 --no-sync` (the backend accepts all
  origins with `NODE_ENV=development`);
- verify: badge 42 → Checked in, 18 → Not checked in, 57 → No slot (with the fixture signature
  `0123456789abcdef` × 4), any other badge → Badge not recognized, 99 → HTTP 500 (to try
  Retry on 4e);
- the camera scanner is not available. With a `build:local` config the scanner shows the
  "Local build only · simulate a scan" box; from the browser console a code can be sent with
  `(await import('/js/screens/scanner.js')).handleScannedText('<QR text>')`.

## Android settings (M1)

- `appId` `com.stemacm.ipasscheck`, name "iPass Badge Check".
- `android/variables.gradle`: `minSdkVersion 22`, `compileSdkVersion 34`, `targetSdkVersion 34`.
- `AndroidManifest.xml`: `CAMERA` and `FLASHLIGHT` permissions; `android.hardware.camera`,
  `camera.autofocus`, `camera.flash` features with `required="false"`; `allowBackup="false"`;
  activity `screenOrientation="portrait"`; ML Kit meta-data `barcode_ui`.
- `android/app/build.gradle`: `dataBinding` (ML Kit plugin README); `signingConfigs.release`
  read from `android/keystore.properties` when it exists; `versionCode 1`, `versionName 0.1.0`.
- Cleartext: only the two Capacitor options written by `build:local`
  (`server.cleartext`, `android.allowMixedContent`). `cap sync` then writes
  `android:usesCleartextTraffic="true"` into
  `android/capacitor-cordova-android-plugins/src/main/AndroidManifest.xml` (generated,
  git-ignored); `build:staging` / `build:prod` write it without the attribute. No debug manifest
  override was added.

## Plugin versions (exact, checked with `npm view` on 2026-11-20)

| Package | Version | Note |
|---------|---------|------|
| `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` | 6.2.1 | as agreed |
| `@capacitor/app` | 6.0.3 | latest 6.x |
| `@capacitor/haptics` | 6.0.3 | latest 6.x |
| `@capacitor-mlkit/barcode-scanning` | 6.2.0 | latest 6.x |
| `@capacitor-community/privacy-screen` | 5.2.1 | 6.x of this plugin needs `@capacitor/core >= 7`; 5.2.x is the line for Capacitor 6 |
| `@aparajita/capacitor-secure-storage` | 6.0.1 | candidate of the plan; plugin `minSdkVersion` 22 |

## Screens

| Screen | Behaviour |
|--------|-----------|
| 1 Login | Logo, "iPass Badge Check", "Sign in with your iPass account", Username, Password with the show-password button, message box, "Sign in" (disabled while the request runs). Non-production builds show `ENV_NAME`. Error texts: `js/auth.js` `MESSAGES`. |
| 1b Role not allowed | Lock icon, the two texts, "Signed in as <username>" with the role chip, "Sign in with another account" → Login. The token is already deleted. After a 403 during a session the account of the last login/launch check is shown. |
| 2 Checked in now | See plan M7. Only screen with a sign-out control. |
| 3 Scanner | ✕ (→ list) and "Badge check" only. Slot card from `GET /api/checkins/schedule` (at mount and every 60 s): "Current slot · open", "No slot now · next slot", "Closed today · next slot". Back camera only (`lensFacing: 'BACK'`), continuous scan; the same QR text within 3 s is ignored (`js/qr.js`). A text that is not `{"registrationNumber": <positive integer>, "signature": <64 hex>}` gives 4d at once, without a network call. A badge stops the camera, shows "Checking…" and calls `POST /api/checkins/verify` (timeout 8 s, `js/verify.js`). Torch button when the device has a flash. Camera refused → text and "Open settings". No camera → "This device has no back camera". Local build only: the "simulate a scan" box (Checked in, Not checked, No slot, Invalid, Offline, Intern login), not in the DOM of the other builds. |
| 4a–4d Results | Full screen, haptic + beep (`js/feedback.js`), no timer, FLAG_SECURE on while shown (`PrivacyScreen.enable()` at mount, `disable()` at unmount). "Scan next" → scanner, "Back to list" → list, Android back → list. |
| 4e Cannot verify | 429, 5xx, timeout, network, or a 200 that is not a known status. "Scanned badge · Member #N" only, never a status. "Retry" sends the same badge again (button disabled while it runs; success → 4a–4d with a new beep, failure → stays without a beep); "Back to scanner". |

401 on any call → Login "Session expired"; 403 → screen 1b (plan M4). A 422 of verify → 4d.

## App icon and splash (M11)

`android/app/src/main/res`: `mipmap-*/ic_launcher.png` (rounded square), `ic_launcher_round.png`
(circle), `ic_launcher_foreground.png` (adaptive icon, white glyph in the 66 dp safe zone) on the
background colour `#1F4FD8` (`values/ic_launcher_background.xml`), and `drawable*/splash.png`
(logo on `#F6F7F9`). The glyph is the logo of the Login mockup. Launcher name:
`values/strings.xml` `app_name` = "iPass Badge Check".

## Test badge

A badge QR is `{"registrationNumber":<n>,"signature":"<HMAC-SHA256 hex of n with QR_SECRET>"}`.
On the local Docker stack open the member card on the web (Cards page) on the Mac screen and scan
it with the phone; `GET /api/members/registration/<n>/qr-code` (permission `members.cards`) returns the same object. A check-in
is made on the web check-in page. Without a camera, use the "simulate a scan" box of a local
build.

## M1 spike: device checks still open


The debug APK builds on this Mac (see "Build the APK"), but no emulator or phone is available
here: nothing was run on a device. The answers below come from the plugin sources only; each must be confirmed on one real phone and one
emulator, then written here.

| # | Question | What the sources say | Device answer |
|---|----------|----------------------|---------------|
| 1 | Does `startScan({ formats: ['QR_CODE'], lensFacing: 'BACK' })` work without a module download from Google Play services? (K4) | `startScan` uses the bundled `com.google.mlkit:barcode-scanning` (variable `mlkitBarcodeScanningVersion`, default 17.1.0); the Play services module is for `scan()` only. | TODO |
| 2 | Event name and torch methods | README of 6.2.0: `barcodeScanned` (one code, `event.barcode.rawValue`) and `barcodesScanned`; native methods `isTorchAvailable`, `toggleTorch`, `enableTorch`, `disableTorch`. `native.js` uses `barcodeScanned`. | TODO |
| 3 | How to detect "no back camera" | `isSupported()` (FEATURE_CAMERA_ANY) false, or `startScan` rejects with the CameraX message "unable to resolve a camera" / "No available camera" (`native.isNoCameraMessage`). Other errors show "The camera could not start" + Try again. | TODO |
| 4 | Does the privacy screen start disabled with `enable: false`, and do `enable()`/`disable()` switch FLAG_SECURE at run time? | The plugin reads `getConfig().getBoolean("enable", …)` at load; `enable: false` is in `env/capacitor.base.json`. | TODO |
| 5 | Does secure storage work at `minSdkVersion` 22? | Plugin `minSdkVersion` 22 (Android Keystore). `native.js` calls the raw bridge methods `internalGetItem/SetItem/RemoveItem` with `prefixedKey`, because the JS wrapper is not loaded without a bundler. | TODO |
| 6 | HTTP to `10.0.2.2:5002` works in the local build and fails in a staging build | See "Cleartext" above. If Android 9+ still blocks HTTP, add `android/app/src/debug/AndroidManifest.xml` with `usesCleartextTraffic="true"` (debug source set only). | TODO |
| 7 | Does a `fetch` stream of `/api/sse/checkins` with the `Authorization` header deliver events in the WebView? (K1) | Not testable without a device. Fallback: `EventSource` with `?auth=`. | TODO |

Also to check on the device: the app starts from `npm run build:local` (acceptance of M1);
the Android back button follows the table of M3; pause/resume reach the current screen; the
transparent page while scanning (class `scanner-active` on `<html>` and `<body>`, risk K11);
the camera permission prompt, "Open settings" and the return from the settings; the torch;
FLAG_SECURE on results (screenshot refused, black in the app switcher) and off on screen 2;
haptics and beep; the launcher icon and the splash; the manual cases L1–L11, S1–S12, V1–V14 of
plan section 11.4.

## Layout

```
env/                  capacitor.base.json, local.json, staging.json, prod.json
scripts/              build-config.js, dev-server.js
src/                  index.html (one <template> per screen), style.css, config.js (generated)
src/js/               app.js, router.js, nav.js, native.js, fixtures.js, screens/*,
                      api.js, storage.js, auth.js (M4), photos.js (M5), schedule.js, format.js (M6),
                      listStore.js, sse.js (M7), qr.js, verify.js (M8), feedback.js (M9)
src/assets/           avatar.svg (default member photo)
tests/                router, buildConfig, api, auth, photos, format, schedule, listStore, sse,
                      qr, verify, screens
android/              Capacitor Android project (committed)
```
