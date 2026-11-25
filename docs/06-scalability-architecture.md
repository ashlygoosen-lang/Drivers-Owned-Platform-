# 06 — Scalability architecture

**Target agreed with the owner:** 50,000 concurrent users and 2,000 bookings per minute at peak, with **no double bookings, no double charges and no lost money movements**, on managed services that start small and grow.

This document describes what was built in Phase 6, how it was tested, what the numbers mean, and what must happen before DROP sustains the target for weeks (Phase 6B).

---

## 1. Before and after

| | Before Phase 6 | After Phase 6 |
|---|---|---|
| Data | One JSON file, rewritten on every change | PostgreSQL (`DATABASE_URL`), with the JSON file kept for local development |
| Servers | Exactly one (two servers would corrupt the file) | Any number of identical servers behind Railway's load balancer |
| Double booking guard | In-memory check: safe only with one server | Enforced by PostgreSQL unique indexes and conditional updates |
| Rate limits, lockouts, sessions-in-flight | Per server memory | Redis, shared by every server |
| Live events (chat, trip status, calls) | Only to users on the same server | Redis pub/sub fans out to every server |
| Driver locations | Written to the database every fix | Redis hash; database copy at most once a minute per driver |
| Background jobs | Ran on the single server | One elected leader runs them; another takes over within 30 s if it dies |
| Retries / double taps | Could create two bookings or two withdrawals | `Idempotency-Key` on booking, checkout and withdrawal (server + both apps + website) |
| Deploys | Restart dropped live connections | Graceful drain: `/api/ready` turns 503, in-flight requests finish, then exit |

Without `DATABASE_URL` and `REDIS_URL` the backend runs exactly as before (single server, JSON file), so nothing breaks for local development or the current deployment until the owner adds the managed services.

## 2. Architecture

```
                         Cloudflare (WAF, Turnstile, DDoS)               ← docs/04
                                     │
                          Railway load balancer
              ┌──────────────┬───────┴───────┬──────────────┐
          DROP server    DROP server     DROP server     … (N replicas, identical, stateless)
              │  ▲            │  ▲            │  ▲
              │  └── Redis pub/sub: live events, presence, tickets, rate limits, locks,
              │      idempotency keys, driver locations, leader lease
              ▼
          PostgreSQL ─ drop_docs (jsonb) + unique indexes + drop_seq change feed
                       LISTEN/NOTIFY → other servers catch up within milliseconds
```

### 2.1 How a booking stays single

| Rule | Where it is enforced |
|---|---|
| A passenger has at most one open trip | Unique partial index `drop_one_open_trip` on `openSlot` while status is awaiting_payment…in_progress |
| A driver has at most one active trip | Unique partial index `drop_one_active_trip` on `driverId` while accepted/arriving/in_progress |
| Only one driver wins a request | `UPDATE … WHERE status = 'requested' AND driverId IS NULL` (`bookingState.transition`) — PostgreSQL decides, the losers get 409 |
| Every status change is legal | `bookingState.js` transition table; each change is conditional on the previous status, so a double tap moves one step |
| A retried "Book" creates one trip | `Idempotency-Key` stored in Redis (24 h) **and** unique index `drop_booking_idem` in PostgreSQL |
| A payment is recorded once | `withLock('pay:<booking>')` + conditional update on `paymentStatus`; ledger entries have unique `key` |
| A wallet can't be withdrawn twice | `withLock('wallet:<user>')` + strongly consistent balance read from PostgreSQL |
| Booking references never collide | Per-server blocks of 200 numbers reserved atomically from `drop_counters` |

### 2.2 Safety net: the reconciler

Every minute the leader runs `src/reconcile.js`:

* Unpaid card bookings older than 20 min → cancelled, slot released.
* Requests with no driver after 30 min → cancelled, refunded if paid, passenger notified.
* Failed refunds → retried; alert after repeated failures.
* Completed trips missing their ledger settlement → settled (idempotent).
* Trips stuck in progress → alert to operations.

## 3. Tests

