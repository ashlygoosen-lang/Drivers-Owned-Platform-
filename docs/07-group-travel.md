# 07 · Group travel (flights and coaches)

**For:** Vincent Kafula, VINK Group (Pty) Ltd · **Date:** 25 November 2026

Customers join a group on a route and date. When enough travellers have paid, DROP books the whole group with the airline or coach operator (the **partner**) at a bulk rate and sends everyone their tickets. If the group doesn't reach its minimum by the fill deadline, everyone is refunded (or offered another date).

Where it lives:

| Part | Files |
|---|---|
| Rules (statuses, seats, amounts, encryption) | `backend/src/travel.js` |
| Payments, refunds, cancellations, transfers, confirmation | `backend/src/travelService.js`, `backend/src/money/travel.js` |
| API | `backend/src/routes/travel.js` (Paystack verify and webhook in `routes/money.js`) |
| Scheduled jobs | `backend/src/travelJobs.js` (every minute, on the leader server) |
| Website | `frontend/src/travel/GroupTravel.tsx` (public page `/group-travel` and My DROP → Group travel), `frontend/src/travel/TravelAdmin.tsx` (staff console) |
| Passenger app | `mobile/apps/passenger/app/(tabs)/travel.tsx`, `app/travel/*`, helpers in `mobile/packages/shared/src/lib/travel.ts` |
| Tests | `backend/test/travel.test.js`, `backend/test/scale/concurrency.test.js` (two-server race), `mobile/packages/shared/__tests__/travel.test.ts` |
| Legal | Cancellation and Refund Policy §3, Fees §4, Privacy Policy (group travellers), Terms §1 |

## 1. How a trip works

1. **Admin sets up a partner and a route.** A route carries the terms new groups open with: seats per group, minimum to confirm (default 70%), the partner's bulk rate per seat, the price per person (never below the bulk rate), fill deadline (default 21 days before departure for flights, 3 for coaches), deposit % (default 30), cancellation fees, and what happens if the group doesn't fill (refund, or offer another date). Changing a route never changes groups that are already open.
2. **A customer searches and joins.** Joining reserves seats and creates a booking that is **held for 30 minutes** while they pay by card (Paystack). If no group exists for that route and date, one opens. If the group is full, an **overflow group** opens (`sequence` 2, 3, …).
3. **The group fills.** Seats count once paid. Members are told at 50%, 75% and 100%, and when the minimum is reached.
4. **At the fill deadline** the group closes to new travellers. Below the minimum, it is cancelled and the failure policy applies. Otherwise members are told the trip is going ahead.
5. **Admin confirms with the partner.** Book the seats with the partner using the manifest, then enter the partner's reference. This releases the group's escrow (see §3).
6. **Admin pays the partner** (recorded with the EFT reference) **and adds ticket numbers.** When every traveller has a ticket number the group becomes `TICKETED` and each customer is emailed and pushed their tickets.
7. The day after travel the group becomes `COMPLETED`.

## 2. Statuses

**Group:** `OPEN` → `MINIMUM_REACHED` → (`FULL`) → `CONFIRMED_WITH_PARTNER` → `TICKETED` → `COMPLETED`, or `CANCELLED` at any point before tickets.

**Booking:** `held` → `deposit_paid` or `paid` → `ticketed` → `completed`. Also `expired` (hold ran out), `cancelled`, `transfer_offered` (group failed, customer may move) and `refunded`.

## 3. Money

All amounts are in rand and stored in cents. Every movement is a balanced double-entry posting in the ledger.

| Event | Ledger |
|---|---|
| Customer pays (deposit, full or balance) | Paystack pool → `travel_escrow:<group>` |
| Refund | `travel_escrow:<group>` → Paystack pool |
| Cancellation fee kept | `travel_escrow:<group>` → `travel_fees` |
| Customer moves to another group | `travel_escrow:<from>` → `travel_escrow:<to>` (any price difference refunded) |
| Admin confirms the group | `travel_escrow:<group>` → `partner_payable:<partner>` (bulk rate × seats) and `travel_margin` (the rest) |
| Admin records a partner payment | `partner_payable:<partner>` → Paystack pool |

So for every group: **paid = refunded + fees + partner cost + margin**, and the escrow is zero once a group is confirmed or cancelled. A "balance" payment to a partner cannot exceed what the group still owes them. A "deposit" payment (money VINK pays a partner to hold seats before confirmation) is allowed and shows as a negative amount owed until the group is confirmed.

Charges are in **rand only** (Paystack South Africa settles in ZAR). The dollar amounts shown are estimates using `TRAVEL_USD_ZAR`.

**Cancellation fees (defaults, per route):** 0% before the fill deadline, 50% after it, 100% once ticketed. Unpaid holds cost nothing. Admins can waive the fee when cancelling a booking for a customer.

