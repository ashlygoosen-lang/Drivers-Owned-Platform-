# DROP — Ride Smart. Go Further.

E-hailing, delivery and premium travel, owned by the people who drive it (Drivers Owned Platform).

**Brand:** Midnight Navy `#071B3A` · Dynamic Orange `#FF6B00` · White · Light Grey `#F5F7FA` · Manrope + Inter.
Live brand guidelines at **`/brand`**; see `docs/BRAND.md`. App plan: `docs/APPS-ROADMAP.md`.
**DROP is a division of VINK Group (Pty) Ltd, registration number 2018/079316/07.**

```
frontend/   React 19 + Vite + Tailwind v4 (from the Figma Make export); /brand guidelines page
backend/    Node.js + Express API, JSON-file datastore, document uploads
brand/      Logo system (SVG + PNG) and the generator script
docs/       Brand guide and apps roadmap
```

## What works

| Area | Features |
|---|---|
| Passengers | Sign up / sign in, upfront fare estimates, book Ride / Delivery / Premium Drive (now or scheduled), live trip status, share trip, SOS (10111), cancel, rate driver, trip history, saved places, payment preference, support tickets |
| Drivers | Two-step application with ID, licence and vehicle documents (PDF/JPG/PNG, 5 MB), application tracking, go online once approved, accept requests, trip status updates (arriving → on trip → complete), earnings dashboard, release trip |
| Business | Business accounts, bookings for travellers, team list, monthly invoices from completed trips, business-account payment |
| Verification (KYC) | Everyone uploads ID and proof of address; drivers add a selfie with ID, driving licence, PrDP, vehicle registration and insurance; businesses add CIPC registration. SA ID numbers are checked, files are content-checked and encrypted at rest, and each document is approved or rejected with a reason. Expiry tracking and reminders. See `docs/VERIFICATION.md` |
| Compliance officer | Verification queue, side-by-side document review, approve/reject with reasons, final decision, expiring documents, audit log |
| Support agent | Tickets, enquiries, user and trip look-up (no access to ID documents) |
| Payments & DROP card | Passenger card payments via Paystack into the pool account; trip earnings settle to driver wallets on completion; DROP Driver Card issued through Paymentology (Sprint Companion API) that spends from the wallet; withdrawals by EFT; double-entry ledger. See `docs/PAYMENTS.md` |
| Finance officer | Pool/escrow/wallet balances, payouts with bank payment file, cards, card transactions, ledger, reconciliation |
| Super Admin | Approve / decline driver applications, view uploaded documents securely, manage users and drivers (suspend / reinstate), all bookings, support tickets with replies, website enquiries |
| Public | Contact / business / careers / report-an-issue forms, live fee table, safety, privacy and terms summaries |

Pricing: **R0 passenger platform commission.** Drivers keep the fare less one disclosed service fee (`DRIVER_SERVICE_FEE_RATE`, default 10%).
Tariffs live in `backend/src/pricing.js` and are **launch placeholders, so confirm them before going live.**

## Demo dashboards

With `DEMO_MODE=true`, the sign-in screen, the header ("Try the demo") and the footer offer one-click logins for every dashboard, with sample trips, verifications, wallet and card activity, tickets and payouts:

| Demo | What it shows |
|---|---|
| Passenger | Verified account, 7 past trips, saved places, a support ticket |
| Driver | Wallet balance, DROP card (sandbox) with fuel/parking spend and a declined purchase, withdrawals, PrDP expiry reminder |
| Business | Company trips on the business account, 3 team members, invoices |
| Super Admin | Everything, including finance and staff |
| Compliance | A driver waiting for review, a passenger with a rejected document, an expiring PrDP |
| Support | Open, in-progress and urgent safety tickets, website enquiries |
| Finance | Pool and wallet balances, a withdrawal waiting to be paid, card transactions, ledger |

Demo accounts (`@demo.drop.co.za`) have no usable password and stop working as soon as demo mode is off. **Set `DEMO_MODE=false` before launch**: the demo staff accounts can see real customer data.

## Run locally

```bash
npm run install:all
cp backend/.env.example backend/.env      # set ADMIN_EMAIL / ADMIN_PASSWORD, and DATA_DIR=./data for local use
npm run dev:api                           # API on :4000
npm run dev:web                           # site on :5173 (proxies /api)
npm test                                  # end-to-end API test
```

## Deploy on Railway (one service)

The Express server serves the built site and the API from one service.

1. New project → deploy from this GitHub repo (root directory `/`). `railway.json` sets `npm run build` / `npm start`.
2. **Attach a volume** mounted at `/data` (it holds the database and driver documents).
3. Variables: `NODE_ENV=production`, `JWT_SECRET`, `FILE_ENCRYPTION_KEY`, `DATA_DIR=/data`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, optional `PASSENGER_VERIFICATION`, optional `DRIVER_SERVICE_FEE_RATE`, `CONTACT_EMAIL`.
4. Generate a domain. Health check: `/api/health`.

To host the frontend separately, build it with `VITE_API_URL=https://your-api-domain` and set `CORS_ORIGINS` on the API.

## Motion system

`frontend/src/motion/` with keyframes in `src/index.css`. It includes a first-visit brand intro, a staggered hero headline reveal, drifting gradient orbs, a slow Ken Burns hero image, scroll parallax, scroll-reveal (`data-reveal`, `data-reveal-stagger`), count-up figures, a values marquee, magnetic buttons, 3D tilt service cards, a cursor spotlight on dark panels, a scroll-spy nav indicator, a header scroll-progress bar, a back-to-top progress ring, an animated mobile menu and dialog/step transitions.
Everything uses transform and opacity only. Motion is lighter on phones and switched off for `prefers-reduced-motion`. Content never depends on JavaScript to be visible.

## API overview

`POST /api/auth/register|login` · `GET|PATCH /api/auth/me` · `POST /api/fares/estimate` · `GET /api/places` · `GET /api/services`
`POST|GET /api/bookings` · `GET /api/bookings/:id` · `POST /api/bookings/:id/cancel|rate`
`POST /api/drivers/apply` (multipart) · `GET /api/drivers/application` · `POST /api/drivers/online` · `GET /api/drivers/requests` · `POST /api/drivers/bookings/:id/accept|advance`
`POST|GET /api/support/tickets` · `POST /api/enquiries` · `GET|POST|DELETE /api/business/employees`
`GET /api/dashboard` · `GET /api/admin/{users,applications,bookings,tickets,enquiries}` · `PATCH` on each · `GET /api/admin/files/:name`

## Before launch

- Confirm tariffs and the driver service fee rate.
- Replace `hello@drop.co.za` (placeholder) with the real contact address in `frontend/src/lib/company.ts` and `CONTACT_EMAIL`.
- Have the full terms, privacy policy and driver agreement reviewed (the site shows summaries).
- Maps are a stylised illustration. Real routing and geocoding need a maps provider (e.g. Google Maps). Card payments need a payment gateway (e.g. Paystack, Peach). Neither is connected.
