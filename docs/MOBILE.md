# Android app

The Android app is the existing React SPA running inside a Capacitor 6 WebView.
There is no second codebase and no parallel component tree: every screen, route,
role and permission is the same build that ships to the web, so feature parity
holds by construction rather than by discipline.

What is genuinely mobile lives in three places:

| | |
|---|---|
| [`frontend/src/lib/native.js`](../frontend/src/lib/native.js) | Every native capability, each one a no-op in a browser |
| [`frontend/src/index.css`](../frontend/src/index.css) | Safe areas, keyboard offset, touch minimums, the low-power rendering path |
| [`frontend/capacitor.config.json`](../frontend/capacitor.config.json) | App id, scheme, splash/status-bar/keyboard plugin config |

## Build and run

```bash
cd frontend
VITE_API_URL=https://sedbank-api.onrender.com npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The APK lands at `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.
For a release build, `./gradlew assembleRelease` and sign with your own keystore.

### `VITE_API_URL` is not optional here

This is the one thing that will silently break the app, and it is worth
understanding rather than copying.

Vite inlines `import.meta.env` **at build time**. Inside the WebView the app is
served from `https://localhost` — the `androidScheme` — so a base URL of
`http://localhost:5000` does not mean "the API on my laptop", it means "port
5000 on the phone", where nothing is listening. On a browser that same value is
correct, which is why the mistake survives every web test and only shows up as
a dead login screen on-device.

[`frontend/src/lib/api.js`](../frontend/src/lib/api.js) refuses to fail quietly:
on a native platform a missing or loopback `VITE_API_URL` is turned into a
visible configuration error naming the offending value, instead of a network
timeout to debug.

The API must also accept the WebView's origin. `backend/src/config/env.js`
appends `http://localhost`, `https://localhost` and `capacitor://localhost` to
the CORS allowlist unconditionally, so no per-deployment change is needed. A
rejected origin returns 403 with the origin in the message, not an opaque 500.

## Mobile adaptation

**Navigation is replaced, not resized.** A 240px sidebar does not belong on a
phone. Below `lg` the shell renders a bottom tab bar of the four routes that
matter for the signed-in role, plus **More**, which opens the full navigation as
a drawer. Role priorities are in
[`frontend/src/components/layout/navigation.js`](../frontend/src/components/layout/navigation.js).

**Safe areas** come from `env(safe-area-inset-*)`, captured once as
`--safe-top/right/bottom/left` and applied through `.safe-top` / `.safe-x`
utilities. Content padding accounts for the tab bar and the bottom inset
together, so nothing sits under the gesture bar.

**Touch targets** are at least 44px under `@media (pointer: coarse)`; tab items
are 56px.

**The keyboard** publishes its height as `--keyboard-height` and sets
`html.keyboard-open`, and the focused field is scrolled clear of it. The
mobile-number and OTP fields sit low on the sign-in sheet and were the ones
getting covered.

The height is read from `keyboardDidShow` as well as `keyboardWillShow`, and
falls back to the gap the visual viewport leaves. That is not belt-and-braces:
under `resize: body` Android reports a height of `0` in `keyboardWillShow`, so
reading only that event leaves `--keyboard-height` at `0px` and every offset
that depends on it inert. Measured on the emulator, the viewport goes 845 → 533
and the variable lands at 336px.

**Blur is expensive.** `backdrop-filter` at 16–24px is the costliest thing this
UI does, and on a mid-range Android WebView it is the difference between smooth
scrolling and visible jank. `native.js` reads device memory, core count and API
level and, on a weak signal, sets `html.perf-lite`, which drops every blur and
hides the ambient orbs. `setPerformanceLite(true)` forces it regardless of
detection.

The flat fills are keyed off the `backdrop-blur-*` utilities rather than the
`.glass` classes, because that is what the components actually use. This matters
more than it looks: most surfaces are a 6% white wash that only reads as a panel
*because* the blur lifts it off the backdrop. Remove the blur alone and the
panels all but vanish, so `perf-lite` has to substitute an opaque fill in the
same move.

The Pixel emulator reports 4 cores and 2 GB, so it takes this path by itself —
which means the fallback is exercised on every test run rather than only
existing in principle.

**Ambient motion stops off-screen.** The drifting glow animates forever, which
is battery spent on pixels nobody is looking at. Capacitor's `appStateChange`
toggles `html.app-paused`, which pauses the drift, pulse and lifecycle flow.

