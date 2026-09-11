# Android app

The Android app is the existing React SPA running inside a Capacitor 6 WebView.
There is no second codebase and no parallel component tree: every screen, route,
role and permission is the same build that ships to the web, so feature parity
holds by construction rather than by discipline.

## Download it

[**SedBank-v1.0.0-debug.apk**](https://github.com/SedDemo/Sed_Bank/releases/download/v1.0.0-android/SedBank-v1.0.0-debug.apk)
— open it on the phone and allow the install when Android asks. Sign in with any
account from [CREDENTIALS.md](CREDENTIALS.md).

It is a debug build, which is right for sideloading a demo and wrong for a store
release; see [Build and run](#build-and-run) for a signed one. The app talks to
the deployed API, which sleeps on Render's free tier, so the first sign-in after
an idle spell can take ~30s.

> **Not Expo.** Expo/EAS builds React Native projects. This app is the web SPA
> in a Capacitor WebView with its own Gradle project, so there is nothing for
> Expo to build — putting it there would mean rewriting the frontend in React
> Native. GitHub Releases is the equivalent for handing someone an APK, which is
> what the link above is.

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

The height is read from `keyboardDidShow` as well as `keyboardWillShow`, then
from the gap the visual viewport leaves, then from the drop in the window's own
height. That is not belt-and-braces: under `resize: body` Android reports a
height of `0` in `keyboardWillShow`, so reading only that event leaves
`--keyboard-height` at `0px` and every offset depending on it inert. Measured on
the emulator, the viewport goes 845 → 533 and the variable lands at 336px. The
activity also declares `windowSoftInputMode="adjustResize"`, since leaving it
unset makes the resize Android's heuristic rather than a guarantee.

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

**Back goes back.** Capacitor's default is to *exit the app* on the back
gesture, from anywhere — with the drawer open, or three screens into an
application. `frontend/src/lib/backHandler.js` holds a small stack of handlers:
overlays (the drawer, any `Modal`) register while open and get first refusal,
then history, and only at the root does back actually leave. Sub-pages also show
a back chevron in the mobile top bar, because a phone has no sidebar to orient
from and the gesture is not discoverable.

**Wide tables scroll inside their card.** `.table-scroll` sets `overflow-x:auto`
with no negative margin. It previously used `-mx-5` to bleed past a
`.card-body`'s padding — but every table sits directly in a `.card`, which has
none, so on a phone the table sat 20px outside its card and the card's
`overflow-hidden` sliced the first column mid-character. Loan numbers read as
`3B-LN-00011`.

## Native widgets take their colours from the Android theme, not from CSS

A `<select>` popup, and every permission or biometric prompt, is an **OS
widget**. The page's CSS — including the `select option { }` rule that works in a
desktop browser — is ignored. They read
`frontend/android/app/src/main/res/values/styles.xml`, which is why two mistakes
there made the status filter unusable while every web test stayed green:

- The theme was `Theme.AppCompat.DayNight.*`. The app is dark in every scheme,
  so on a device in light mode the dropdown resolved its row text to near-black
  and drew it on our dark ground. It is now fixed dark.
- The launch theme set `android:background` to the splash drawable. That
  attribute is the default background for every **view** inheriting the theme,
  not the window's — so the dropdown's list rows each drew the full splash
  artwork and stood about a thousand pixels tall. The window attribute is
  `android:windowBackground`.

`AppTheme.NoActionBar` now points `alertDialogTheme` at `SedBankDialog`, which
sets the raised wine surface, light text and the rose accent, so native dialogs
match the app. If you add a native surface, colour it there — and check it on a
device with the system in **light** mode, since that is the case that fails.

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
npm run test:mobile      # 38 Appium tests on a running Android emulator
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

Prerequisites: an Appium server on `127.0.0.1:4723` started with
`--relaxed-security` (two tests use `mobile: shell` to set the IME and read
`dumpsys`; without the flag they fail with *"Potentially insecure feature
'adb_shell' has not been enabled"* — note that Appium Inspector starts its own
server without it), an emulator or device on
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
  on-screen IME. The keyboard test sets `show_ime_with_hard_keyboard`, restarts
  the IME (it only reads that setting on restart) and taps through the native
  context, because a chromedriver click focuses a WebView input *without*
  raising the keyboard — which looks exactly like a broken feature. It then
  checks `dumpsys input_method` and **skips with a stated reason** if the IME
  still did not appear, rather than reporting an emulator limitation as an app
  fault. It fails, loudly, if the keyboard does appear and the offset is wrong.
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
- **The keyboard offset, on this emulator.** The behaviour was measured working
  by hand (845 → 533, `--keyboard-height: 336px`), but the AVD stopped raising
  the soft IME for WebView inputs, so the test skips rather than asserts. It
  needs a device, or an AVD built with `hw.keyboard=no`.
- **Push delivery**, pending a Firebase project and `google-services.json`.
- **A biometric prompt**, which needs an enrolled fingerprint on the device.
  The keystore round-trip is written but unproven.
