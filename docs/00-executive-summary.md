# 00 · Executive summary: DROP security, mobile apps and scale

**For:** Vincent Kafula, VINK Group (Pty) Ltd · **Date:** 25 November 2026 · **Repository:** `ashlygoosen-lang/Drivers-Owned-Platform-` (branch `main`)

## In one paragraph

DROP started this programme as a single-server website with one Critical and six High security problems, no mobile apps, and a design that would have double-booked trips the moment a second server was added. It now has an audited defence system, two native apps (DROP and DROP Driver), and a backend that runs on any number of servers with double bookings, double charges and lost payments blocked by the database itself. Every Critical and High finding is fixed in code. **What remains is mostly configuration that only you can do:** keys, accounts and managed services, listed in priority order in §5. Until you do them, the live site keeps running exactly as it does today.

## 1. Where DROP stands

| Area | Before | Now |
|---|---|---|
| Security findings | 24 found: 1 Critical, 6 High, 12 Medium, 5 Low | Critical and High: **all fixed**. Medium: 10 fixed, 2 waiting on you. Low: 1 fixed, 1 partly, 2 open, 1 accepted |
| Staff accounts | Demo staff logins could see real customers; no MFA | Demo data isolated; MFA compulsory for all staff; lockouts; breached-password check |
| Sessions | 7-day tokens that survived logout | 15-minute tokens, rotating refresh cookie with theft detection, sign out everywhere |
| Sensitive data | ID numbers in plain text; no backups | ID, bank and MFA secrets encrypted; encrypted off-site backups; tamper-evident audit log |
| Monitoring | None | Security events, alerts, structured logs, incident-response plan |
| CI | None | Tests, dependency and secret scans, Semgrep, CodeQL, mobile checks, multi-server race tests, DAST workflow |
| Mobile | Web only | DROP and DROP Driver (React Native / Expo): booking, payment, live map, chat, calls, push, background GPS, app attestation, certificate pinning |
| Scale | One server, one JSON file | Many servers, PostgreSQL + Redis, race-safe booking, idempotency keys, reconciler, graceful deploys |

Detail: [01 inventory](01-system-inventory.md) · [02 threat model](02-threat-model.md) · [03 findings](03-security-findings.md) · [04 defence](04-defence-system.md) · [05 mobile](05-mobile-apps.md) · [06 scalability](06-scalability-architecture.md) · [incident response](incident-response.md)

## 2. How this was verified (Phase 7, 25 Nov 2026)

| Check | Result |
|---|---|
| Backend test suite, file mode (`npm test`) | 23 / 23 pass |
| Same suite on PostgreSQL + Redis (`scripts/test-postgres.sh`) | 8 / 8 files pass |
| Races across two real servers: 300 drivers accepting one trip, double taps, one trip per passenger and per driver, cross-server events, unique refs | 7 / 7 pass |
| Mobile unit tests and type-checks; website type-check and build | Pass |
| Load test, full ride lifecycle on a 2-core machine | ~1,375 requests/s, 0 errors, 0 duplicate bookings, ledger balanced. One real lost-update bug found and fixed (06 §3.1) |
| Secret scan of the whole git history (gitleaks, 41 commits) | No secrets found. **No keys need rotating** |
| Dependency audit (runtime) | Backend 0 and website 0 issues. Apps: 4 moderate in Expo build tooling only, not shipped in the apps; accepted with an expiry date of 31 Jan 2027 |
| Live checks on a production-configured server | Security headers (CSP, HSTS, frame, nosniff, referrer, permissions) present; no CORS for foreign sites; every protected route rejects missing and forged tokens; staff login forces MFA setup; sign-in blocked after 5 wrong passwords; oversized bodies rejected; demo logins disabled; no secrets or stack traces in logs |
| GitHub CI on `main` | All 7 jobs green |

Fixed during Phase 7:
- **SEC-021:** the server now ignores driver GPS that reports or implies more than 250 km/h. It recovers from genuine glitches and alerts operations after repeated jumps.
- **SEC-010:** the API accepts booking IDs only, so sequential references can't be used to probe for other bookings.
- **Indexed lookups:** about 50 hot-path lookups now go straight to the record instead of scanning every user or booking.

