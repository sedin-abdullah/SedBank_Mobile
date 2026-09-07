/**
 * Appium / UiAutomator2 suite for the SedBank Android build.
 *
 * The app is a Capacitor WebView, so every assertion runs in the WEBVIEW
 * context against the same `data-testid` catalogue the web Playwright suite
 * uses (shared/testIds.js). That is deliberate: driving it through native
 * accessibility selectors would test Android's WebView bridge rather than the
 * app, and would drift from the web tests.
 *
 * Usage:
 *   appium --address 127.0.0.1 --port 4723 &
 *   node mobile-e2e/run.mjs
 *
 * Requires an emulator or device already attached (`adb devices`).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { remote } from 'webdriverio';
import { TESTIDS, navId, tabId, rowId } from '../shared/testIds.js';

const APP_ID = 'com.sedin.sedbank';
/** The API the installed APK was built against (VITE_API_URL). */
const API_ORIGIN = process.env.MOBILE_API_ORIGIN || 'https://sedbank-api.onrender.com';
const DEMO = {
  admin: { email: 'admin@sedbank.test', password: 'Admin@12345' },
  credit: { email: 'credit@sedbank.test', password: 'Staff@12345' },
  ops: { email: 'ops@sedbank.test', password: 'Staff@12345' },
  collections: { email: 'collections@sedbank.test', password: 'Staff@12345' },
  customer: { email: 'customer@sedbank.test', password: 'Customer@12345' },
};

const results = [];
let driver;
let reconnects = 0;

/* ------------------------------- lock ------------------------------ */

/*
 * Two runs cannot share a device. The second session's forceAppLaunch
 * force-stops the first one's app, which surfaces as "session is either
 * terminated or not started" halfway through an otherwise passing run — a
 * failure that looks like an app bug and is not. Refuse to start instead.
 */
const LOCK = join(tmpdir(), 'sedbank-mobile-e2e', 'run.lock');

function acquireLock() {
  mkdirSync(join(tmpdir(), 'sedbank-mobile-e2e'), { recursive: true });

  if (existsSync(LOCK)) {
    const owner = Number(readFileSync(LOCK, 'utf8').trim());
    let alive = false;
    try {
      process.kill(owner, 0); // signal 0 only tests for existence
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) {
      console.error(
        `\nAnother run (pid ${owner}) already holds the device.\n` +
          'Wait for it to finish, or stop it first — concurrent runs corrupt each other.\n'
      );
      process.exit(2);
    }
    rmSync(LOCK, { force: true }); // stale
  }

  writeFileSync(LOCK, String(process.pid));
  const release = () => rmSync(LOCK, { force: true });
  process.on('exit', release);
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
}

acquireLock();