## 4. Scheduled jobs (every minute, leader server only)

| Job | What it does |
|---|---|
| Holds | Unpaid holds older than `TRAVEL_HOLD_MINUTES` expire; the seats go back |
| Reminders | Deadline approaching (7 and 2 days, groups still filling); balance due (14, 7 and 2 days). Each sent once |
| Balances | A deposit whose balance is unpaid `TRAVEL_BALANCE_GRACE_HOURS` after it was due is cancelled under the policy |
| Deadline | Closes groups at the fill deadline; below the minimum → refund everyone, or offer another date |
| Transfers | Move offers not taken within `TRAVEL_TRANSFER_OFFER_DAYS` are refunded |
| Refund retries | Failed Paystack refunds are retried every 30 minutes; after 4 failures a high-severity security event is raised |
| Complete | Ticketed groups become completed the day after travel |

## 5. Settings

| Variable | Default | Purpose |
|---|---|---|
| `TRAVEL_USD_ZAR` | none (dollar estimates hidden) | Rand per US dollar for the estimates. Set it, e.g. `18.20`, and update it from time to time |
| `TRAVEL_HOLD_MINUTES` | `30` | How long seats are held while the customer pays |
| `TRAVEL_BALANCE_GRACE_HOURS` | `48` | Grace after the balance due date before an unpaid booking is cancelled |
| `TRAVEL_TRANSFER_OFFER_DAYS` | `7` | How long customers have to accept a move to another date |
| `PAYSTACK_SECRET_KEY` | — | Required; joining is refused when card payments are off |

## 6. No overbooking

Two database rules make it impossible to sell more seats than a group has, however many people book at once and on however many servers:

- **One joinable group per route and date:** a unique index on `groupKey` for groups that are `OPEN` or `MINIMUM_REACHED`, plus a unique `(groupKey, sequence)` index for overflow groups.
- **Seats are taken with one conditional update** (`db.adjustStrict`): it only succeeds while `seatsTaken + n ≤ capacity` and the group is still joinable. When it fails the group is closed as `FULL` and the next overflow group is tried.

Verified by `travel.test.js` (8 people racing for 5 seats → 5 + 3 in an overflow group) and the two-server test (40 travellers on two servers racing for a 25-seat coach → 25 + 15, every booking stored).

## 7. Personal information (POPIA)

- **Passport numbers are encrypted** (AES-256-GCM) before they are stored. Customers only ever see the last four digits.
- **They are decrypted in one place only:** the passenger manifest (CSV or printable page), available to **admin and support**, who must enter a fresh authenticator code first (valid 5 minutes). Every export is written to the tamper-evident audit log (`travel.manifest_exported`) and the files are sent with `Cache-Control: no-store`. Share a manifest only with the partner for that group.
- **Travellers under 18** need the name, relationship and consent of a parent or guardian (POPIA s 35), recorded with the time of consent.
- Staff roles: **admin** changes everything; **support** can view, export manifests, add tickets and cancel bookings; **finance** can view.
- Audited staff actions: partner and route changes, group created, confirmed, cancelled, partner paid, tickets added, bookings cancelled, manifests exported.

## 8. Running it day to day (staff console: My DROP → Group travel)

- **Every morning:** check the red **At risk** list (deadline within 7 days, below minimum). Promote those trips, or decide to cancel early.
- **Ready to confirm:** groups past their deadline that reached the minimum. Wait until no booking still owes a balance, book with the partner, then enter their reference.
- **After confirmation:** record the partner payment with the EFT reference, then enter ticket numbers and seats. Saving the last ticket notifies everyone.
- **Demand:** routes customers searched for that you don't run. Use it when negotiating new routes with partners.
- **Reports:** revenue, partner cost, profit and cancellation fees by month, route or partner.

## 9. Before going live

1. Set `TRAVEL_USD_ZAR`.
2. Sign written group agreements with each partner (bulk rate, payment terms, name-change and cancellation rules), and record them in the partner's notes.
3. Have a South African attorney review the group travel sections of the Terms, Cancellation and Refund Policy, Fees and Privacy Policy. Check whether DROP needs to be a registered travel agent or hold IATA accreditation to resell air tickets, or whether partners must issue the tickets directly.
4. Decide who at VINK confirms groups and pays partners, and give only them the admin role.

## 10. Testing it

```bash
cd backend && STAFF_MFA=off node --test test/travel.test.js          # 7 tests, file mode
PGHOST=/tmp/pgsock PGPORT=5433 PGUSER=drop REDIS_URL=redis://127.0.0.1:6380 scripts/test-postgres.sh   # includes travel on PostgreSQL
SCALE_DATABASE_URL=... SCALE_REDIS_URL=... node --test test/scale/concurrency.test.js   # two-server race
cd mobile && npx jest                                                # shared helpers
```