## Native capabilities

| | |
|---|---|
| Camera KYC capture | `captureDocument()` returns a `File`, so the existing multipart upload path is untouched |
| Biometric sign-in | Credentials are stored in the device keystore after one successful password sign-in; the prompt then unlocks them |
| Push notifications | Loan-status and EMI events — off until Firebase is configured, see below |
| Splash / status bar | Wine Reserve `#180B10`, light glyphs, splash hidden on first paint |

Permissions declared: `CAMERA`, `USE_BIOMETRIC`, `USE_FINGERPRINT`,
`POST_NOTIFICATIONS`. The camera is declared `required="false"` so the app still
installs on a device without one.

### Push is off until Firebase is configured

Enabling it takes two steps, and the second is not optional:

1. Put `google-services.json` (from your Firebase project) in
   `frontend/android/app/`.
2. Build with `VITE_PUSH_ENABLED=true`.

The flag exists because of how the failure behaves. `PushNotifications.register()`
calls `FirebaseMessaging.getInstance()`, which throws
`IllegalStateException: Default FirebaseApp is not initialized` when there is no
`google-services.json` — **on Capacitor's native plugin thread**. That is a fatal
Android exception, not a rejected promise: no JavaScript `try/catch` can contain
it, and the app dies seconds after sign-in. So the call is never made
speculatively. Without the flag `registerPush()` returns
`{ granted: false, reason: 'not-configured' }`, and push is the only feature
that degrades.

This was found by running the suite against a freshly restarted emulator, and it
is worth knowing that no amount of JS defensiveness would have caught it.

## Tests

```bash
npm run test:mobile      # 32 Appium tests on a running Android emulator
```

Appium 3 with the UiAutomator2 driver, driving the app through the
`WEBVIEW_com.sedin.sedbank` context and asserting on the same
[`shared/testIds.js`](../shared/testIds.js) catalogue the web suite uses.

Coverage: native networking from the WebView origin, password and OTP sign-in,
all five role dashboards, nine admin screens, the lifecycle stepper and KPI
cards, bottom-tab-vs-sidebar, 44px targets, safe-area application, the drawer,
the KYC camera control, the manifest permission, keyboard offset,
pause-on-background, and the `perf-lite` path — which is asserted to remove a
`backdrop-filter` that was measurably there first, so it cannot pass vacuously.

Prerequisites: an Appium server on `127.0.0.1:4723`, an emulator or device on
`adb devices`, `ANDROID_HOME` set, and the APK installed. The suite forces a
cold launch, clears any stored session and wakes the API itself, so runs are
repeatable without manual setup.

Three environment traps cost more time than any real bug, so the suite handles
or names each one:

- **Only one run at a time.** A second run's `forceAppLaunch` force-stops the
  first run's app, which surfaces mid-run as `session is either terminated or
  not started` — a failure that reads like an app crash and is not. The suite
  takes a PID lock and refuses to start rather than let that happen.
- **`hw.keyboard=yes`** AVDs route typing to the host and never raise the
  on-screen IME. The keyboard test sets `show_ime_with_hard_keyboard` and then
  force-stops the IME, because the IME only reads that setting when it
  restarts. It also taps through the native context: a chromedriver click
  focuses a WebView input without raising the keyboard, which looks exactly
  like a broken feature.
- **The emulator can lose DNS** after a host network change or sleep, and then
  every request fails as `Failed to fetch` with the app blameless. Confirm with
  `adb shell ping -c 2 sedbank-api.onrender.com`; if it says `unknown host`,
  restart the emulator with `-dns-server 8.8.8.8`.

`MOBILE_API_ORIGIN` overrides the API the tests talk to; it must match the
`VITE_API_URL` the installed APK was built with.

## Not verified here

- **Frame rate on real mid-range hardware.** The `perf-lite` path is exercised
  on every run — the emulator's reported specs trigger it, and the tests assert
  that the blur goes and the panels keep a solid fill. What is *not* measured is
  frames per second while scrolling on an actual mid-range phone, which is the
  number the fallback exists to protect.
- **Push delivery**, pending a Firebase project and `google-services.json`.
- **A biometric prompt**, which needs an enrolled fingerprint on the device.
  The keystore round-trip is written but unproven.