| Suite | What it proves | Result |
|---|---|---|
| `npm test` (file mode) | Existing behaviour unchanged | 22/22 pass |
| `scripts/test-postgres.sh` | The whole API suite on PostgreSQL + Redis | 8/8 files pass |
| `test/scale/concurrency.test.js` (2 real servers) | 300 drivers accept one trip → exactly 1 wins; one driver racing 20 trips → gets 1; 100 identical idempotent requests → 1 booking; 50 attempts at a second open trip → 1 succeeds; double-tapped advance → 1 step; booking made on server A is visible and live on server B; refs never collide | 7/7, three runs in a row |
| CI job `scale` | Runs the two suites above on every push | Added |
| Mobile `api.test.ts` | Apps send one idempotency key per action and reuse it on retry | Pass |

### 3.1 Load test (`backend/loadtest/run.js`)

Full ride lifecycle against **2 servers + PostgreSQL + Redis + the load generator all on one 2-vCPU, 8 GB machine** (so every component competes for the same two cores — a deliberately harsh setup). Drivers poll for requests, accept, advance three times and send GPS every 4 s; passengers get a fare, book with an idempotency key and poll until complete.

| Run | Offered | Requests/s | p95 (book) | p95 (accept) | p95 (GPS) | Errors | Correctness |
|---|---|---|---|---|---|---|---|
| 600 bookings/min, 300 drivers | 398 in 45 s, all completed | ≈ 900 | 369 ms | 290 ms | 309 ms | 0 | ✅ |
| 2,000/min target, 600 drivers | 1,047/min (generator saturated the CPU) | ≈ 1,375 | 965 ms | 934 ms | 797 ms | 0 | ✅ |

Correctness after every run, checked directly in PostgreSQL: **0 duplicate references, 0 drivers with two active trips, 0 completed trips without settlement, ledger debits = credits.**

**What the numbers mean.** Two cores ran out before the software did: ~1,375 requests/s with zero errors and every invariant intact. Latency rose because the CPU was full, not because of locks or the database. 92 % of the traffic in the test was drivers racing for trips somebody else had already taken, because every open request went to every driver. Proximity dispatch (6B-2, now built) fixes that.

**A real bug found and fixed by the load test.** In the first 2,000/min run, 35 completed trips had their ledger entry but lost the `settledAt` mark. Cause: while the write queue worked through a batch, records further down the batch could be overwritten by a catch-up from another server, and the queued change then wrote `null`. Fixed in `db.js` (queued changes now carry their own values; the whole batch is protected before writing). The rerun had 0 unsettled trips. The reconciler would also have repaired these within 2 minutes, without double-paying (ledger keys are unique).

### 3.2 Staging load tests (k6)

`backend/loadtest/k6/` — run **only against staging with seeded test accounts**, never production:

* `booking-flow.js` — ramp to 33 bookings/s (2,000/min) plus 800 drivers and 200 browse requests/s for 27 min. Pass criteria: p95 < 300 ms, p99 < 800 ms, < 1 % errors.
* `spike.js` — 10× arrival rate for 2 minutes (stadium emptying).
* `soak.js` — target load for 4 hours (memory leaks, slow degradation).

## 4. Capacity plan (starting small)

Node handles roughly 700–1,000 of DROP's requests per second per vCPU when it has the core to itself. The dominant load at the target is GPS: 10,000 online drivers × one fix per 4 s = 2,500 requests/s, plus bookings, polling/streams and the website.

| Stage | Traffic | DROP servers | PostgreSQL | Redis |
|---|---|---|---|---|
| Launch | < 500 concurrent | 1 × (1 vCPU, 1 GB) | 1 vCPU / 1 GB | 256 MB |
| City scale | ~5,000 concurrent, 200 bookings/min | 2 × (1 vCPU, 1 GB) | 2 vCPU / 4 GB | 512 MB |
| Target | 50,000 concurrent, 2,000 bookings/min | 6–8 × (1–2 vCPU, 2 GB) | 4 vCPU / 8 GB + read replica | 1–2 GB |

Always run at least **2 servers in production** so a deploy or crash never takes DROP down. Railway bills by actual CPU and memory used, so the extra replicas cost little when idle; check current Railway pricing before scaling up. Turn scaling up in steps and run the k6 test on staging at each step.

## 5. Phase 6B — required before sustaining the target for weeks

These are known limits, in priority order.

