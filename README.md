# Com/pass

Com/pass is a SaaS-style image utility app with a single-page frontend and a Node.js backend.

Core capabilities:
- Image compression (quality-balanced canvas pipeline)
- Passport photo generation (remove.bg + country-specific size presets + face-position guides)
- Authentication (signup/signin/JWT + forgot/reset password)
- Subscription billing flow (UPI, Razorpay, Card Gateway, Stripe UI flow)
- User-scoped asset history in MongoDB with grouped workflow records
- Pro batch upload and processing (5-75 images) with single ZIP download
- Print-ready passport PDF export (4/6/8 photos per sheet)

## Current Stack

Frontend:
- `index.html` (single-file app: HTML + CSS + vanilla JS)
- Local fonts from `assets/fonts/`

Backend:
- Node.js + Express
- MongoDB + Mongoose
- JWT auth
- Multer upload handling
- Sharp image composition
- remove.bg API integration
- Nodemailer for password recovery emails

## Project Structure

```text
.
|-- index.html
|-- assets/
|   `-- fonts/
|       |-- Sora-Variable.ttf
|       |-- Inconsolata-Variable.ttf
|       `-- image/placeholder_img.jpg
`-- server/
    |-- server.js
    |-- package.json
    |-- .env
    |-- lib/
    |   `-- db.js
    |-- middleware/
    |   `-- authMiddleware.js
    |-- models/
    |   |-- User.js
    |   |-- ImageAsset.js
    |   `-- BillingRecord.js
    |-- routes/
    |   |-- auth.js
    |   |-- removeBg.js
    |   `-- userWorkflow.js
    `-- utils/
        |-- mailer.js
        |-- removeBgClient.js
        |-- userStore.js
        `-- users.json
```

## Setup

### 1) Backend

From project root:

```bash
cd server
npm install
```

Create/update `server/.env` with your own values:

```env
PORT=4000
JWT_SECRET=replace_with_long_random_secret
MONGODB_URI=your_mongodb_connection_string
REMOVE_BG_API_KEY=your_remove_bg_api_key

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_SECURE=false
APP_BASE_URL=http://127.0.0.1:5500/index.html
```

Run backend:

```bash
npm start
```

Health checks:
- `GET http://localhost:4000/`
- `GET http://localhost:4000/api/health`

### 2) Frontend

Serve the root folder with any static server (for example VS Code Live Server).

Default local frontend URL used in app flows:
- `http://127.0.0.1:5500/index.html`

API base resolution in frontend:
1. Query param override `?apiBase=...`
2. `window.COMXPRESS_API_BASE_URL` / `window.__COMXPRESS_API_BASE_URL`
3. Saved localStorage override
4. Fallback: `http://localhost:4000/api`

### 3) Vercel Deployment (Frontend + API Same Domain)

This repo includes:
- Root `package.json` for Vercel dependency install
- `api/[...path].js` as Vercel serverless API entry
- `server/app.js` as shared Express app for local and Vercel runtime

Vercel setup:
1. Import this repository.
2. Keep project root as repository root.
3. Add environment variables in Vercel Project Settings:
   - `MONGODB_URI`
   - `JWT_SECRET`
   - `REMOVE_BG_API_KEY`
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `SMTP_FROM`
   - `SMTP_SECURE`
   - `APP_BASE_URL` (your deployed frontend URL)
4. Redeploy.

Verify:
- `GET https://<your-app>.vercel.app/api/health`
- `POST https://<your-app>.vercel.app/api/login`

## API Routes (Current)

Auth:
- `POST /api/signup`
- `POST /api/login`
- `GET /api/me`
- `GET /api/usage/monthly`
- `POST /api/forgot-password`
- `POST /api/reset-password`

Image processing:
- `POST /api/remove-bg` (protected)
- `POST /api/process-passport` (protected)
- `POST /api/passport/print-pdf` (protected)
- `POST /api/batch/process-zip` (protected, Pro only)

Asset persistence:
- `POST /api/assets/compressed` (protected)
- `POST /api/assets/passport` (protected)
- `GET /api/assets/recent/groups` (protected)
- `GET /api/assets/recent/compressed` (protected)
- `GET /api/assets/:id` (protected)
- `DELETE /api/assets/:id` (protected)
- `PATCH /api/assets/:id/rename` (protected)
- `DELETE /api/assets/group/:workflowId` (protected)
- `GET /api/assets/compressed/:id` (protected)
- `DELETE /api/assets/compressed/:id` (protected)