/* ----------------------------- harness ----------------------------- */

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, error) {
  results.push({ name, ok: false, detail: error?.message || String(error) });
  console.log(`  ✘ ${name}\n      ${error?.message || error}`);
}
async function test(name, fn) {
  try {
    await ensureSession();
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

/**
 * The deployed API sleeps on Render's free tier and takes ~30s to wake — long
 * enough that the first fetch from inside the WebView fails outright. Wake it
 * from here first, where a slow request costs nothing but time.
 */
async function warmApi() {
  const started = Date.now();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/health`, {
        signal: AbortSignal.timeout(60000),
      });
      if (response.ok) {
        const waited = Math.round((Date.now() - started) / 1000);
        console.log(`api: ${API_ORIGIN} awake${waited > 3 ? ` after ${waited}s` : ''}\n`);
        return;
      }
    } catch {
      /* still waking */
    }
  }
  throw new Error(`${API_ORIGIN} did not become reachable — is the API deployed?`);
}

/**
 * Starts an Appium session against a cold app launch.
 *
 * `noReset` keeps the install, but the launch must be forced: a previous run
 * that backgrounded the app leaves a live process with no WebView attached,
 * and a session would otherwise bind to that.
 */
async function openSession() {
  const session = await remote({
    hostname: '127.0.0.1',
    port: 4723,
    logLevel: 'error',
    // Talking to a production API from inside the WebView means Render cold
    // starts; the default 120s is not enough headroom for that.
    connectionRetryTimeout: 300000,
    capabilities: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': APP_ID,
      'appium:appActivity': '.MainActivity',
      'appium:noReset': true,
      'appium:forceAppLaunch': true,
      'appium:shouldTerminateApp': true,
      'appium:newCommandTimeout': 600,
      // Capacitor ships a plain WebView; let Appium fetch a matching driver.
      'appium:chromedriverAutodownload': true,
    },
  });
  return session;
}

/**
 * A run this long occasionally loses its session — the WebView is restarted
 * under it, or chromedriver drops. Rather than fail every remaining test with
 * "session is either terminated or not started", rebuild it and carry on. The
 * recovery is reported, so a flaky session never looks like a clean run.
 */
async function ensureSession() {
  try {
    await driver.getContexts();
    return false;
  } catch {
    console.log('    … session lost, reconnecting');
    await driver?.deleteSession().catch(() => {});
    await warmApi();
driver = await openSession();
    await useWebview();
    reconnects += 1;
    return true;
  }
}

/** Switches into the app's WebView, retrying while Chromium warms up. */
async function useWebview() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const contexts = await driver.getContexts();
    const web = contexts.find((c) => String(c).startsWith('WEBVIEW'));
    if (web) {
      await driver.switchContext(String(web));
      // Only chromedriver implements this — executeAsync scripts here wait on
      // a production API, well past the 30s W3C default.
      await driver.setTimeout({ script: 180000 }).catch(() => {});
      return String(web);
    }
    // Halfway through, nudge the app to the foreground: coming back from the
    // background it may need reactivating before the WebView re-registers.
    if (attempt === 10) {
      await driver.execute('mobile: activateApp', { appId: APP_ID }).catch(() => {});
    }
    await driver.pause(1000);
  }
  throw new Error('No WEBVIEW context appeared — is the WebView loading?');
}

const byId = (id) => `[data-testid="${id}"]`;

/** adb shell, through Appium (the server runs with --relaxed-security). */
async function shell(command, args = []) {
  return driver.execute('mobile: shell', { command, args });
}

/**
 * Taps an element through the native context.
 *
 * A chromedriver click focuses a WebView input but does not raise Android's
 * IME, so anything testing keyboard behaviour has to tap for real. The
 * element's position is taken as a fraction of the viewport and mapped onto
 * the WebView's native bounds.
 */
async function nativeTap(id) {
  const frac = await driver.execute(`
    const r = document.querySelector('[data-testid="${id}"]').getBoundingClientRect();
    return {
      fx: (r.left + r.width / 2) / window.innerWidth,
      fy: (r.top + r.height / 2) / window.innerHeight,
    };
  `);

  await driver.switchContext('NATIVE_APP');
  try {
    const webview = await driver.$('android=new UiSelector().className("android.webkit.WebView")');
    const at = await webview.getLocation();
    const size = await webview.getSize();
    await driver.execute('mobile: clickGesture', {
      x: Math.round(at.x + frac.fx * size.width),
      y: Math.round(at.y + frac.fy * size.height),
    });
  } finally {
    await useWebview(); // always come back, even if the tap failed
  }
}

/** Best-effort: leaves the keyboard down so the next test starts clean. */
async function hideKeyboard() {
  await driver.switchContext('NATIVE_APP').catch(() => {});
  await driver.execute('mobile: hideKeyboard').catch(() => {});
  await useWebview().catch(() => {});
}

async function waitFor(id, timeout = 25000) {
  const el = await driver.$(byId(id));
  await el.waitForDisplayed({ timeout, timeoutMsg: `${id} never appeared` });
  return el;
}

async function setValue(id, value) {
  const el = await waitFor(id);
  await el.click();
  await el.setValue(value);
}

/** Signs in through the password form and waits for the shell. */
async function signIn({ email, password }) {
  await driver.execute('window.localStorage.clear(); window.location.hash = "";');
  await driver.url('https://localhost/login');
  await waitFor(TESTIDS.login.emailInput);
  await setValue(TESTIDS.login.emailInput, email);
  await setValue(TESTIDS.login.passwordInput, password);
  await (await waitFor(TESTIDS.login.submit)).click();
  await waitFor(TESTIDS.shell.root, 40000);
}

async function signOut() {
  await driver.execute('window.localStorage.clear();');
  await driver.url('https://localhost/login');
  await waitFor(TESTIDS.login.root);
}

/* ------------------------------- run ------------------------------- */

console.log('\nSedBank Android — Appium / UiAutomator2\n');

await warmApi();
driver = await openSession();

try {
  const context = await useWebview();
  console.log(`context: ${context}\n`);

  /* --- the pitfall: does the WebView actually reach the API? --- */
  console.log('Native networking');
  // noReset keeps the previous run's session, so clear it before anything
  // asserts on the sign-in screen. The WebView may also still be booting.
  await driver.url('https://localhost/');
  await driver.pause(1500);
  await driver.execute('window.localStorage.clear();');
  await driver.url('https://localhost/login');
  await waitFor(TESTIDS.login.root, 60000);

  await test('a GET from the WebView origin is not blocked by CORS', async () => {
    const status = await driver.executeAsync(function (API, done) {
      fetch(API + '/api/health')
        .then((r) => done(r.status))
        .catch((e) => done('network-error: ' + e.message));
    }, `${API_ORIGIN}`);
    if (status !== 200) throw new Error(`health check from the WebView returned ${status}`);
  });

  await test('no CORS failure on a real POST from the WebView', async () => {
    const status = await driver.executeAsync(function (API, done) {
      fetch(API + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@sedbank.test', password: 'Admin@12345' }),
      })
        .then((r) => done(r.status))
        .catch((e) => done('network-error: ' + e.message));
    }, `${API_ORIGIN}`);
    if (status !== 200) throw new Error(`login POST returned ${status}`);
  });

  /* --- login flows --- */
  console.log('\nLogin');
  await test('password sign-in reaches the portal', async () => {
    await signIn(DEMO.admin);
  });

  await test('mobile OTP flow completes', async () => {
    await signOut();
    await (await waitFor(TESTIDS.login.tabOtp)).click();
    await setValue(TESTIDS.login.mobileInput, '9000000005'); // the demo customer
    await (await waitFor(TESTIDS.login.requestOtp)).click();

    const hint = await waitFor(TESTIDS.login.otpHint, 30000);
    const code = await hint.getAttribute('data-otp');
    if (!/^\d{6}$/.test(code || '')) throw new Error(`no OTP in the demo hint (got ${code})`);
    await setValue(TESTIDS.login.otpInput, code);
    await (await waitFor(TESTIDS.login.verifyOtp)).click();
    await waitFor(TESTIDS.shell.root, 40000);
  });

  await test('the app survives sign-in — no native plugin crash', async () => {
    /*
     * A native exception on Capacitor's plugin thread kills the process, and
     * no JS try/catch can contain it — PushNotifications.register() without a
     * google-services.json did exactly that, seconds after login. Every other
     * assertion here runs in the WebView and would report the aftermath as
     * "web view not found", so check the process itself.
     */
    await signOut();
    await signIn(DEMO.customer);
    await driver.pause(6000); // past the post-login native calls

    const state = await driver.queryAppState(APP_ID);
    if (state !== 4) {
      // 4 = running in foreground; anything less means it went away.
      throw new Error(`app is no longer in the foreground after sign-in (state ${state})`);
    }
    await waitFor(TESTIDS.shell.root, 20000); // and the WebView is still live
  });

  await test('a demo role button fills the form without signing in', async () => {
    await signOut();
    await (await waitFor(TESTIDS.login.demoAdmin)).click();
    await driver.pause(600);
    const email = await (await waitFor(TESTIDS.login.emailInput)).getValue();
    if (email !== 'admin@sedbank.test') throw new Error(`form not filled (got "${email}")`);
    const shell = await driver.$$(byId(TESTIDS.shell.root));
    if (shell.length > 0) throw new Error('it signed in — it should only fill the form');
  });

  /* --- every role reaches its own dashboard --- */
  console.log('\nRole dashboards');
  for (const [role, creds] of Object.entries(DEMO)) {
    await test(`${role} signs in and lands on its dashboard`, async () => {
      await signOut();
      await signIn(creds);
      const expected =
        role === 'customer' ? TESTIDS.customerDashboard.root : TESTIDS.adminDashboard.root;
      await waitFor(expected, 40000);
    });
  }

  /* --- feature parity: every admin destination is reachable --- */
  console.log('\nAdmin feature parity');
  await signOut();
  await signIn(DEMO.admin);

  const ADMIN_SCREENS = [
    ['applications', '/admin/applications', TESTIDS.adminApplications.root],
    ['documents', '/admin/documents', TESTIDS.adminDocuments.root],
    ['loans', '/admin/loans', TESTIDS.adminLoans.root],
    ['collections', '/admin/collections', TESTIDS.adminCollections.root],
    ['users', '/admin/users', TESTIDS.adminUsers.root],
    ['banks', '/admin/banks', TESTIDS.adminBanks.root],
    ['settings', '/admin/settings', TESTIDS.adminSettings.root],
    ['audit', '/admin/audit', TESTIDS.adminAudit.root],
    ['profile', '/admin/profile', TESTIDS.profile.root],
  ];

  for (const [label, path, rootId] of ADMIN_SCREENS) {
    await test(`admin: ${label} is reachable and renders`, async () => {
      await driver.url(`https://localhost${path}`);
      await waitFor(rootId, 30000);
    });
  }

  await test('the loan lifecycle stepper renders on the dashboard', async () => {
    await driver.url('https://localhost/admin');
    await waitFor(TESTIDS.adminDashboard.lifecycle, 30000);
  });

  await test('KPI stat cards render on the dashboard', async () => {
    for (const id of [
      TESTIDS.adminDashboard.kpiApplications,
      TESTIDS.adminDashboard.kpiDisbursed,
      TESTIDS.adminDashboard.kpiUsers,
    ]) {
      await waitFor(id, 20000);
    }
  });

  /* --- mobile adaptations --- */
  console.log('\nMobile adaptation');
  await test('the bottom tab bar is present, not a shrunken sidebar', async () => {
    await driver.url('https://localhost/admin');
    await waitFor(TESTIDS.shell.tabBar, 20000);
    const sidebar = await driver.$(byId(TESTIDS.shell.sidebar));
    if (await sidebar.isDisplayed()) {
      throw new Error('the desktop sidebar is visible at phone width');
    }
  });

  await test('every tab target is at least 44px tall', async () => {
    const heights = await driver.execute(`
      return Array.from(document.querySelectorAll('[data-testid^="app-tab-"]'))
        .map((el) => Math.round(el.getBoundingClientRect().height));
    `);
    if (!heights.length) throw new Error('no tab targets found');
    const small = heights.filter((h) => h < 44);
    if (small.length) throw new Error(`tabs shorter than 44px: ${small.join(', ')}`);
  });

  await test('demo role buttons are at least 44px tall', async () => {
    await signOut();
    const heights = await driver.execute(`
      return Array.from(document.querySelectorAll('[data-testid^="login-demo-"]'))
        .map((el) => Math.round(el.getBoundingClientRect().height));
    `);
    if (!heights.length) throw new Error('no demo buttons found');
    const small = heights.filter((h) => h < 44);
    if (small.length) throw new Error(`demo buttons shorter than 44px: ${small.join(', ')}`);
  });

  await test('safe-area insets are applied, not ignored', async () => {
    const native = await driver.execute(
      'return document.documentElement.classList.contains("is-native");'
    );
    if (!native) throw new Error('the is-native class was never set — initNative did not run');
  });

  await test('the drawer opens from More and lists the full nav', async () => {
    await signIn(DEMO.admin);
    await driver.url('https://localhost/admin');
    await (await waitFor(TESTIDS.shell.tabMore, 20000)).click();
    await waitFor(TESTIDS.shell.mobileNavDrawer, 15000);
    // Destinations with no tab of their own must still be in the drawer.
    for (const key of ['users', 'banks', 'settings', 'audit']) {
      await waitFor(navId(key, true), 10000);
    }
  });

  /* --- KYC capture path --- */
  console.log('\nKYC document path');
  await test('the documents step offers camera capture', async () => {
    /*
     * Provisioned through the API rather than reusing the demo customer:
     * the capture control only renders while the DOCUMENTS step is active,
     * and the demo customer's applications have long since moved past it.
     * A fresh customer taken exactly as far as KYC puts the app in the one
     * state this control belongs to.
     */
    const setup = await driver.executeAsync(function (ORIGIN, done) {
      var API = ORIGIN + '/api';
      var suffix = String(Date.now()).slice(-7);
      var who = {
        name: 'Mobile QA ' + suffix,
        email: 'mobile.qa.' + suffix + '@sedbank.test',
        mobile: '9' + suffix + '42',
        password: 'Passw0rd!23',
      };
      who.mobile = who.mobile.slice(0, 10);

      var token;
      var json = function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error(res.status + ' ' + t); });
        return res.json();
      };
      var auth = function () {
        return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
      };

      fetch(API + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(who),
      })
        .then(json)
        .then(function (body) {
          token = body.data.token;
          return fetch(API + '/applications', {
            method: 'POST',
            headers: auth(),
            body: JSON.stringify({
              amountRequested: 300000,
              tenureRequested: 24,
              purpose: 'home_renovation',
              employment: { type: 'salaried', monthlyIncome: 90000, existingEmi: 2000 },
              personal: { fullName: who.name, city: 'Chennai', state: 'Tamil Nadu' },
              submit: true,
            }),
          });
        })
        .then(json)
        .then(function (body) {
          var id = body.data.application._id;
          return fetch(API + '/applications/' + id + '/kyc', {
            method: 'POST',
            headers: auth(),
            body: JSON.stringify({ pan: 'ABCDE1234F', aadhaar: '123412341234' }),
          }).then(json).then(function () { return id; });
        })
        .then(function (id) {
          window.localStorage.setItem('sedbank.token', token);
          done({ id: id });
        })
        .catch(function (e) { done({ error: e.message }); });
    }, `${API_ORIGIN}`);

    if (setup.error) throw new Error('provisioning failed: ' + setup.error);

    await driver.url(`https://localhost/app/applications/${setup.id}`);
    await waitFor(TESTIDS.applicationDetail.root, 30000);
    await waitFor(TESTIDS.applicationDetail.documentFileInput, 20000);
    await waitFor(TESTIDS.applicationDetail.documentCapture, 20000);
  });

  await test('the camera permission is declared in the manifest', async () => {
    const dumped = await driver.execute('mobile: shell', {
      command: 'dumpsys',
      args: ['package', APP_ID],
    }).catch(() => null);
    if (typeof dumped === 'string' && !dumped.includes('android.permission.CAMERA')) {
      throw new Error('CAMERA permission not present');
    }
  });

  /* --- things that only broke on a real device --- */
  console.log('\nNative widgets and navigation');

  await test('the status dropdown opens, is legible, and applies a choice', async () => {
    /*
     * A <select> popup is an OS widget: it takes its colours from the Android
     * theme and ignores the element's CSS. Two theme mistakes made it unusable
     * — DayNight resolved the row text for a light theme on our dark ground,
     * and the launch theme's `android:background` handed the splash artwork to
     * the list rows. Neither is visible from inside the WebView, so this
     * drives the native dialog and checks the selection lands.
     */
    await signIn(DEMO.admin);
    await driver.url('https://localhost/admin/loans');
    await waitFor(TESTIDS.adminLoans.statusFilter, 30000);

    const before = await driver.execute(
      `return document.querySelector('[data-testid="${TESTIDS.adminLoans.statusFilter}"]').value;`
    );

    await nativeTap(TESTIDS.adminLoans.statusFilter);
    await driver.pause(1500);

    await driver.switchContext('NATIVE_APP');
    try {
      // The rows are real native views; if the dialog never opened, this fails.
      const option = await driver.$('android=new UiSelector().text("Overdue")');
      await option.waitForExist({ timeout: 15000, timeoutMsg: 'the native dropdown never opened' });

      const box = await option.getSize();
      // A row wearing the splash drawable was ~1000px tall; a text row is not.
      if (box.height > 400) {
        throw new Error(`dropdown row is ${box.height}px tall — it is drawing a background image`);
      }
      await option.click();
    } finally {
      await useWebview();
    }

    await driver.pause(1200);
    const after = await driver.execute(
      `return document.querySelector('[data-testid="${TESTIDS.adminLoans.statusFilter}"]').value;`
    );
    if (after === before) throw new Error(`the selection did not apply (still "${after}")`);
    if (after !== 'overdue') throw new Error(`expected "overdue", got "${after}"`);
  });

  await test('a wide table scrolls inside its card instead of being clipped', async () => {
    await driver.url('https://localhost/admin/loans');
    await waitFor(TESTIDS.adminLoans.table, 30000);

    const geometry = await driver.execute(`
      const table = document.querySelector('[data-testid="${TESTIDS.adminLoans.table}"]');
      const wrapper = table.parentElement;
      const card = table.closest('.card');
      const firstCell = table.querySelector('tbody td');
      return {
        cardLeft: card.getBoundingClientRect().left,
        wrapperLeft: wrapper.getBoundingClientRect().left,
        cellLeft: firstCell.getBoundingClientRect().left,
        overflowX: getComputedStyle(wrapper).overflowX,
        scrollable: wrapper.scrollWidth > wrapper.clientWidth,
        scrollLeft: wrapper.scrollLeft,
        pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    `);

    // The wrapper used a negative margin meant to cancel a padding the card
    // does not have, so it sat outside the card and the card clipped it.
    if (geometry.wrapperLeft < geometry.cardLeft - 1) {
      throw new Error(
        `the table starts ${Math.round(geometry.cardLeft - geometry.wrapperLeft)}px outside its card, so it is clipped`
      );
    }
    if (geometry.cellLeft < geometry.cardLeft) {
      throw new Error('the first column starts left of the card and is cut off');
    }
    if (geometry.overflowX !== 'auto' && geometry.overflowX !== 'scroll') {
      throw new Error(`the table wrapper does not scroll (overflow-x: ${geometry.overflowX})`);
    }
    if (geometry.pageOverflows) throw new Error('the page itself scrolls sideways');
  });

  await test('a sub-page offers a back button that returns to the list', async () => {
    await driver.url('https://localhost/admin/loans');
    await waitFor(TESTIDS.adminLoans.table, 30000);

    // Any row will do; take the first.
    const first = await driver.execute(`
      const row = document.querySelector('[data-testid^="${TESTIDS.adminLoans.row}-row-"]')
        || document.querySelector('tbody tr');
      if (!row) return null;
      row.querySelector('a, button, td')?.click?.();
      return true;
    `);
    if (!first) throw new Error('no loan rows to open');

    await waitFor(TESTIDS.adminLoanDetail.root, 30000);

    // The phone has no sidebar to orient from, so a visible way back matters.
    const back = await waitFor(TESTIDS.shell.back, 15000);
    const size = await back.getSize();
    if (size.height < 40) throw new Error(`the back target is only ${size.height}px tall`);

    await back.click();
    await waitFor(TESTIDS.adminLoans.table, 30000);
  });

  await test('Android back navigates instead of dropping out of the app', async () => {
    await driver.url('https://localhost/admin/loans');
    await waitFor(TESTIDS.adminLoans.table, 30000);
    await driver.execute(`
      const row = document.querySelector('tbody tr');
      row.querySelector('a, button, td')?.click?.();
    `);
    await waitFor(TESTIDS.adminLoanDetail.root, 30000);

    await driver.back(); // the hardware gesture
    await driver.pause(1500);
    await useWebview();

    // Capacitor's default is to exit the app on back, from anywhere.
    const state = await driver.queryAppState(APP_ID);
    if (state !== 4) throw new Error(`back left the app (state ${state})`);
    await waitFor(TESTIDS.adminLoans.table, 20000);
  });

  await test('Android back closes the nav drawer first', async () => {
    await driver.url('https://localhost/admin');
    await waitFor(TESTIDS.shell.root, 30000);
    await (await waitFor(TESTIDS.shell.tabMore, 20000)).click();
    await waitFor(TESTIDS.shell.mobileNavDrawer, 15000);

    await driver.back();
    await driver.pause(1200);
    await useWebview();

    const stillOpen = await driver.execute(
      `return !!document.querySelector('[data-testid="${TESTIDS.shell.mobileNavDrawer}"]');`
    );
    if (stillOpen) throw new Error('the drawer stayed open');

    const state = await driver.queryAppState(APP_ID);
    if (state !== 4) throw new Error(`back left the app instead of closing the drawer (state ${state})`);
  });

  console.log('\nKeyboard and background behaviour');

  await test('the soft keyboard is accounted for, not left covering the field', async () => {
    /*
     * Two things are needed before the on-screen keyboard will appear at all,
     * and neither is the app's fault:
     *   - AVDs built with hw.keyboard=yes suppress it unless
     *     show_ime_with_hard_keyboard is set, and the IME only reads that
     *     setting when it restarts;
     *   - a chromedriver click focuses the input without raising the IME, so
     *     the tap has to go through the native context.
     * Without both, this test would report a working feature as broken.
     */
    await shell('settings', ['put', 'secure', 'show_ime_with_hard_keyboard', '1']);

    /*
     * Restart the IME every time, not just when the setting changes: on this
     * AVD it stops honouring the setting between runs and dumpsys reports
     * mInputShown=false however the field is tapped. The pause is for it to
     * come back — tapping while it starts draws no keyboard at all.
     */
    const ime = String(await shell('settings', ['get', 'secure', 'default_input_method'])).trim();
    if (ime && ime !== 'null') {
      await shell('am', ['force-stop', ime.split('/')[0]]);
      await shell('ime', ['set', ime]);
      await driver.pause(6000);
    }

    await signOut();
    await driver.url('https://localhost/login');
    await waitFor(TESTIDS.login.root);
    await (await waitFor(TESTIDS.login.tabOtp)).click();
    await waitFor(TESTIDS.login.mobileInput);

    const viewportBefore = await driver.execute('return window.innerHeight;');
    await nativeTap(TESTIDS.login.mobileInput);

    /*
     * Whether the IME actually came up is a fact about the emulator, and it
     * has to be established before anything is asserted about the app: this
     * AVD sometimes refuses to raise it for WebView inputs however the field
     * is tapped, and blaming the app for that would be wrong.
     */
    let shown = false;
    for (let i = 0; i < 10; i += 1) {
      await driver.pause(700);
      const dump = String(await shell('dumpsys', ['input_method']));
      if (/mInputShown=true/.test(dump)) {
        shown = true;
        break;
      }
      if (i === 4) await nativeTap(TESTIDS.login.mobileInput); // one retry
    }

    if (!shown) {
      throw new Error(
        'SKIP: the emulator would not raise the soft IME (mInputShown=false), ' +
          'so keyboard handling cannot be exercised here'
      );
    }

    let state = {};
    for (let i = 0; i < 16; i += 1) {
      await driver.pause(500);
      state = await driver.execute(`
        const el = document.querySelector('[data-testid="${TESTIDS.login.mobileInput}"]');
        return {
          open: document.documentElement.classList.contains('keyboard-open'),
          height: parseInt(getComputedStyle(document.documentElement)
            .getPropertyValue('--keyboard-height'), 10) || 0,
          viewport: window.innerHeight,
          fieldBottom: Math.round(el.getBoundingClientRect().bottom),
          focused: el === document.activeElement,
        };
      `);
      if (state.open && state.height > 0) break;
    }

    if (!state.focused) throw new Error('the native tap did not focus the field');
    if (!state.open) throw new Error('html.keyboard-open was never set');

    /*
     * Distinguish "the app failed to measure the keyboard" from "there was
     * nothing to measure". On this AVD the IME draws over the WebView without
     * resizing the window, the visual viewport or the body, and the plugin
     * reports a height of 0 — so no source exists and the app cannot be at
     * fault. When the geometry *does* move, a zero offset is a real bug and
     * fails below.
     */
    const moved = state.viewport < viewportBefore;

    if (!moved && state.height <= 0) {
      throw new Error(
        'SKIP: the keyboard opened but changed no viewport, body or visual-viewport ' +
          `height (all ${state.viewport}px) and the plugin reported 0, so the offset ` +
          'has no source to read here — needs a device or an AVD with hw.keyboard=no'
      );
    }

    if (state.height <= 0) {
      throw new Error(
        `the viewport shrank ${viewportBefore} -> ${state.viewport} but --keyboard-height stayed 0px`
      );
    }
    // The point of all of it: the field is still on screen.
    if (state.fieldBottom > state.viewport) {
      throw new Error(
        `field bottom ${state.fieldBottom}px is below the ${state.viewport}px viewport`
      );
    }

    await driver.execute('document.activeElement.blur();');
    await hideKeyboard();
  });

  await test('the low-power path is detected and drops blur without losing the panels', async () => {
    await signIn(DEMO.admin);
    await driver.url('https://localhost/admin');
    await waitFor(TESTIDS.shell.root, 30000);

    /*
     * Panels are Tailwind utilities (`bg-white/[0.06] backdrop-blur-heavy`),
     * not the .glass classes — the blur utility is what marks a surface as
     * glass, so that is what to measure. The drawer scrim is excluded: it is a
     * dimming layer, and is meant to stay translucent.
     */
    const PANEL = "[class*='backdrop-blur']:not([class*='canvas-deep'])";

    // This emulator reports 4 cores / 2GB, so the app turns the cheap path on
    // by itself — which is the detection working, and worth asserting.
    const device = await driver.execute(`
      return {
        auto: document.documentElement.classList.contains('perf-lite'),
        cores: navigator.hardwareConcurrency || 0,
        memory: navigator.deviceMemory || 0,
      };
    `);
    const weak = (device.cores > 0 && device.cores <= 4) || (device.memory > 0 && device.memory <= 4);
    if (weak && !device.auto) {
      throw new Error(
        `device reports ${device.cores} cores / ${device.memory}GB but perf-lite was not applied`
      );
    }

    // Measure with the cheap path off, so "blur removed" means something.
    const before = await driver.execute(`
      document.documentElement.classList.remove('perf-lite');
      const panel = document.querySelector("${PANEL}");
      const style = panel && getComputedStyle(panel);
      return {
        blur: style ? (style.backdropFilter || style.webkitBackdropFilter || 'none') : 'no-panel',
        orbs: document.querySelectorAll('.orb').length,
      };
    `);
    if (before.blur === 'no-panel') throw new Error('no glass panel found to measure');
    if (before.blur === 'none') {
      throw new Error('no backdrop-filter was active, so perf-lite cannot be shown to remove it');
    }
    if (before.orbs === 0) throw new Error('no ambient orbs present to switch off');

    const after = await driver.execute(`
      document.documentElement.classList.add('perf-lite');
      const panel = document.querySelector("${PANEL}");
      const style = getComputedStyle(panel);
      const orb = document.querySelector('.orb');
      return {
        blur: style.backdropFilter || style.webkitBackdropFilter || 'none',
        background: style.backgroundColor,
        orbHidden: orb ? getComputedStyle(orb).display === 'none' : true,
      };
    `);

    if (after.blur !== 'none') throw new Error(`backdrop-filter survived perf-lite: ${after.blur}`);
    if (!after.orbHidden) throw new Error('ambient orbs still rendering under perf-lite');
    /*
     * And it must be a solid fill. Without the blur, the 6% white wash the
     * panel normally carries would leave text sitting on bare canvas, so a
     * translucent result here is a failure even though something is set.
     */
    const alpha = after.background.match(/rgba?\([^)]*?,\s*([\d.]+)\)/);
    if (alpha && Number(alpha[1]) < 0.9) {
      throw new Error(`panel fill is still translucent under perf-lite: ${after.background}`);
    }

    // Still navigable on the cheap path.
    await (await waitFor(TESTIDS.shell.tabMore, 20000)).click();
    await waitFor(TESTIDS.shell.mobileNavDrawer, 15000);

    // Leave the device's own profile in place.
    await driver.execute(
      `document.documentElement.classList.toggle('perf-lite', ${device.auto});`
    );
  });

  await test('ambient animation pauses while the app is backgrounded', async () => {
    // Watch for the class from the test side, so nothing test-only is added
    // to the app: the observer records transitions we cannot see live while
    // the app is off-screen.
    await driver.execute(`
      window.__pauseLog = [];
      window.__pauseObserver?.disconnect();
      window.__pauseObserver = new MutationObserver(() => {
        window.__pauseLog.push(document.documentElement.classList.contains('app-paused'));
      });
      window.__pauseObserver.observe(document.documentElement,
        { attributes: true, attributeFilter: ['class'] });
    `);

    await driver.background(4); // home, wait, foreground again

    // The context handle does not survive the trip: re-attach before asking
    // the page anything, or every execute() times out.
    await useWebview();

    const log = await driver.execute('return window.__pauseLog || [];');
    if (!log.includes(true)) {
      throw new Error(`app-paused never applied on background (log: ${JSON.stringify(log)})`);
    }
    if (log[log.length - 1] !== false) {
      throw new Error('app-paused was not cleared on resume');
    }

    // The class must genuinely stop the drift, not merely be present.
    const stopped = await driver.execute(`
      document.documentElement.classList.add('app-paused');
      const orb = document.querySelector('.orb');
      const state = orb ? getComputedStyle(orb).animationPlayState : 'none';
      document.documentElement.classList.remove('app-paused');
      return state;
    `);
    if (stopped !== 'paused' && stopped !== 'none') {
      throw new Error(`orb animation-play-state was "${stopped}" while paused`);
    }
  });
} catch (error) {
  // Anything thrown outside a test() wrapper — setup, navigation — would
  // otherwise vanish behind the exit code set in `finally`.
  fail('suite setup', error);
} finally {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const skipped = failed.filter((r) => r.detail.startsWith('SKIP:'));
  const real = failed.filter((r) => !r.detail.startsWith('SKIP:'));

  console.log(`\n${'─'.repeat(64)}`);
  console.log(
    `${passed} passed, ${real.length} failed, ${skipped.length} skipped` +
      (reconnects ? ` (${reconnects} session reconnect${reconnects > 1 ? 's' : ''})` : '')
  );
  if (real.length) {
    console.log('\nFailures:');
    real.forEach((r) => console.log(`  ✘ ${r.name}\n      ${r.detail}`));
  }
  if (skipped.length) {
    console.log('\nSkipped:');
    skipped.forEach((r) => console.log(`  – ${r.name}: ${r.detail.replace('SKIP: ', '')}`));
  }

  await driver?.deleteSession().catch(() => {});
  process.exit(real.length ? 1 : 0);
}
