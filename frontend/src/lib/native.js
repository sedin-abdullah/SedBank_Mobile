/**
 * Everything that only exists inside the Capacitor shell.
 *
 * Every export is safe to call from a browser: each one checks `IS_NATIVE`
 * first and degrades to the web behaviour, so no page needs to branch on
 * platform itself. Plugin imports are static (Capacitor's web
 * implementations are bundled and inert), but their *calls* are guarded.
 */
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { Keyboard } from '@capacitor/keyboard';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { PushNotifications } from '@capacitor/push-notifications';
import { NativeBiometric } from 'capacitor-native-biometric';

import { IS_NATIVE } from './api.js';
import { runBackHandler } from './backHandler.js';

export { IS_NATIVE };

/** Wine Reserve canvas — the status/navigation bars match the app ground. */
const CANVAS = '#180B10';

/* ------------------------------------------------------------------ *
 * Ambient animation, paused off-screen
 * ------------------------------------------------------------------ */

/**
 * The drifting glow blobs animate forever. On a phone that is battery spent
 * on pixels nobody is looking at, so the whole decorative layer is switched
 * off while the app is backgrounded. `html.app-paused` is the single hook —
 * see index.css.
 */
function setPaused(paused) {
  document.documentElement.classList.toggle('app-paused', paused);
}

/* ------------------------------------------------------------------ *
 * Device capability — blur is expensive on mid-range Android WebViews
 * ------------------------------------------------------------------ */

/**
 * `backdrop-filter` at 16-24px is the single most expensive thing this UI
 * does, and on a mid-range Android WebView it is the difference between 60fps
 * and visible jank while scrolling a table.
 *
 * Rather than guess per-device, decide from what the device reports and let
 * CSS do the rest: `html.perf-lite` drops every blur to a flat translucent
 * fill. The glass still reads as translucent, it just stops resampling the
 * backdrop on every frame.
 */
async function applyPerformanceProfile() {
  if (!IS_NATIVE) return { lite: false, reason: 'web' };

  try {
    const info = await Device.getInfo();

    const androidSdk = Number(info.androidSDKVersion ?? 0);
    const cores = navigator.hardwareConcurrency || 0;
    // Chrome-only and coarsely rounded; 0 when the browser withholds it.
    const memoryGb = navigator.deviceMemory || 0;

    const signals = [];
    if (memoryGb > 0 && memoryGb <= 4) signals.push(`memory=${memoryGb}GB`);
    if (cores > 0 && cores <= 4) signals.push(`cores=${cores}`);
    if (androidSdk > 0 && androidSdk < 29) signals.push(`sdk=${androidSdk}`);

    const lite = signals.length > 0;
    document.documentElement.classList.toggle('perf-lite', lite);
    return { lite, reason: lite ? signals.join(' ') : 'capable' };
  } catch {
    // Unknown device: keep the full effect rather than degrade needlessly.
    return { lite: false, reason: 'detection failed' };
  }
}

