# API reference

`81` endpoints. Base URL is the API origin — `http://localhost:5001` locally,
`https://sedbank-api.onrender.com` deployed.

Every response uses the same envelope:

```json
{ "success": true,  "data": { } }
{ "success": false, "error": { "message": "…", "fields": { } } }
```

Authentication is a bearer token from `POST /api/auth/login`:

```
Authorization: Bearer <token>
```

**Access column** — `Public` needs no token. `Signed in` needs any valid token and
then scopes to what the caller owns (a borrower only ever sees their own records).
Named roles are enforced server-side; `Admin` passes every staff check.

*Generated from `backend/src/routes/index.js`, which is the single place the whole
access model is declared.*


## Health

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/health` | **Public** |
| `GET` | `/api/health` | **Public** |

`/api/health` is a liveness check: it answers as soon as Express is up and
touches nothing, which is what Render's `healthCheckPath` needs.

`/health` also pings MongoDB, so one call warms the web service *and* the
database — the two things that are cold after Render idles a free-tier
instance. It returns plain `OK` with 200, or `Database unavailable` with 500 if
the ping fails or the connection is not up yet. Hit it before a demo.

## Authentication

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/auth/register` | **Public** |
| `POST` | `/api/auth/login` | **Public** |
| `POST` | `/api/auth/otp/request` | **Public** |
| `POST` | `/api/auth/otp/verify` | **Public** |
| `GET` | `/api/auth/me` | Signed in |
| `PATCH` | `/api/auth/me` | Signed in |
| `POST` | `/api/auth/change-password` | Signed in |

## Eligibility and product

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/eligibility/check` | **Public** |
| `GET` | `/api/product` | **Public** |
| `GET` | `/api/audit` | Admin |
| `GET` | `/api/roles` | Admin |

## Applications — origination

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/applications` | Signed in |
| `POST` | `/api/applications` | Customer |
| `GET` | `/api/applications/:id` | Signed in |
| `PATCH` | `/api/applications/:id` | Customer |
| `POST` | `/api/applications/:id/submit` | Customer |
| `POST` | `/api/applications/:id/withdraw` | Customer |
| `POST` | `/api/applications/:id/kyc` | Customer |
| `GET` | `/api/applications/:id/documents` | Signed in |
| `POST` | `/api/applications/:id/documents` *(multipart)* | Customer |
| `POST` | `/api/applications/:id/bureau` | Customer |
| `GET` | `/api/applications/:id/bureau` | Signed in |
| `POST` | `/api/applications/:id/offer/accept` | Customer |
| `POST` | `/api/applications/:id/agreement/otp` | Customer |
| `POST` | `/api/applications/:id/agreement/sign` | Customer |
| `POST` | `/api/applications/:id/bank-account` | Customer |
| `GET` | `/api/applications/:id/timeline` | Signed in |
| `GET` | `/api/applications/:id/decisions` | Signed in |

## Underwriting

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/underwriting/queue` | Credit Officer, Ops Officer (+Admin) |
| `POST` | `/api/underwriting/:id/decision` | Credit Officer, Ops Officer (+Admin) |

## Documents

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/documents/pending` | Ops Officer, Credit Officer (+Admin) |
| `PATCH` | `/api/documents/:documentId/verify` | Ops Officer, Credit Officer (+Admin) |
| `DELETE` | `/api/documents/:documentId` | Signed in |

## Loan accounts

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/loans` | Signed in |
| `POST` | `/api/loans/disburse/:applicationId` | Ops Officer (+Admin) |
| `GET` | `/api/loans/:id` | Signed in |
| `GET` | `/api/loans/:id/schedule` | Signed in |
| `GET` | `/api/loans/:id/payments` | Signed in |
| `GET` | `/api/loans/:id/foreclosure-quote` | Signed in |
| `GET` | `/api/loans/:id/timeline` | Signed in |
| `GET` | `/api/loans/:id/schedule.pdf` | Signed in |
| `GET` | `/api/loans/:id/statement.pdf` | Signed in |
| `GET` | `/api/loans/:id/noc.pdf` | Signed in |

## Payments

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/payments` | Signed in |
| `POST` | `/api/payments/initiate` | Customer |
| `POST` | `/api/payments/confirm` | Customer |
| `POST` | `/api/payments/record` | Ops Officer, Collections Officer (+Admin) |

## Collections

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/collections/overview` | Collections Officer (+Admin) |
| `GET` | `/api/collections/accounts` | Collections Officer (+Admin) |
| `GET` | `/api/collections/:loanId/notes` | Collections Officer (+Admin) |
| `POST` | `/api/collections/:loanId/notes` | Collections Officer (+Admin) |
| `POST` | `/api/collections/remind` | Collections Officer (+Admin) |

## Users

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/users` | Admin |
| `POST` | `/api/users` | Admin |
| `GET` | `/api/users/:id` | Admin |
| `PATCH` | `/api/users/:id` | Admin |
| `DELETE` | `/api/users/:id` | Admin |

## Partner banks

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/banks` | Any staff |
| `GET` | `/api/banks/:id` | Any staff |
| `POST` | `/api/banks` | Admin |
| `PATCH` | `/api/banks/:id` | Admin |
| `DELETE` | `/api/banks/:id` | Admin |

## Configuration

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/config` | Admin |
| `PUT` | `/api/config` | Admin |

## Dashboards

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/dashboard` | Signed in |
| `GET` | `/api/dashboard/customer` | Customer |
| `GET` | `/api/dashboard/admin` | Any staff |

## Notifications

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/notifications` | Signed in |
| `PATCH` | `/api/notifications/:id/read` | Signed in |
| `POST` | `/api/notifications/read-all` | Signed in |

## Mocked integrations

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/mock/kyc/verify` | Any staff |
| `POST` | `/api/mock/bureau/score` | Any staff |
| `POST` | `/api/mock/penny-drop` | Any staff |
| `POST` | `/api/mock/payment/order` | Any staff |
| `POST` | `/api/mock/payment/verify` | Any staff |
| `GET` | `/api/mock/outbox` | Any staff |

## Test hooks

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/testing/backdate-loan` | Test hooks + Admin |
| `POST` | `/api/testing/reset` | Test hooks + Admin |
| `POST` | `/api/testing/sweep` | Test hooks + Admin |

## Notes

- **PDFs** — `/schedule.pdf`, `/statement.pdf` and `/noc.pdf` return
  `application/pdf`, generated with `pdf-lib`. The NOC only exists once a loan is
  closed or foreclosed.
- **Uploads** — `POST /api/applications/:id/documents` is `multipart/form-data`
  with fields `type` and `file`. JPG, PNG or PDF, 5 MB max.
- **Mocked integrations** — `/api/mock/*` are the KYC, bureau, penny-drop and
  payment-gateway stand-ins. No external service is ever called.
- **Test hooks** — `/api/testing/*` (loan back-dating, data reset, delinquency
  sweep) return `404` unless `ENABLE_TEST_HOOKS=true`. They are disabled in
  production, which also makes the bureau `simulate` parameter inert.
- **Realtime** — Socket.IO on the same origin, authenticated with the same
  bearer token. Rooms are per-user and per-role, which is how an officer's
  worklist updates without a refresh.