**Not verified here, because it needs your accounts:**
- Cloudflare and Turnstile in front of the real domain
- Real Paystack, Twilio and Resend traffic
- App-store builds signed with your keys
- Play Integrity and App Attest against Google and Apple
- The ZAP and k6 runs against staging

These are the first things to run once §5 items 1–8 are done.

## 3. Decisions waiting on you

1. **Phone calls (SEC-016).** Without Twilio, the call button shows real phone numbers to the other party. Choose Twilio masked numbers (per-minute call charges plus a monthly number rental; check Twilio's South African pricing) or accept direct numbers. Recommendation: Twilio before public launch.
2. **Maps key (SEC-022).** In Google Cloud, restrict the browser key to your domains and the Maps JavaScript API, and set a daily quota.
3. **Legal.** Have the privacy notice and terms reviewed, and register the Information Officer with the Information Regulator (POPIA).

## 4. Remaining risks (honest view)

| Risk | Level | What to do |
|---|---|---|
| Owner configuration not done (secrets, demo mode, backups, MFA on GitHub) | **High until done** | §5 items 1–4: about an hour of work, mostly free |
| Memory ceiling at sustained peak volume: each server keeps all records in memory | Medium (weeks away at target load) | Phase 6B-1 hot-data window, before sustained national volume |
| ~~Every open request shown to every driver~~ | Fixed 25 Nov | Proximity dispatch built: 100 % of trips matched vs 64 %, 60 % fewer wasted accepts (06 §5) |
| CSP allows broad Google script sources (SEC-015) | Low | Move to Google's nonce-based strict CSP |
| Staff start with an admin-chosen password (SEC-020) | Low (MFA required anyway) | Invite link with set-your-own password |
| Payout CSV holds bank numbers (SEC-023) | Low (staff MFA and audit log) | Ask for an MFA code again at export |
| Sign-up reveals whether an email exists (SEC-018) | Low, accepted | Lockout and Turnstile limit abuse |

## 5. Your checklist, in order

| # | Action | Cost (approx.) |
|---|---|---|
| 1 | On Railway: `DEMO_MODE=false`, plus strong random `JWT_SECRET`, `FILE_ENCRYPTION_KEY` and `BACKUP_KEY` | free |
| 2 | GitHub: 2FA for everyone, then branch protection on `main` requiring the CI checks | free |
| 3 | Bucket plus `BACKUP_S3_*` for encrypted off-site backups | cents a month |
| 4 | Give me access to the DROP Railway project, so I can create **staging** | ~$5/month |
| 5 | Railway PostgreSQL and Redis, then `DATABASE_URL` and `REDIS_URL`. **Run `npm run backup` first.** Then run 2 servers | ~$10–25/month to start |
| 6 | Cloudflare in front of the domain, Turnstile keys, then `TRUST_PROXY=2` | free (Pro $20/month optional) |
| 7 | `RESEND_API_KEY` (receipts, password reset), `ALERT_WEBHOOK_URL`, uptime monitor, optional Sentry | free tiers |
| 8 | Twilio decision (§3.1) and the Maps key restriction (§3.2) | per use |
| 9 | Apple Developer ($99/year) and Google Play ($25 once) in VINK Group's name, then the release steps in [05](05-mobile-apps.md#release-owner-checklist) | as listed |
| 10 | Run the ZAP and k6 tests on staging, then scale servers in steps | staging time |

Prices are estimates from the providers' published plans and change; check them before you commit.

## 6. Recommended next work

1. **Phase 6B-1 and 6B-2:** hot-data window and proximity dispatch. These two items unlock sustained target load and remove most peak traffic.
2. **Low findings:** SEC-015, SEC-020 and SEC-023, about a day together.
3. **Push instead of polling** in the apps, an outbox for emails and payments, and circuit breakers on external providers (06 §5).
4. **After launch:** a quarterly re-run of this review (findings register, threat model, dependency audit) and a yearly external penetration test.
