# iPass Badge Check (ACM-Mobile)

Android app for iPass admins and volunteers. It scans the QR code of a member badge and tells
whether the member is checked in for the current slot. The app reads only: it never creates a
check-in (check-ins are made at the kiosk).

Plain HTML/CSS/JS (no framework, no bundler) wrapped with Capacitor 6.2.1, `webDir: "src"`.
App ID `com.stemacm.ipasscheck`, name "iPass Badge Check".

The app needs the iPass backend with the `checkins.verify` permission and the badge check API
(stem-acm/ACM-Backend#71), and `https://localhost` in the backend's `ALLOWED_ORIGINS`
(stem-acm/infra#25).

## Requirements

- Node 18 or later, npm.
- To build the APK: JDK 17 and the Android SDK (SDK Platform 34, build-tools 34.0.0), either
  through Android Studio or the Android command-line tools.

## Environments

| Build | API | Notes |
|-------|-----|-------|
| local | `http://10.0.2.2:5002` (the host machine, seen from the Android emulator) | Plain HTTP allowed. Shows the "Local build only · simulate a scan" box on the scanner. |
| staging | `https://ipass-staging.srv2134605.hstgr.cloud` | HTTPS only. The login screen shows "STAGING". |
| production | `https://ipass.srv2134605.hstgr.cloud` | HTTPS only. No environment label, no simulate box. |

The API address is written into the app at build time; the app has no setting to change it.

## Commands

| Command | What it does |
|---------|--------------|
| `npm install` | Installs the exact versions of `package-lock.json`. |
| `npm run build:local` | Writes `src/config.js` and `capacitor.config.json` for the local build, then runs `npx cap sync android`. |
| `npm run build:local -- --api http://<host>:<port>` | The same with another API address, for example a computer on the same Wi-Fi as a real phone. `--api` is refused for staging and production. |
| `npm run build:staging` | Staging build. |
| `npm run build:prod` | Production build. |
| `npm run dev` | Static server for `src/` on port 3000 (`PORT=… npm run dev` for another port). Run a build first. |
| `npm test` | Unit tests with `node --test` (no test framework to install). |

Add `--no-sync` to a build command (`npm run build:local -- --no-sync`) to write the two files
without `cap sync`.

`src/config.js` and `capacitor.config.json` are generated and git-ignored.

## Build the APK

`android/` is committed: do not run `npx cap add android`.

```
git pull
npm install
npm run build:staging        # or build:local / build:prod (writes the config, runs cap sync)
```

Then either open the project in Android Studio (`npx cap open android`, then Run), or build from
the command line with `JAVA_HOME` pointing to a JDK 17 and `ANDROID_HOME` to the Android SDK:

```
cd android
./gradlew assembleDebug      # local, staging
./gradlew assembleRelease    # production, signed
```

Output:

- debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- release: `android/app/build/outputs/apk/release/app-release.apk`

A debug APK and a release APK have different signatures: uninstall the app before changing from
one to the other.

### Release signing

Production APKs are signed with the release keystore. Android installs an update only when it
has the same signature as the installed app, so every release must use the same keystore.

1. Create the keystore once with `keytool` (comes with the JDK) and keep it, with its passwords,
   in a safe place. A lost keystore means no update can ever be installed over the old app.
2. On the build computer, write `android/keystore.properties`:

   ```
   storeFile=/absolute/path/to/release.jks
   storePassword=…
   keyAlias=…
   keyPassword=…
   ```

   Neither the keystore nor `keystore.properties` goes into git (`.gitignore` covers them).
   Without the file, `assembleRelease` gives an unsigned APK.
3. Before each production release, raise `versionCode` and `versionName` in
   `android/app/build.gradle` and commit.

### Distribution

The production APK is shared directly, person to person (no Play Store). To install it, the
phone must allow installing apps from the source used to receive the file.

## Install on a phone over USB

With USB debugging on and the Android platform tools installed:

```
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

For a local build on a real phone, either build with `--api http://<computer's Wi-Fi address>:5002`
(phone and computer on the same Wi-Fi), or forward the port over USB with
`adb reverse tcp:5002 tcp:5002` and build with `--api http://localhost:5002`.

## Desktop browser

`js/native.js` is the only file that touches `window.Capacitor`. In a desktop browser:

- Android back button = the Escape key; pause/resume = tab visibility;
- minimize, haptics, privacy screen: no-op;
- token storage: `sessionStorage`;
- **fixture mode** (default in the browser): a fake API (`js/fixtures.js`) answers login, launch
  check, schedule, in-room list (47 check-ins, pages of 20), photos and the live stream (a new
  check-in every 20 s). Any username and password signs in; username `intern` gives the "role
  not allowed" screen; password `wrong` gives "Invalid username or password". Add `?fixtures=0`
  to the URL to use the real API of `config.js` instead (a backend with `NODE_ENV=development`
  accepts all origins);
- verify: badge 42 → Checked in, 18 → Not checked in, 57 → No slot (with the fixture signature
  `0123456789abcdef` × 4), any other badge → Badge not recognized, 99 → HTTP 500 (to try Retry);
- the camera is not available. With a local build config the scanner shows the "simulate a
  scan" box; from the browser console a code can be sent with
  `(await import('/js/screens/scanner.js')).handleScannedText('<QR text>')`.

## Screens

| Screen | Behaviour |
|--------|-----------|
| Login | iPass username and password, show-password button, error message, "Sign in". Non-production builds show the environment name. |
| Role not allowed | Shown to a role without `checkins.verify` (interns by default). "Signed in as <username>" with the role, "Sign in with another account". |
| Checked in now (default) | Today's check-ins still in the room, newest first: photo, name, member number, "In room", start time, purpose of visit, end time. Infinite scroll (20 per page), live updates, pull to refresh, "Scan badge" button. Only screen with the sign-out button. |
| Scanner | ✕ (back to the list) and "Badge check". Current slot card, refreshed every minute. Back camera only, continuous scan; the same QR within 3 s is ignored. A QR that is not an iPass badge gives "Badge not recognized" without a network call. Torch button when the device has a flash. Camera refused → "Open settings". |
| Results | Checked in (green), Not checked in (red), No check-in slot now (grey), Badge not recognized (orange). Haptic and beep, no timer, screenshots blocked. Buttons "Scan next" and "Back to list"; Android back = Back to list. |
| Cannot verify | Network error, server error, timeout or rate limit. Shows the member number only, never a guessed status. "Retry" sends the same badge again; "Back to scanner". |

401 on any call → Login with "Session expired"; 403 → "Role not allowed".

## Test badge

A badge QR is `{"registrationNumber":<n>,"signature":"<HMAC-SHA256 hex of n with QR_SECRET>"}`.
Open a member card on the web app (Cards page) and scan it with the phone;
`GET /api/members/registration/<n>/qr-code` (permission `members.cards`) returns the same
object. Check-ins are made on the web check-in page.

## Android settings

- `android/variables.gradle`: `minSdkVersion 22`, `compileSdkVersion 34`, `targetSdkVersion 34`.
- `AndroidManifest.xml`: `CAMERA` and `FLASHLIGHT` permissions; camera, autofocus and flash
  features with `required="false"`; `allowBackup="false"`; portrait only; ML Kit meta-data
  `barcode_ui`.
- `android/app/build.gradle`: `dataBinding` (required by the ML Kit plugin); release signing read
  from `android/keystore.properties` when it exists; `versionCode`, `versionName`.
- Plain HTTP only in the local build, through the Capacitor options `server.cleartext` and
  `android.allowMixedContent` that `build:local` writes.
- App icon and splash in `android/app/src/main/res` (adaptive icon on `#1F4FD8`, splash on
  `#F6F7F9`).

## Plugin versions

| Package | Version | Note |
|---------|---------|------|
| `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` | 6.2.1 | |
| `@capacitor/app` | 6.0.3 | back button, pause/resume |
| `@capacitor/haptics` | 6.0.3 | |
| `@capacitor-mlkit/barcode-scanning` | 6.2.0 | bundled model, no Google Play download |
| `@capacitor-community/privacy-screen` | 5.2.1 | 6.x needs Capacitor 7 |
| `@aparajita/capacitor-secure-storage` | 6.0.1 | login token in the Android Keystore |

## Layout

```
env/                  capacitor.base.json, local.json, staging.json, prod.json
scripts/              build-config.js, dev-server.js
src/                  index.html (one <template> per screen), style.css, config.js (generated)
src/js/               app.js, router.js, nav.js, native.js, fixtures.js, screens/*,
                      api.js, storage.js, auth.js, photos.js, schedule.js, format.js,
                      listStore.js, sse.js, qr.js, verify.js, feedback.js
src/assets/           avatar.svg (default member photo)
tests/                unit tests (node --test)
android/              Capacitor Android project (committed)
```
