# Tech stack

A two-package npm workspace: an Express API and a Vite React SPA, with a shared
testid catalogue between them. The Android app is the same SPA build inside a
Capacitor WebView, not a second codebase.

```
sedbank/
├── backend/          Express + Mongoose API, Socket.IO
├── frontend/         React + Vite SPA
│   ├── android/      Capacitor Android project (Gradle)
│   └── src/lib/native.js   native capabilities, inert in a browser
├── shared/           testIds.js — imported by the app AND the tests
├── e2e/              Playwright specs (7 files)
├── mobile-e2e/       Appium / UiAutomator2 suite
├── qa/postman/       Newman API collection
├── render.yaml       API deployment blueprint
└── frontend/vercel.json
```

## Backend

| | |
|---|---|
| Runtime | Node ≥ 18, ES modules |
| Framework | Express 4 |
| Database | MongoDB via Mongoose 8 |
| Realtime | Socket.IO 4 |
| Auth | JWT (`jsonwebtoken`) + bcrypt |
| Validation | Zod, at the route boundary |
| PDFs | `pdf-lib` — schedules, statements, NOCs |
| Security | Helmet, CORS allowlist |
| Uploads | Multer (memory) → stored in MongoDB, served authorised |
| Mail | Nodemailer, console-logged unless SMTP is enabled |
| Dates | Day.js |

**Zero-setup database.** With `MONGO_URI` empty the app boots an in-process
`mongodb-memory-server`, so `npm run dev` works on a clean checkout with no
database installed. Set `MONGO_URI` for anything persistent.

**Layering.** `routes → middleware (auth, role, validation) → controller →
service → model`. Business rules live in services; controllers only translate
HTTP. Nothing reads `process.env` directly except `config/env.js`.

## Frontend

| | |
|---|---|
| Framework | React 18 |
| Build | Vite 6 |
| Routing | React Router 6 (`BrowserRouter`) |
| Server state | TanStack Query 5 |
| Styling | Tailwind CSS 3 |
| Charts | Recharts |
| Primitives | Radix UI — dialog, dropdown, popover, tabs |
| Icons | Lucide |
| HTTP | Axios |
| Realtime | `socket.io-client` |

**Design system.** One token file, `frontend/tailwind.config.js`, plus the glass
primitives in `frontend/src/index.css`. Colour, type, radius, blur, shadow and
motion all come from there — no page defines its own palette. Recharts styles
via props rather than CSS, so its theme lives in `frontend/src/lib/chartTheme.js`.

The neutral ramp is deliberately **inverted** — low numbers are surfaces, high
numbers are text — which is what let the whole app re-theme from one file. The
config header explains it.

## Testing

Four layers, all runnable from the repo root:

| Command | What it covers |
|---|---|
| `npm run test:unit` | 46 Jest tests — EMI maths, underwriting rules |
| `npm run test:api` | 98 requests / 303 assertions, Newman. Boots a throwaway API itself |
| `npm run test:e2e` | 87 Playwright tests — 29 specs × desktop, iPad Mini, iPhone 13 |
| `npm test` | all three in sequence |
| `npm run test:mobile` | 32 Appium tests on the Android app — needs an emulator |

Both test suites spin up their own API against an in-memory database, so
neither needs a running server or touches real data.

Element lookups go through `shared/testIds.js` — the same module the components
import — so no testid string is ever duplicated between the app and the tests.

## Android

| | |
|---|---|
| Shell | Capacitor 6 (`androidScheme: https` ⇒ WebView origin `https://localhost`) |
| Plugins | App, Device, Keyboard, SplashScreen, StatusBar, Camera, PushNotifications, `capacitor-native-biometric` |
| Build | Gradle wrapper in `frontend/android` |
| Tests | Appium 3 + UiAutomator2, driven through WebdriverIO |

`VITE_API_URL` is inlined at build time and **must** be an absolute, reachable
URL — inside the WebView `localhost` is the phone, not your machine.
[MOBILE.md](MOBILE.md) covers the build, the mobile-only adaptations and the
native capabilities.

## Local development

```bash
npm run install:all
npm run dev              # API on :5001, web on :5173
```

`npm run dev` starts both. Demo accounts are seeded on boot when the database is
ephemeral, so you can sign in immediately.

For end-to-end tests you also need browsers once:

```bash
npm run playwright:install
```

## Deployment

- **API → Render.** `render.yaml` is a blueprint; root directory `backend`,
  health check `/api/health`.
- **Web → Vercel.** Root directory `frontend`; `vercel.json` carries the SPA
  rewrite (needed because the app uses `BrowserRouter`) and pins the install
  command.
- **Database → MongoDB Atlas** M0.

See [FLOW.md](FLOW.md) for the product walkthrough, [API.md](API.md) for the
endpoint reference and [CREDENTIALS.md](CREDENTIALS.md) for the demo logins.

## Deliberate constraints

- **No business data is ever seeded.** A fresh install reads zero and every
  screen has a real empty state rather than invented figures.
- **Every integration is mocked** — KYC, credit bureau, penny drop, payment
  gateway, SMS, email. Nothing leaves the process.
- **Uploads are stored in MongoDB** and served from an authorised route, so
  they survive a redeploy and are not world-readable. Files are capped at 5 MB,
  well inside the 16 MB BSON limit; object storage would be the move at real
  volume.