Billing:
- `POST /api/billing/subscribe` (protected)
- `POST /api/billing/stripe/checkout-session` (protected)
- `POST /api/billing/stripe/complete` (protected)
- `POST /api/billing/card/checkout-session` (protected)
- `POST /api/billing/card/complete` (protected)
- `GET /api/billing/invoices` (protected)
- `GET /api/billing/invoices/:id/download` (protected, PDF)

Auth header format for protected routes:

```http
Authorization: Bearer <jwt_token>
```

## Current User Workflow

1. User opens app (`index.html`) and can use free flow up to 5 uploads in a batch.
- Free tier monthly usage counter is shown in Upload and Pricing sections (10/month, includes remove.bg calls).
2. User uploads images (drag/drop or picker, multi-select max 5 for free flow, up to 75 for Pro).
3. User compresses image(s):
- Compression runs in browser.
- Compressed file preview and size update are shown.
- State supports refresh-resume behavior for active workflow.
4. User generates passport photo:
- Source selectable: original or compressed.
- Background option: white (default) or blue.
- Backend `process-passport` calls remove.bg, composites result to passport frame, returns PNG.
5. Generated assets are stored in MongoDB under logged-in user:
- Batch processing (Pro only): for 5-75 files, backend compresses each file, runs remove.bg, builds passport outputs, stores all generated assets, and returns one ZIP.
- `compressed`
- `passport`
- grouped by `workflowId`
6. Recently compressed section:
- Fetches groups from DB
- Shows file count per group
- Search and filter by type / remove.bg usage
- Select individual/all files for bulk delete
- Expand group to list each generated file with thumbnail + metadata
- Per-file and per-group actions: view, download, delete, rename, re-process
7. Billing:
- Pricing section and upgrade actions open billing modal/page
- Payment method UI: UPI / Razorpay / Card Gateway / Stripe
- Stripe flow redirects to Stripe Checkout and finalizes on app return
- Credit/debit card details are entered only on Stripe-hosted checkout (not collected in local app form fields)
- Successful payment stores billing record, marks user as subscribed, and creates invoice number
- Invoices drawer/table lists all account invoices and supports PDF download per invoice
8. Notifications and settings:
- Notification drawer with actions/events
- Settings drawer with theme toggle, auth actions, and signed-in state

## Auth Workflow (Current)

- Signup requires: 
ame`, `email`, `password`
- Signup UI includes `confirm password`
- On successful signup, frontend can transition into signin flow with prefilled values
- Signin returns JWT and user profile
- Forgot password:
  - User submits email
  - Backend creates reset token (30 min expiry)
  - Email sent if SMTP configured; token logged server-side when SMTP is missing
- Reset password requires `email + token + newPassword`

Note: The frontend includes OAuth-style provider buttons, but they currently use app-side identity mapping and backend signup/login requests, not full external OAuth provider token exchange.

## Data Models

`User`:
- 
ame`, `email`, `passwordHash`, `subscribed`
- `passwordResetTokenHash`, `passwordResetExpiresAt`

`ImageAsset`:
- `userId`, `type` (`compressed|passport`), `workflowId`
- `originalName`, `mimeType`, `size`, `format`
- `sourceType`, `bgColor`, `originalSize`, `data` (Buffer)

`BillingRecord`:
- `userId`, `plan`, `amount`, `currency`
- `method` (`upi|razorpay|stripe`), `status`
- `billingName`, `billingEmail`, `transactionRef`, `meta`

## Security Notes

- Keep `.env` out of source control (`.gitignore` already configured).
- Rotate any exposed secrets immediately (JWT secret, DB URI, remove.bg key, SMTP creds).
- Use HTTPS and secure cookie/session strategy if moving beyond local/dev usage.
- Validate file types and size limits before production rollout.

## README Maintenance Rule

When any of the following changes, update this README in the same commit:
- Route names or payload contracts
- Auth flow behavior
- Data model fields
- Billing behavior
- Frontend workflow/state behavior
- Environment variables

Recommended release checklist item:
- `README.md` reviewed and updated before merge/deploy.
