# Build & distribute — APK, AAB, iOS

Binaries are produced either **in CI** (GitHub Actions, no local Android SDK
needed) or by a **local Android toolchain**. The repo is configured for both.

| | |
|---|---|
| Download the current APK | [Releases](https://github.com/sedin-abdullah/SedBank_Mobile/releases/latest) |
| Build one without installing anything | Actions → **Android APK** → *Run workflow* |
| Build one locally | [Android APK](#android-apk-installable-shareable) below |

---

## Why this is not an Expo build

Sed_Ecomm_Mobile is a React Native project, so Expo/EAS builds it. SedBank is
different by design: the Android app **is** the web SPA, running in a Capacitor
WebView, with its own Gradle project. There is nothing in it for Expo to build —
`eas build` has no React Native bundle to compile, and moving to it would mean
rewriting the frontend in React Native rather than reusing the one that already
ships to the web.

What Expo actually gives that project is worth naming, because it is what the
setup below replaces:

| EAS provides | Here instead |
|---|---|
| Cloud builds, no local SDK | `.github/workflows/android.yml` — Actions → Run workflow |
| A download URL per build | The run's uploaded artefact, plus a GitHub Release on a tag |
| A managed signing keystore | Your own keystore, held as repo secrets ([Signing](#signing)) |
| `eas build:list` | The Actions run history |
| OTA JS updates (`eas update`) | Not available; see [OTA updates](#ota-updates) |

The trade is deliberate: one codebase and one design system for web and phone,
against giving up Expo's managed conveniences.

---

## Prerequisites

**For CI builds: none.** Push access is enough.

**For local builds:**

1. Node 20+ and the repo installed:
   ```bash
   npm run install:all
   ```
2. **JDK 17.** AGP 8.2 targets it. `java -version` should say 17 or newer.
3. **Android SDK** with platform 34 and build-tools. Android Studio installs
   both; otherwise set `ANDROID_HOME` to an existing SDK.
4. Nothing to configure for the API — the build defaults to the deployed one.
   To point elsewhere, pass `VITE_API_URL` (see below).

---

## Android APK (installable, shareable)  ← the usual one

```bash
cd frontend
VITE_API_URL=https://sedbank-api.onrender.com npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

The APK lands at `frontend/android/app/build/outputs/apk/debug/app-debug.apk`
(~9 MB). Share it by any means — WhatsApp, Drive, email. To install: open the
file on Android, allow installs from that app when asked, install.

`adb install -r <path>` puts it straight onto a connected device or emulator.

For a **signed release** APK — smaller, not debuggable, and what you would
actually distribute — set up [signing](#signing) and run `./gradlew
assembleRelease`. Output: `app/build/outputs/apk/release/app-release.apk`
(~6.4 MB).

### `VITE_API_URL` decides whether the APK works at all

Vite inlines it **at build time**, so it is baked into the APK. Inside the
WebView the app is served from `https://localhost`, which means a value of
`http://localhost:5000` points at **port 5000 on the phone**, where nothing is
listening. The same value is correct in a browser, which is why this survives
every web test and shows up only as a dead sign-in screen on-device.

Both the app and CI refuse to fail quietly here: `frontend/src/lib/api.js` turns
a missing or loopback value into a visible configuration error naming it, and
the workflow fails the build outright.

For a phone on your wi-fi to reach a local API, use your machine's LAN address
(`ipconfig getifaddr en0`) and add it to `CORS_ORIGINS`. A **shareable** APK must
point at a publicly deployed API — see [TECH_STACK.md](TECH_STACK.md#deployment).

---

## Android AAB (for Google Play)

```bash
cd frontend/android && ./gradlew bundleRelease
```

Output: `app/build/outputs/bundle/release/app-release.aab` — the format Play
requires. It needs [signing](#signing) configured; Play rejects an unsigned
bundle. `versionCode` is not auto-incremented, so bump it before each upload
(see [Version management](#version-management)).

---

## iOS build

The iOS project is **not scaffolded yet**. Capacitor generates it in one
command, on a Mac with Xcode:

```bash
cd frontend
npx cap add ios
npx cap sync ios
npx cap open ios      # then Product -> Archive in Xcode
```

Everything in `src/` works unchanged — it is the same web app. What needs
attention is the platform-specific layer, none of which is currently exercised
on iOS: `frontend/src/lib/native.js` guards each plugin call behind
`IS_NATIVE`, and the plugins used (Camera, Keyboard, StatusBar, SplashScreen,
PushNotifications, biometrics) all have iOS implementations, but safe-area and
keyboard behaviour differ enough to need a pass on a real device.

Installing on a device or shipping to the App Store needs a **paid Apple
Developer account** ($99/yr). A simulator build needs only Xcode.

---

## App icon & splash

Source artwork lives in `frontend/resources/`, and the density variants are
generated from it:

| File | Size | Purpose |
|---|---|---|
| `icon.png` | 1024×1024 | App icon, all densities |
| `icon-foreground.png` | 1024×1024 | Android adaptive foreground (art inside the safe circle) |
| `icon-background.png` | 1024×1024 | Android adaptive background |
| `splash.png` | 2732×2732 | Launch screen, portrait and landscape |
| `splash-dark.png` | 2732×2732 | Dark-mode launch screen |

Replace a file and regenerate — no code change, the paths are already wired:

```bash
cd frontend && npm run assets
npx cap sync android
```

That rewrites every `mipmap-*` and `drawable-*` variant under
`android/app/src/main/res/`. Those generated files are committed, so a plain
`./gradlew assembleDebug` needs no asset step.

The splash background colour is set separately, in `capacitor.config.json` →
`plugins.SplashScreen.backgroundColor` (`#180B10`, the Wine Reserve canvas).

---

## Version management

Both live in `frontend/android/app/build.gradle`:

- `versionName` — user-facing, e.g. `1.0.1`. Keep it equal to the release tag.
- `versionCode` — an integer Play requires to increase on every upload.

```gradle
versionCode 2
versionName "1.0.1"
```

A tagged CI run names the artefact from the tag (`v1.0.1-android` →
`SedBank-v1.0.1.apk`), so a tag that disagrees with `versionName` produces a
confusingly-named build. Bump the gradle file in the same commit you tag.

---

## Cutting a release

```bash
# 1. bump versionCode/versionName in frontend/android/app/build.gradle, commit
# 2. tag and push
git tag v1.0.1-android
git push origin v1.0.1-android
```

CI builds the APK, creates the GitHub Release and attaches it. Anyone can then
download it from the Releases page — the equivalent of passing round an EAS
build URL, except the link is permanent.

To build without releasing, run the workflow by hand from the Actions tab; the
APK is attached to the run as an artefact. The workflow takes an `api_url`
input if you need a build pointed at something other than the deployed API.

---

## Signing

The keystore **is** the app's identity. Two consequences worth internalising
before generating one:

- **Lose it** and no future build can be installed over an existing install —
  users must uninstall first, losing app data. Play uploads are rejected outright.
- **Leak it** and anyone can sign an APK that Android accepts as SedBank.

Back it up somewhere durable and private. `.gitignore` blocks `*.keystore`,
`*.jks` and `keystore.properties`, so none of it can be committed by accident.

### Generate one

```bash
keytool -genkeypair -v \
  -keystore frontend/android/release.keystore \
  -alias sedbank -keyalg RSA -keysize 2048 -validity 10000
```

### Build locally with it

`frontend/android/keystore.properties` (never committed):

```properties
storeFile=release.keystore
storePassword=<store password>
keyAlias=sedbank
keyPassword=<key password>
```

`app/build.gradle` picks this up if present and signs `release` builds with it;
if absent, release builds are left unsigned and only the debug APK is
installable. So the file is what switches signing on.

### Give it to CI

Four repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i frontend/android/release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | store password |
| `ANDROID_KEY_ALIAS` | `sedbank` |
| `ANDROID_KEY_PASSWORD` | key password |

With them present the workflow builds and signs a release APK; without them it
builds the debug APK, so the pipeline works either way. The keystore it writes
is deleted in an `always()` step, so a failed build does not leave it on the
runner.

---

## Tips

- **Run history** is the build list: Actions → Android APK. Each run keeps its
  APK as an artefact for 90 days; Releases keep theirs indefinitely.
- **`npx cap sync android`** after any web build or dependency change — it copies
  `dist/` into the Android project and refreshes plugin wiring. Forgetting it
  ships the previous bundle inside a new APK, which is a confusing bug to chase.
- **`npx cap doctor`** checks the native project against the installed plugins.
- **`./gradlew clean`** when a build behaves impossibly; stale Capacitor assets
  are the usual cause.
- **`npm run test:mobile`** runs the 32 Appium tests against an emulator with the
  APK installed. See [MOBILE.md](MOBILE.md#tests).

### OTA updates

Expo's `eas update` ships JS without a rebuild. There is no equivalent here by
default. Because the payload is a web bundle, the options are real but each is a
decision: `@capgo/capacitor-updater` for hosted live updates, Capacitor's own
paid Live Updates service, or pointing the WebView at the deployed SPA instead
of bundled assets — which trades offline capability for instant updates.

---

## Store readiness

The app id is already set for both platforms: **`com.sedin.sedbank`**
(`capacitor.config.json` and `build.gradle`). Publishing needs assets and
accounts, not refactoring.

**Google Play**

1. `./gradlew bundleRelease` with signing configured.
2. Play Console → new app → upload the `.aab`.
3. Store listing: icon 512×512, feature graphic 1024×500, at least two
   screenshots per form factor, privacy policy URL.
4. Complete the Data safety form. Be accurate about the camera permission
   (KYC document capture) and that documents are uploaded to the API.

**App Store**

1. Scaffold iOS as above, archive in Xcode.
2. Paid Apple Developer account; App Store Connect record; TestFlight for
   review-free internal distribution.

**Before either**, two demo-only flags must go — both are documented in the
[README](../README.md#deployment) and neither belongs in a public app:
`EXPOSE_OTP=true` returns the mocked OTP to any caller, and the seeded accounts
use published passwords.
