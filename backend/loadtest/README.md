# DROP load tests

Never point these at production or at real user data.

## Local (Node, no extra tools)

Starts real DROP servers on a **throwaway** PostgreSQL database and Redis, seeds test drivers and
passengers, runs the full ride lifecycle and checks correctness straight in the database.

```bash
createdb drop_load           # a database you can throw away — the runner drops its tables
LOAD_DATABASE_URL=postgresql://localhost/drop_load LOAD_REDIS_URL=redis://localhost:6379 \
  node loadtest/run.js --instances 2 --rate 33 --duration 60 --drivers 600
```

`--rate` is bookings per second (33 ≈ 2,000 per minute). The report shows bookings created and
completed, p50/p95/p99 per endpoint, status codes, and the correctness checks: duplicate references,
drivers with two active trips, completed trips without settlement, ledger balance.
Results from 25 Nov 2026 are in `results/`; see `docs/06-scalability-architecture.md` §3.1.

## Staging (k6)

1. Seed staging with test accounts and export their tokens to `tokens.json`
   (`{ "passengers": [...], "drivers": [...] }`) — e.g. with `seed()` from `test/scale/fixture.js`
   pointed at the **staging** database. Keep `tokens.json` out of git.
2. Run:

```bash
k6 run -e BASE=https://<staging-host>/api -e TOKENS=tokens.json loadtest/k6/booking-flow.js   # ramp + 20 min at target
k6 run -e BASE=... -e TOKENS=tokens.json loadtest/k6/spike.js                              # 10× for 2 minutes
k6 run -e BASE=... -e TOKENS=tokens.json loadtest/k6/soak.js                               # 4 hours
```

Staging rate limits and Cloudflare bot rules will block a load test unless the test's source IP
is allow-listed for the duration of the run. Remove the allow-list afterwards.
