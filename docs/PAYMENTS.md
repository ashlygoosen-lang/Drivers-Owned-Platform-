# DROP payments, wallets and the DROP Driver Card

## Money flow

```
Passenger card ──Paystack──▶ POOL bank account ──(held in escrow until the trip is done)
                                   │
                    trip completed │  fare − DROP fee ─▶ driver WALLET      DROP fee ─▶ FEES
                                   │
      driver swipes DROP card ─────┤  Paymentology asks DROP (Remote API "Deduct") ─▶ approve if wallet balance covers it
                                   │
      driver withdraws ────────────┘  wallet ─▶ payouts pending ─▶ EFT from pool to driver's bank
```

- **Card trips:** the passenger pays upfront (Paystack checkout). The money sits in escrow until the driver completes the trip, then the fare less the disclosed service fee moves to the driver's wallet. Cancelled before pickup = automatic refund.
- **Cash trips:** the driver keeps the cash; only the DROP service fee is taken from the wallet (which can go negative up to `CASH_DEBT_LIMIT`).
- **Business-account trips:** the driver is credited on completion; the company pays DROP on invoice (recorded under Finance → Record a bank movement).
- **DROP Driver Card:** spends directly from the wallet. Fuel, tolls, parking, repairs and everyday expenses; gambling merchant codes are blocked; per-purchase and daily limits.
- **Withdrawals:** drivers withdraw any available balance to their own bank account. Finance downloads a bank payment file, pays from the pool account, and marks each payout paid with the bank reference.

Everything is recorded in a **double-entry ledger** (`backend/src/money/ledger.js`). The Finance tab shows whether the books balance, and the pool balance there should equal the real pool bank statement.

## Paymentology integration (Sprint Companion API)

DROP uses the **Companion API** model: DROP holds the balances and authorises every card transaction in real time.

| Direction | Methods implemented | Code |
|---|---|---|
| DROP → Paymentology (Local API) | `CreateLinkedCardMaskedResponse`, `StopCard` (freeze = reason 3 "pending query"; lost 1, stolen 2, fraud 7), `UnstopCard` | `money/paymentology/client.js` |
| Paymentology → DROP (Remote API, `POST /api/paymentology/remote`) | `Balance`, `Deduct`, `DeductReversal`, `DeductAdjustment`, `Stop`, `AdministrativeMessage`; all others answer `-41` (not supported) | `money/paymentology/remote.js` |

- Messages are XML-RPC (`methodCall` / `methodResponse` structs), amounts in cents, transaction data in KLV (MCC = key `026`, capture mode = key `250`).
- Every inbound call is checked for the right terminal ID and a valid **HMAC checksum** keyed with the terminal password, and optionally the source IP (`PAYMENTOLOGY_ALLOWED_IPS`).
- Identical retransmissions (same method, reference, transaction ID and date) get the original answer and never move money twice.
- Declines use Paymentology result codes: `-17` insufficient funds, `-18` over limit, `-29` card not active, `-38/-39` lost/stolen, `-784` purchase type not allowed, `-24` security violation.
- The masked-response card creation call is used so **full card numbers and CVVs never reach DROP** (keeps DROP out of PCI DSS cardholder-data scope). How cardholders see full card details or set a PIN is defined by your Paymentology programme (e.g. physical card mailer, Paymentology-hosted card display).

### Modes
- `PAYMENTOLOGY_MODE=off`: card features hidden; wallets and withdrawals still work.
- `sandbox`: cards are issued locally as clearly-labelled test cards; Finance → Cards has a simulator that sends correctly signed Remote API messages through the production code path.
- `live`: real Local API calls to `PAYMENTOLOGY_LOCAL_API_URL` with your terminal ID and password.

### To confirm with Paymentology during UAT (cannot be completed from public docs)
1. **Checksum string**: their docs describe HMAC-SHA256 of the method name concatenated with all argument values, keyed with the terminal password, but the published example is 40 hex characters. Run their **Checksum Generator** against `checksum()` in `money/paymentology/config.js`; algorithm and letter case are configurable (`PAYMENTOLOGY_CHECKSUM_ALGO`, `PAYMENTOLOGY_CHECKSUM_CASE`).
2. **Endpoints**: Local API URLs (UAT and production) and the Remote API URL to register: `https://<your-domain>/api/paymentology/remote`.
3. **Source IPs** for the allowlist, and the Remote API timeout.
4. **Programme details**: BIN sponsor / issuing bank, card network, physical card ordering (`OrderCard`), PIN delivery, and whether ATM withdrawals are allowed (`CARD_ALLOW_ATM`).
5. **Settlement**: how and when DROP pays card spend to the scheme (recorded with Finance → Record a bank movement → card scheme settlement).

## Paystack (passenger card payments)
- `POST /transaction/initialize` → passenger is sent to Paystack's secure checkout → returns to `/?payment_ref=…` → DROP verifies with `GET /transaction/verify/:reference` (amount and currency are checked against the booking).
- Webhook `POST /api/payments/paystack/webhook` (set this URL in the Paystack dashboard) verified with the `x-paystack-signature` HMAC-SHA512.
- Refunds via `POST /refund` when a paid trip is cancelled before pickup. If Paystack is unreachable the booking is flagged `refund_pending` for Finance.
- Paystack settles to the bank account on the DROP merchant profile: make that the pool account.

## Before going live: business and legal
- Holding passenger money and driver balances, and issuing cards, is regulated in South Africa. Expect to need: an **issuing/sponsor bank** (via Paymentology), a **ring-fenced pool or trust account** with that bank, compliance with **FICA** (KYC already built), the **SARB / Prudential Authority** position on e-money/stored value, **PASA** rules for payment system participation, and **PCI DSS** (reduced scope thanks to masked card data). Get legal advice before launch.
- Decide refund, chargeback and dispute processes with Paystack and Paymentology.

## API
Driver: `GET /api/wallet` · `PUT /api/wallet/bank-account` · `POST /api/wallet/withdrawals` · `POST /api/wallet/card` · `POST /api/wallet/card/freeze|unfreeze|report`
Passenger: `GET /api/payments/config` · `POST /api/payments/bookings/:id/checkout` · `GET /api/payments/verify/:reference`
Finance (Super Admin, finance officer): `GET /api/finance/overview` · `GET /api/finance/withdrawals` · `GET /api/finance/withdrawals.csv` · `POST /api/finance/withdrawals/:id/paid|reject` · `GET /api/finance/ledger?account=` · `GET /api/finance/journal.csv` · `GET /api/finance/cards` · `GET /api/finance/card-transactions` · `POST /api/finance/cards/:id/stop` · `POST /api/finance/reconcile` · `POST /api/finance/simulate-card` (sandbox)
Providers: `POST /api/paymentology/remote` (XML-RPC) · `POST /api/payments/paystack/webhook`