1. **Hot-data window (memory ceiling) — DONE (25 Nov 2026).** In PostgreSQL mode each server keeps only live and recent records in memory (`HOT_WINDOW_DAYS`, default 14, minimum 8). Finished trips, chat, notifications, calls and ledger entries older than that stay in PostgreSQL and are read with indexed SQL: trip history, dashboards and invoices, staff search, receipts, payment webhooks, ratings, notifications, statements and the journal export (`src/history.js`). Opening an old trip loads it back on demand. Anything the money jobs still need stays in memory: unsettled trips, pending refunds, and paid trips that were cancelled. Nothing is deleted. Eviction runs hourly; `/api/ready` shows what is in memory.
   - **Ledger, exactly.** Entries never change, so entries outside memory are summed once per account and balance = that sum + recent entries, in cents. An entry leaving memory moves into the sum. The leader re-checks every balance against PostgreSQL hourly; a difference seen in three checks in a row is reported (`ledger_mismatch`, high) and repaired from the database.
   - **Measured:** with 300,000 trips older than the window in PostgreSQL:

     | | Window on | Window off (before) |
     |---|---|---|
     | Server memory | **6 MB** | 2,055 MB |
     | Startup | 4.5 s | 15.6 s |
     | A passenger's trip history | 4 ms | 17 ms |
     | A driver's all-time totals | 11 ms | 23 ms |

   - **Two bugs found and fixed while building this.**
     - *Ledger totals (CPU).* Every ledger entry written by another server made each server re-add every entry it held, so the work grew with the square of traffic. New entries are now added to the totals directly.
     - *Change feed (correctness).* A write that committed after a later-numbered one could be missed by other servers for good. Missing sequence numbers are now tracked and fetched once they commit. `test/feed.test.js` fails on the old code and passes on the new.
   - Tests: `history.test.js`, `ledger-window.test.js`, `feed.test.js`. Final load test (both 6B changes, ~1,140 bookings/min): every trip completed, p95 under 120 ms on every booking endpoint, all correctness checks pass (`loadtest/results/2026-11-25-final-6b-1200pm.json`).
2. **Proximity dispatch — DONE (25 Nov 2026).** `src/dispatch.js` offers each request to the nearest 5 available drivers within 8 km, doubling the drivers and adding 5 km each minute, and falls back to every driver after 4 minutes. Requests are matched oldest first and a driver holds at most 2 offers, so clusters (malls, airports) spread out. Requests without coordinates, and drivers who share no GPS, keep the old behaviour. `DISPATCH_MODE=broadcast` switches it off; the other `DISPATCH_*` settings tune it. Side-by-side load test, same machine, ~1,100 bookings/min, drivers with human pacing:

   | | Broadcast (before) | Nearest (now) |
   |---|---|---|
   | Trips matched and completed in the window | 726 of 1,126 (64 %) | **1,105 of 1,105 (100 %)** |
   | Losing accept attempts | 20,801 (28 per match) | **8,358 (7.6 per match)** |
   | Correctness checks | all pass | all pass |

   Results: `backend/loadtest/results/2026-11-25-dispatch-*.json`. Tests: `test/dispatch.test.js`.
3. **Push instead of polling.** The apps already have the live event stream; switch the driver request feed and trip status to it so idle phones stop polling.
4. **Outbox for side effects.** Email, push and payment-provider calls go through a durable queue table so a crash between "trip completed" and "send receipt" can't drop the receipt.
5. **Circuit breakers and timeouts** on Paystack, Twilio, Resend and Google Maps so a slow provider can't tie up servers.
6. **Read replica** for admin dashboards and reports.
7. **Data retention jobs** — archive old GPS points and chat according to the privacy notice (POPIA).

## 6. Operating it

* **Turn it on:** add Railway PostgreSQL and Redis, set `DATABASE_URL` and `REDIS_URL`, deploy. On first start the server creates its tables (under an advisory lock, so several servers can start at once) and imports the existing JSON data once. **Take a backup first** (`npm run backup`); the JSON file is not deleted.
* **Health:** `/api/health` (process is up) and `/api/ready` (store, write queue, connection pool, Redis; 503 while draining — point the load balancer here).
* **Scale:** raise the replica count on Railway. No code changes are needed.
* **Rollback:** remove `DATABASE_URL` and `REDIS_URL` to return to single-server file mode. The data written to PostgreSQL in the meantime stays there and is not copied back automatically.
