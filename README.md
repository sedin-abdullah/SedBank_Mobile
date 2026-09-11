# SedBank

A digital lending platform covering the whole personal-loan lifecycle —
application, KYC, credit bureau check, underwriting, offer, e-signature,
disbursement, EMI repayment, collections and closure — for both the borrower
and the operations team.

Built for Sedin Technologies as a demonstration platform. Every external
integration is simulated; no real financial or personal data is processed.

## Documentation

| | |
|---|---|
| [docs/FLOW.md](docs/FLOW.md) | The end-to-end journey, step by step, with the underwriting rules |
| [docs/CREDENTIALS.md](docs/CREDENTIALS.md) | The five demo logins and what each role can do |
| [docs/API.md](docs/API.md) | All 79 endpoints with their access rules |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Architecture, libraries, testing, deployment |
| [docs/MOBILE.md](docs/MOBILE.md) | The Android app — building it, and what is mobile-specific |

## Run it locally

```bash
npm run install:all
npm run dev
```

- API → <http://localhost:5001>
- Web → <http://localhost:5173>

No database setup is needed. With `MONGO_URI` empty the API boots an in-process
MongoDB and seeds the five demo login accounts, so you can sign in straight
away. Sign in as `admin@sedbank.test` / `Admin@12345`.

Business data is deliberately **not** seeded — a fresh install reads zero and
every screen shows a real empty state. [docs/FLOW.md](docs/FLOW.md) walks a loan
through end to end, which is the quickest way to see the whole product.

## Tests

```bash
npm run test:unit    # 46 Jest tests — EMI maths, underwriting rules
npm run test:api     # 303 assertions over 98 requests (Newman)
npm run test:e2e     # 93 Playwright tests across desktop, tablet and phone
npm test             # all three
npm run test:mobile  # 38 Appium tests on the Android app (needs an emulator)
```

Both integration suites boot their own throwaway API, so nothing needs to be
running first. For the e2e suite, install browsers once with
`npm run playwright:install`.

## What is in the box

**Two portals from one shell.** Borrowers get `/app`; credit, ops, collections
and admin staff get `/admin`, with navigation filtered per role and the same
rules enforced server-side.

**An Android app from the same build.** Capacitor wraps the SPA, so every screen
and role is present on a phone — with a bottom tab bar instead of a sidebar,
camera KYC capture and biometric sign-in.
[Download the APK](https://github.com/SedDemo/Sed_Bank/releases/download/v1.0.0-android/SedBank-v1.0.0-debug.apk),
or see [docs/MOBILE.md](docs/MOBILE.md) to build it.

**A real rule engine.** Bureau score, income floor and FOIR decide between
straight-through approval, an officer's queue, and rejection — then price the
offer off the score band. Thresholds are editable at runtime.

**Live updates.** Socket.IO pushes application and loan changes, so an
officer's worklist and a borrower's status change without a refresh.

**Generated documents.** EMI schedules, account statements and No-Dues
Certificates are produced as real PDFs.

**An audit trail.** Every decision, verification and configuration change is
recorded with actor and timestamp.

## Deployment

The API runs on Render, the SPA on Vercel, the database on MongoDB Atlas.
`render.yaml` and `frontend/vercel.json` carry the configuration that matters;
[docs/TECH_STACK.md](docs/TECH_STACK.md) covers the rest.

Four environment variables decide whether a deployment works at all:

| Variable | Why it matters |
|---|---|
| `MONGO_URI` | Empty means an in-memory database that is wiped on restart |
| `JWT_SECRET` | The app refuses to boot in production with the bundled default |
| `CORS_ORIGINS` | Must list the web origin exactly, or the browser is blocked |
| `SEED_ON_BOOT` | With a real database the seeder is skipped, leaving no accounts to sign in with |

Two flags keep a deployment demo-only: `EXPOSE_OTP=true` returns the mocked OTP
to any caller (the e-sign step cannot complete without it, as no SMS vendor is
wired up), and the seeded accounts use published passwords. Do not put real
data behind either.

Uploaded documents are stored in MongoDB rather than on the API's local disk,
which is ephemeral on Render, and are served from an authorised endpoint.

## Licence

Internal demonstration project.