/** Lets the user force the cheaper rendering path regardless of detection. */
export function setPerformanceLite(lite) {
  document.documentElement.classList.toggle('perf-lite', !!lite);
  try {
    localStorage.setItem('sedbank.perfLite', lite ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

/**
 * Publishes the keyboard height as a CSS variable so a focused field can be
 * scrolled clear of it. The mobile-number and OTP inputs sit low on the
 * sign-in screen and were the ones getting covered.
 */
function publishKeyboardHeight(px) {
  const value = Math.max(0, Math.round(px || 0));
  document.documentElement.style.setProperty('--keyboard-height', `${value}px`);
}

/** The viewport and body heights with no keyboard up, to measure against. */
let restingViewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
let restingBodyHeight =
  typeof document !== 'undefined' && document.body ? document.body.clientHeight : 0;

/**
 * `keyboardWillShow` reports a height of 0 on Android under `resize: body` —
 * the plugin resizes rather than handing us a number. So take the height from
 * whichever source actually knows it: the event when it is populated, then the
 * gap the visual viewport leaves, then the drop in the window's own height.
 */
function keyboardHeightFrom(info) {
  if (info?.keyboardHeight > 0) return info.keyboardHeight;

  // The keyboard overlaying the page, without the window resizing.
  const viewport = window.visualViewport;
  if (viewport && window.innerHeight - viewport.height > 0) {
    return window.innerHeight - viewport.height;
  }

  // The window resized instead, which is what adjustResize does: the height
  // is then the drop from the tallest viewport seen with no keyboard up.
  const fromWindow = restingViewportHeight - window.innerHeight;
  if (fromWindow > 0) return fromWindow;

  // Last: the plugin's `resize: body` mode leaves window.innerHeight alone and
  // shrinks the body instead, so nothing above notices.
  const body = document.body;
  return Math.max(0, restingBodyHeight - (body ? body.clientHeight : 0));
}

function wireKeyboard() {
  if (!IS_NATIVE) return;

  // Track the no-keyboard height, so a resize can be measured against it.
  window.addEventListener('resize', () => {
    if (!document.documentElement.classList.contains('keyboard-open')) {
      restingViewportHeight = Math.max(restingViewportHeight, window.innerHeight);
      restingBodyHeight = Math.max(restingBodyHeight, document.body?.clientHeight || 0);
    }
  });

  /*
   * The plugin's show events fire before the WebView's viewport metrics have
   * caught up, so a height measured at that instant is still the resting one.
   * Recompute on every resize while the keyboard is up and the value
   * converges on the truth instead of latching zero.
   */
  const republish = () => {
    if (!document.documentElement.classList.contains('keyboard-open')) return;
    publishKeyboardHeight(keyboardHeightFrom(null));
  };
  window.addEventListener('resize', republish);
  window.visualViewport?.addEventListener('resize', republish);

  const onShow = (info) => {
    publishKeyboardHeight(keyboardHeightFrom(info));
    document.documentElement.classList.add('keyboard-open');

    // Bring whatever is focused into view above the keyboard.
    const active = document.activeElement;
    if (active && typeof active.scrollIntoView === 'function') {
      setTimeout(() => active.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
    }
  };

  Keyboard.addListener('keyboardWillShow', onShow);
  // The final geometry is only settled by the time the keyboard is up.
  Keyboard.addListener('keyboardDidShow', onShow);

  const onHide = () => {
    publishKeyboardHeight(0);
    document.documentElement.classList.remove('keyboard-open');
  };

  Keyboard.addListener('keyboardWillHide', onHide);
  Keyboard.addListener('keyboardDidHide', onHide);
}

/* ------------------------------------------------------------------ *
 * Hardware back
 * ------------------------------------------------------------------ */

/**
 * Android's back gesture, wired to the app rather than to the process.
 *
 * Capacitor's default is to exit the app on back, from anywhere — so a
 * borrower three screens into an application, or with the nav drawer open,
 * would lose the app instead of going back one step. Overlays get first
 * refusal (see backHandler.js), then history, and only at the root does back
 * actually leave.
 */
function wireBackButton() {
  if (!IS_NATIVE) return;

  App.addListener('backButton', ({ canGoBack }) => {
    if (runBackHandler()) return;

    if (canGoBack && window.history.length > 1) {
      window.history.back();
      return;
    }

    App.exitApp();
  });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

let initialised = false;

/** Called once, as early as possible. Safe to call in a browser. */
export async function initNative() {
  if (initialised) return;
  initialised = true;

  // Honour a stored preference before detection runs, to avoid a flash.
  try {
    if (localStorage.getItem('sedbank.perfLite') === 'true') {
      document.documentElement.classList.add('perf-lite');
    }
  } catch {
    /* ignore */
  }

  if (!IS_NATIVE) return;

  document.documentElement.classList.add('is-native');

  try {
    await StatusBar.setStyle({ style: Style.Dark }); // light glyphs on our dark ground
    await StatusBar.setBackgroundColor({ color: CANVAS });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    /* not fatal — the bar simply keeps its default colour */
  }

  wireKeyboard();
  wireBackButton();
  await applyPerformanceProfile();

  App.addListener('appStateChange', ({ isActive }) => setPaused(!isActive));
  App.addListener('pause', () => setPaused(true));
  App.addListener('resume', () => setPaused(false));

  try {
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Camera — KYC capture
 * ------------------------------------------------------------------ */

/**
 * Captures a document with the camera and returns it as a File, so the
 * existing multipart upload path is unchanged.
 *
 * Returns null when the user cancels. Throws only on a real failure, which
 * the caller surfaces as a toast.
 */
export async function captureDocument({ source = 'prompt' } = {}) {
  if (!IS_NATIVE) return null;

  const photo = await Camera.getPhoto({
    quality: 80,
    allowEditing: false,
    resultType: CameraResultType.Base64,
    source:
      source === 'camera'
        ? CameraSource.Camera
        : source === 'gallery'
          ? CameraSource.Photos
          : CameraSource.Prompt,
    correctOrientation: true,
    // Keep well under the 5 MB upload cap.
    width: 1600,
  });

  if (!photo?.base64String) return null;

  const mime = `image/${photo.format === 'png' ? 'png' : 'jpeg'}`;
  const binary = atob(photo.base64String);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return new File([bytes], `kyc-${stamp}.${photo.format === 'png' ? 'png' : 'jpg'}`, {
    type: mime,
  });
}

/* ------------------------------------------------------------------ *
 * Biometrics
 * ------------------------------------------------------------------ */

const BIOMETRIC_SERVER = 'sedbank.credentials';

/** What kind of biometric the device offers, or null when there is none. */
export async function biometricAvailability() {
  if (!IS_NATIVE) return null;
  try {
    const result = await NativeBiometric.isAvailable();
    return result?.isAvailable ? result : null;
  } catch {
    return null;
  }
}

/** True once the user has opted in and credentials are stored. */
export async function hasBiometricCredentials() {
  if (!IS_NATIVE) return false;
  try {
    const stored = await NativeBiometric.getCredentials({ server: BIOMETRIC_SERVER });
    return !!stored?.username;
  } catch {
    return false;
  }
}

/**
 * Stores the credentials behind the device keystore, after the user has
 * already signed in successfully once.
 */
export async function enrolBiometric({ email, password }) {
  if (!IS_NATIVE) return false;
  await NativeBiometric.setCredentials({ username: email, password, server: BIOMETRIC_SERVER });
  return true;
}

export async function clearBiometric() {
  if (!IS_NATIVE) return;
  try {
    await NativeBiometric.deleteCredentials({ server: BIOMETRIC_SERVER });
  } catch {
    /* nothing stored */
  }
}

/**
 * Prompts for fingerprint/face and, on success, returns the stored
 * credentials for the caller to sign in with. Returns null when the user
 * cancels or fails verification — never throws for that case, because a
 * cancelled prompt is not an error.
 */
export async function biometricSignIn() {
  if (!IS_NATIVE) return null;
  try {
    await NativeBiometric.verifyIdentity({
      reason: 'Sign in to SedBank',
      title: 'SedBank',
      subtitle: 'Verify to continue',
      description: '',
    });
  } catch {
    return null; // cancelled or not recognised
  }

  try {
    const stored = await NativeBiometric.getCredentials({ server: BIOMETRIC_SERVER });
    if (!stored?.username || !stored?.password) return null;
    return { email: stored.username, password: stored.password };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Push notifications
 * ------------------------------------------------------------------ */

/**
 * Push is opt-in at build time, and this is not a style preference.
 *
 * `PushNotifications.register()` reaches `FirebaseMessaging.getInstance()`,
 * which throws `IllegalStateException: Default FirebaseApp is not initialized`
 * when there is no `google-services.json`. That throw happens on Capacitor's
 * native plugin thread, so it is a **fatal Android exception, not a rejected
 * promise** — no try/catch here can contain it, and the process dies moments
 * after sign-in. So the call must never be made speculatively: it is gated on
 * a flag the developer sets only once Firebase is actually configured.
 */
const PUSH_ENABLED = String(import.meta.env.VITE_PUSH_ENABLED || '').toLowerCase() === 'true';

/**
 * Registers for loan-status and EMI-reminder pushes.
 *
 * Needs a Firebase project, `google-services.json` in `frontend/android/app/`
 * and `VITE_PUSH_ENABLED=true` at build time. Without those this resolves to
 * `{ granted: false, reason: 'not-configured' }` and the app is fully usable —
 * push is the only feature that degrades.
 */
export async function registerPush({ onNotification } = {}) {
  if (!IS_NATIVE) return { granted: false, reason: 'web' };
  if (!PUSH_ENABLED) return { granted: false, reason: 'not-configured' };

  try {
    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') return { granted: false, reason: 'denied' };

    if (onNotification) {
      PushNotifications.addListener('pushNotificationReceived', onNotification);
      PushNotifications.addListener('pushNotificationActionPerformed', (action) =>
        onNotification(action.notification)
      );
    }

    await PushNotifications.register();
    return { granted: true };
  } catch (error) {
    // Anything reaching here is a JS-side failure; the Firebase case is
    // prevented above because it cannot be caught at all.
    return { granted: false, reason: 'registration-failed', error: error?.message };
  }
}

/** Resolves the FCM token once registration succeeds, or null. */
export function onPushToken(handler) {
  if (!IS_NATIVE || !PUSH_ENABLED) return () => {};
  const registration = PushNotifications.addListener('registration', (token) =>
    handler(token.value)
  );
  return () => registration.then?.((r) => r.remove?.());
}

export default {
  IS_NATIVE,
  initNative,
  setPerformanceLite,
  captureDocument,
  biometricAvailability,
  hasBiometricCredentials,
  enrolBiometric,
  clearBiometric,
  biometricSignIn,
  registerPush,
  onPushToken,
};
