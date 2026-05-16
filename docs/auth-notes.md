# Cognito Auth + RBAC (PoC) — README

This project uses:
- **Frontend**: React + Vite + TypeScript
- **Backend**: Flask (`api_bridge.py`, port `5000`)
- **Auth**: **AWS Cognito User Pool** JWT verification on the backend + role-based access control (RBAC)

This is a **PoC**:
- You create the Cognito User Pool manually in the AWS Console.
- Code gracefully falls back to **allow-all** when Cognito is not configured (local dev).

---

## What was implemented (high level)

### Backend (Flask)
- Added **Cognito JWT verification** using the Cognito JWKS (public keys).
- Added a reusable `@require_auth()` decorator that:
  - Verifies `Authorization: Bearer <JWT>`
  - Extracts role from `cognito:groups` (`admin` group ⇒ role `admin`, otherwise `operator`)
  - Enforces `roles=[...]` when provided (returns **403** if role insufficient)
  - **PoC fallback**: when `COGNITO_USER_POOL_ID` is empty, requests are allowed and a dev user is injected.
- Added `GET /api/auth/me` (requires valid JWT) so the frontend can fetch `{ email, role, name }`.
- Applied route protection per the rules below (public vs operator/admin).

### Frontend (React/Vite)
- Implemented Cognito login/logout using **`amazon-cognito-identity-js`** (no Amplify).
- Added a login page at `/#/login` with:
  - Email + password sign-in
  - **First-login password reset** flow (Cognito `NEW_PASSWORD_REQUIRED`)
- Added a real `AuthContext` that:
  - Restores session on page load (if valid)
  - Calls backend `GET /api/auth/me` to hydrate `{email, role, name}`
  - Exposes `isAdmin` to UI
- Updated API wrapper to attach `Authorization: Bearer <token>` automatically and:
  - On **401**: clears Cognito session and redirects to `/#/login`
- Updated `ProtectedRoute`:
  - Shows centered spinner while loading
  - Redirects to `/login` when unauthenticated
  - Shows a 403 panel when `roles` prop disallows access
- Enforced **operator read-only** in UI by disabling (not hiding) admin-only action buttons with a tooltip title.

---

## Files changed / added

### Backend
- `requirements.txt`
  - Added: `python-jose[cryptography]`
- `api_bridge.py`
  - Added: Cognito config, JWKS cache, `require_auth`, `/api/auth/me`
  - Added `@require_auth()` / `@require_auth(roles=['admin'])` to endpoints as specified

### Frontend
- Added: `src/lib/cognito.ts`
- Updated: `src/utils/api.ts` (Bearer token + 401 handling)
- Updated: `src/contexts/AuthContext.tsx` (real Cognito auth, role hydration, token override)
- Updated: `src/components/ProtectedRoute.tsx`
- Added: `src/pages/Login.tsx`
- Updated: `src/App.tsx` (added `/login`, kept HashRouter)
- Updated: `src/pages/Auth.tsx` (redirects to `/login`)
- Updated: `src/components/Header.tsx` (shows name + role badge, logout)

### Vite polyfills (required by amazon-cognito-identity-js in browser)
- Updated: `vite.config.ts` (define `global`, alias `buffer`)
- Updated: `src/main.tsx` (attach `globalThis.Buffer`)
- Added dependency: `buffer`

### Env templates
- Updated: `.env.example` (added backend Cognito keys)
- Added: `.env.local` (frontend Cognito keys placeholder; gitignored)

---

## AWS Console prerequisites (manual)

In **AWS Console → Cognito → User Pools**:
1. Create User Pool: `csr-lifecycle-users` (region `us-east-1`)
2. Create App Client: `csr-lifecycle-app`
   - Enable `USER_PASSWORD_AUTH`
   - **No client secret**
3. Add custom attribute: `custom:role` (string, mutable) *(optional; we use groups for RBAC)*
4. Create users:
   - `admin@its.ms.gov` (temporary password provided by ITS)
   - `operator@its.ms.gov` (temporary password provided by ITS)
5. Create groups:
   - `admin`
   - `operator`

   > **How roles work:** Any user assigned to the `admin`
   > group in Cognito receives admin role on every API call.
   > Users in the `operator` group (or no group) receive
   > operator role. Role assignment is managed entirely in
   > Cognito — no code changes required to promote or
   > demote a user.

