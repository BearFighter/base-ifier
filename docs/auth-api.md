# Account service contract (`baseifier.bitdeathlabs.com`)

The app's optional sign-in (bottom bar, "Sign in") talks to this service. It is
not built yet; until it answers, the app shows "The account service is not
available yet" and keeps working without an account. Nothing in the app is
gated on it today. Implemented client: `src/app/auth.ts`.

Base URL: `https://baseifier.bitdeathlabs.com` (`AUTH_BASE_URL` in `src/app/config.ts`).
All requests and responses are JSON. CORS must allow `app://base-ifier` (the
desktop shell), `http://localhost:5173` (dev) and wherever the web build is hosted.

## POST /api/auth/login

Request body:

```json
{ "email": "someone@example.com", "password": "..." }
```

Responses:

- `200` → `{ "token": "<opaque bearer token>", "user": { "email": "...", "name": "optional", "plan": "pro" } }`
- `401` or `403` → wrong email or password (the app shows exactly that).
- anything else, or no answer within 8 s → "service not available yet".

The app stores `token` and `user` in `localStorage` under `baseifier.auth`.

## GET /api/auth/me

Header: `Authorization: Bearer <token>`.

- `200` → `{ "user": { "email": "...", "name": "...", "plan": "..." } }` (the app refreshes the stored user)
- `401` or `403` → the stored session is dropped (signed out).
- network failure → the stored session is kept (offline use).

Called once when the app starts if a token is stored.

## Later

`plan` is free-form today. When paid features exist the app will read it
(e.g. `"pro"`) to unlock them; keep it a short stable string. A token expiry
field (`expiresAt`, ISO 8601) can be added to the login response without
breaking the current client, which ignores unknown fields.