6. Assign users to the appropriate group.
7. Copy:
   - **User Pool ID**
   - **App Client ID**

---

## Environment variables

### Backend (Flask) — `.env`

Add:
```env
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

Notes:
- `COGNITO_REGION` is taken from `AWS_REGION` (defaults to `us-east-1`).
- If `COGNITO_USER_POOL_ID` is empty, backend auth falls back to allow-all (PoC).

### Frontend (Vite) — `.env.local` (NOT committed)

Add:
```env
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

Important:
- Vite only reads env vars **at startup**. After editing `.env.local`, restart `npm run dev`.

---

## Route protection rules (RBAC)

### Public (no auth)
- `GET /api/health`
- `GET /api/aws/sns/config`
- `POST /api/ssl/check` *(kept open for the Settings “connection test” card)*

### Authenticated (operator OR admin)
All other `GET` endpoints are protected with `@require_auth()`, including:
- `/api/certificates`, `/api/certificates/*`
- `/api/renew/*`
- `/api/agent/status`, `/api/agent/failures`
- `/api/notifications/*` (GETs)
- `/api/aws/*` (except the public SNS config above)
- `/api/integrations/settings`
- `/api/ca/*`
- `/api/ai/*`
- `GET /api/auth/me`

### Admin-only
Protected with `@require_auth(roles=['admin'])`:
- `POST /api/agent/run-now`
- `POST /api/csr/generate`
- `POST /api/notify/email`
- `POST /api/notify/bulk`
- `POST /api/notifications/settings`
- `POST /api/notifications/<id>/read`
- `POST /api/notifications/read-all`
- `POST /api/monitoring/settings`
- `POST /api/reports/weekly`
- `POST /api/simulate-failure`
- `POST /api/agent/failures/<id>/resolve`
- `POST /api/certificates` (add cert)
- `DELETE /api/certificates/<cert_id>`
- `POST /api/certificates/<cert_id>/confirm-deploy`
- `POST /api/certificates/confirm-deploy-all`
- `POST /api/aws/s3/sync`

---

## How to run (local)

### 1) Backend
From repo root:
```powershell
python -m pip install -r requirements.txt
python api_bridge.py
```

Backend runs at `http://localhost:5000`.

### 2) Frontend
From repo root (separate terminal):
```powershell
npm install
npm run dev
```

Open the URL Vite prints. For HashRouter, login is typically:
- `http://localhost:8081/#/login`

---

## How to test (end-to-end)

### A) Public endpoints (no token)
```powershell
curl http://localhost:5000/api/health
curl http://localhost:5000/api/aws/sns/config
```
Expected: **200**

### B) Protected endpoints (no token)
```powershell
curl http://localhost:5000/api/certificates
```
Expected: **401**

### C) Login as admin
1. Go to `/#/login`
2. Sign in as `admin@its.ms.gov`
3. If prompted, set a new password (first login)
4. After login:
   - Header shows name/email + role badge (`admin`)
   - Admin buttons are enabled
   - Backend logs show `GET /api/auth/me` returning **200**

### D) Login as operator (read-only UI)
1. Go to `/#/login`
2. Sign in as `operator@its.ms.gov`
3. UI should show the full app, but admin actions are:
   - **Visible**
   - **Disabled** with tooltip: “Admin access required”

### E) Backend enforcement (403)
If an operator forces an admin endpoint call (e.g. via devtools), backend must return:
- **403** `Forbidden — insufficient role`

---

## Troubleshooting

### “global is not defined” / Cognito crashes the app
This happens when Node globals aren’t polyfilled in Vite.
Fix is already included:
- `vite.config.ts`: `define.global = "globalThis"`, `alias.buffer = "buffer"`
- `src/main.tsx`: sets `globalThis.Buffer = Buffer`

### “Both UserPoolId and ClientId are required”
Your Vite env vars aren’t set/loaded.
- Ensure `.env.local` contains `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_APP_CLIENT_ID`
- Restart `npm run dev`

### After login, `/api/auth/me` is 200 but other endpoints are 401
Token wasn’t attached due to session timing.
Fix is already included:
- In-memory access token override is set immediately on login/session restore.

### MetaMask / extension errors
You may see console logs about MetaMask or browser extensions. They are unrelated to this app’s auth.

---

## Security notes
- Do **not** commit `.env`, `.env.local`, or any secrets.
- JWT verification uses Cognito’s published JWKS keys; no secrets are needed for verification.

