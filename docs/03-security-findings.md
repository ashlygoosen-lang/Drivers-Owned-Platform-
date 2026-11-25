# 03 · Security findings: DROP

Audit against the OWASP Top 10 (2021, plus the 2025 draft categories), the OWASP API Security Top 10 (2023) and CIS basics. MASVS applies once the mobile apps exist (Phase 5).
Tested on a local copy with sandbox keys only. No live data was touched.
Every **Fixed** item has an automated test in `backend/test/security.test.js` (12 test files, all passing).

| ID | Severity | Title | Status |
|---|---|---|---|
| SEC-001 | **Critical** | Demo staff logins expose real customer data on a live site | Fixed |
| SEC-002 | High | Sessions can't be revoked (7-day tokens survive logout, password change, role change) | Fixed (refresh tokens → SEC-017) |
| SEC-003 | High | No multi-factor authentication for staff | Fixed |
| SEC-004 | High | Credential stuffing: no per-account lockout, breached passwords accepted, timing leak | Fixed (Turnstile built in Phase 4; needs keys) |
| SEC-005 | High | End-of-life upload library (multer 1.x) with denial-of-service bugs | Fixed |
| SEC-006 | High | A stolen session can redirect a driver's payouts instantly | Fixed |
| SEC-014 | High | No backups; the whole database is one file on one volume | Backups built (Phase 4); needs BACKUP_KEY and a bucket. Postgres in Phase 6 |
| SEC-007 | Medium | User objects leak secret fields (encrypted bank number, later MFA secret) | Fixed |
| SEC-008 | Medium | SA ID / passport numbers stored in plain text at rest | Fixed (Phase 4) |
| SEC-009 | Medium | No idempotency on booking creation (a double tap makes two bookings) | Open (Phase 6) |
| SEC-011 | Medium | No self-service password reset | Fixed (Phase 5; set RESEND_API_KEY to send the emails) |
| SEC-012 | Medium | Rate limits are in memory, per instance | Fixed (Phase 4; Redis when REDIS_URL is set) |
| SEC-013 | Medium | Audit log is not tamper-evident | Fixed (Phase 4) |
| SEC-016 | Medium | "Direct" phone mode shares real phone numbers during a trip | Needs owner decision |
| SEC-017 | Medium | Session token in `localStorage`; no refresh-token rotation | Fixed (Phase 4) |
| SEC-019 | Medium | No security checks in CI (SAST, secrets, dependency, DAST) | Fixed (Phase 4); turn on branch protection to enforce |
| SEC-021 | Medium | Driver GPS can be spoofed by a modified client | Mitigated (Phase 5): app attestation and plausibility checks on the server; speed/teleport checks still open |
| SEC-022 | Medium | Google Maps browser key must be referrer-restricted | Needs owner action |
| SEC-024 | Medium | AES-GCM decryption accepted shortened authentication tags (found by the new CI Semgrep gate) | Fixed (Phase 4) |
| SEC-010 | Low | Sequential booking refs accepted in place of UUIDs | Open |
| SEC-015 | Low | CSP script sources broader than needed (Google wildcards, `blob:`) | Open |
| SEC-018 | Low | Sign-up reveals whether an email is registered | Accepted for now |
| SEC-020 | Low | Staff accounts start with an admin-chosen password | Open |
| SEC-023 | Low | Withdrawals CSV holds decrypted bank numbers, with no step-up check at export time | Partly mitigated |

---

```
ID: SEC-001
Title: Demo staff logins expose real customer data on a live site
Severity: Critical. No authentication is needed, anyone on the internet can do it, and it gives full
  access to KYC documents, ID numbers, bank details and staff tools (CVSS-like 9.8: AV:N/AC:L/PR:N/UI:N).
Location: backend/src/demo.js (demoEnabled defaulted to on), routes/auth.js POST /api/auth/demo,
  routes/drivers.js (requests/accept), routes/bookings.js load()
Description: Demo mode was on by default in production so visitors could explore the dashboards. Demo
  accounts share the real database, so once real customers sign up, "Demo Super Admin" (one click, no
  password) can read and change everything real. A demo driver could also see and accept real
  passengers' trips.
Proof: POST /api/auth/demo {"role":"admin"}, then GET /api/admin/users returns real users. GET
  /api/compliance/verifications/:id returns their unmasked ID number and documents.
Fix: New demo policy (backend/src/demoPolicy.js):
  - With DEMO_MODE unset, demo switches itself off when the first real customer account exists.
  - Demo STAFF dashboards are refused whenever real users exist, even with DEMO_MODE=true.
  - Existing demo sessions stop working at that moment.
  - Demo and real trips are isolated: demo drivers never see or accept real requests, and vice versa.
  Test: "SEC-001: demo staff dashboards lock…"
Status: Fixed. OWNER ACTION: set DEMO_MODE=false on the live service before launch anyway.
```

```
ID: SEC-002
Title: Sessions can't be revoked
Severity: High. A stolen token (phishing, shared device, malware) works for 7 days even after the victim
  changes their password, signs out, or has their role changed or account suspended (role change only).
Location: backend/src/auth.js signToken/readUser
Fix:
  - Tokens now carry a token version; bumping it invalidates every earlier token.
  - The version is bumped on password change (other devices are signed out), on the new "Sign out
    everywhere" (POST /api/auth/logout-all), on admin "end sessions", suspension, staff role change
    and MFA reset.
  - Tokens are refused if the account's role has changed since sign-in.
  - Staff sessions now last 12 hours (STAFF_SESSION_HOURS).
  - MFA step tokens can't be used as sessions.
  Test: "SEC-002/004 …"
Status: Fixed. Short-lived access tokens plus rotating refresh tokens in an httpOnly cookie follow in
  Phase 4 (SEC-017).
```

```
ID: SEC-003
Title: No multi-factor authentication for staff
Severity: High. A phished staff password gives access to every customer's ID documents and the payout file.
Location: routes/auth.js login
Fix:
  - Authenticator-app (TOTP, RFC 6238) two-step sign-in, mandatory for admin, compliance, support and
    finance. They set it up with a QR code at their next sign-in.
  - 8 single-use recovery codes, stored hashed.
  - Code reuse is refused, wrong codes trigger a lockout, and the secret is encrypted at rest and
    never returned by the API.
  - Customers can turn it on optionally in Profile.
  - Admins can reset a colleague's two-step sign-in or sign them out (Staff tab).
  Test: "SEC-003 …"
Status: Fixed. Passkeys (WebAuthn) recommended as the next step.
```

```
ID: SEC-004
Title: Credential stuffing defences
Severity: High. The only defence was 25 logins per 15 minutes per IP, which botnets rotating IPs ignore.
  Common breached passwords were accepted, and unknown emails answered faster (account enumeration
  by timing).
Location: routes/auth.js login/register, validate.js
Fix:
  - Per-account lockout after 5 failures (15 min, doubling up to 4 h). It applies the same way to
    unknown emails, so it reveals nothing.
  - A dummy bcrypt compare equalises response time.
  - Have I Been Pwned k-anonymity check (only 5 characters of a SHA-1 hash leave the server) on
    sign-up, driver application, password change and staff creation. On by default in production,
    and it fails open if the service is down.
  Test: "SEC-002/004 …"
Status: Fixed. A Cloudflare Turnstile bot check and a Redis-backed lockout come in Phase 4.
```

```
ID: SEC-005
Title: End-of-life multipart library
Severity: High. multer 1.x is unmaintained, and denial-of-service bugs (malformed requests, memory leaks)
  are fixed only in 2.x. DROP runs as a single process, so one crash takes the whole platform offline.
Location: backend/package.json, routes/verification.js
Fix: Upgraded to multer 2.5.0 (same API). Test: "SEC-005 … malformed uploads are rejected without crashing".
Status: Fixed.
```

```
ID: SEC-006
Title: Payout redirection after account takeover
Severity: High (direct financial loss). Anyone with a driver's session could change the bank account
  and withdraw straight away.
Location: routes/money.js PUT /wallet/bank-account, POST /wallet/withdrawals
Fix:
  - Changing the bank account requires the driver's password.
  - Withdrawals to a changed account are held for 24 hours (BANK_CHANGE_HOLD_HOURS); a first-time
    account has no hold.
  - The change is audit-logged and the driver is notified.
  Test: "SEC-006 …"
Status: Fixed.
```

```
ID: SEC-007
Title: User objects leak secret fields
Severity: Medium. GET /api/admin/users, /api/auth/me and others returned the encrypted bank-account blob
  and, with MFA, would have returned the encrypted TOTP secret.
Fix: publicUser() now strips passwordHash, tokenVersion, MFA data and the encrypted account number,
  and exposes only mfaEnabled. Test: "…no secret fields leak".
Status: Fixed.
```

```
ID: SEC-008
Title: Identity numbers stored in plain text at rest
Severity: Medium (POPIA special personal information; there is no network exposure, only in data-file
  or backup leaks).
Location: verifications.profile.idNumber in drop-db.json
Fix (planned next): store it AES-256-GCM encrypted, plus an HMAC for the duplicate-ID check and a
  masked copy for display. Migrate existing records on start-up.
Status: Fixed in Phase 4. IDs are stored encrypted with an HMAC for duplicate checks and a masked copy for display, and old records are migrated on start-up. Test: defence.test.js "SEC-008 …".
```

```
ID: SEC-009
Title: No idempotency on booking creation
Severity: Medium. Retries or double taps create duplicate bookings (and duplicate card checkouts).
Fix: Idempotency-Key header on POST /bookings and checkout, stored with the response (Redis in Phase 6),
  plus a one-open-booking-per-passenger rule.
Status: Open (Phase 6 booking hardening).
```

```
ID: SEC-011
Title: No self-service password reset
Severity: Medium. Locked-out users depend on support, which invites social-engineering "please reset my
  password" requests.
Fix: Single-use, 30-minute, hashed reset tokens sent by email, with "if that email exists we sent a link"
  wording. Needs an email provider.
Status: Needs owner decision. Recommended: Resend or Postmark (free tiers cover launch volume).
```

```
ID: SEC-012 (Medium) Rate limits are in memory and per instance. They reset on deploy and won't hold
  across instances. Fix: Redis-backed limiter (Phase 4/6). Open.
ID: SEC-013 (Medium) The audit log is an ordinary collection; an admin with data-file access could edit
  it. Fix: hash-chained entries plus an export to write-once storage. Open (Phase 4).
ID: SEC-014 (High) No backups. A volume failure or corruption loses all data. Fix: managed Postgres with
  point-in-time recovery (Phase 6). Interim owner action now: enable Railway volume backups (daily)
  on the DROP service. Needs owner decision.
ID: SEC-016 (Medium) PHONE_CALLS defaults to "direct" without Twilio, so passengers and drivers see each
  other's registered number while a trip is open. Fix: configure Twilio masked calling (about
  R1–R2/min) or set PHONE_CALLS=off. Needs owner decision.
ID: SEC-017 (Medium) The JWT lives in localStorage, so an XSS bug could read it (mitigated by strict CSP
  and React escaping). Fix: 15-minute access token in memory plus a rotating refresh token in an
  httpOnly, Secure, SameSite=Strict cookie, with reuse detection. Open (Phase 4; the mobile apps use the
  keychain).
ID: SEC-019 (Medium) There is no CI pipeline. Fix: GitHub Actions with tests, npm audit/OSV, gitleaks,
  Semgrep and a ZAP baseline against staging; merges blocked on High findings. Open (Phase 4).
ID: SEC-021 (Medium) A modified client can post fake GPS fixes. Fix: speed and teleport plausibility
  checks; Play Integrity / App Attest in the native driver app. Open (Phase 5).
ID: SEC-022 (Medium) /api/maps/config returns the browser Maps key by design. Owner action: restrict it
  to your domains and the Maps JavaScript API in Google Cloud, and set a daily quota. Needs owner action.
ID: SEC-024 (Medium) createDecipheriv('aes-256-gcm') was called without authTagLength, so a truncated or crafted
  ciphertext with a short tag could pass integrity checks with far less forgery resistance. Found by the
  Semgrep job on the first CI run. Fix: authTagLength 16 on every GCM cipher and decipher (documents, ID
  numbers, bank numbers, MFA secrets, backups). Test: defence.test.js. Fixed.
ID: SEC-010 (Low) GET /bookings/:id also accepts the sequential ref. Access checks hold, but it eases
  enumeration. Fix: accept UUIDs only in the API (refs for display). Open.
ID: SEC-015 (Low) CSP allows *.googleusercontent.com, *.ggpht.com and blob: scripts for Google Maps.
  Fix: switch to Google's nonce-based strict CSP. Open.
ID: SEC-018 (Low) Sign-up says "an account with this email already exists". Accepted for usability;
  lockout and Turnstile reduce the value of enumerating. Accepted.
ID: SEC-020 (Low) Staff accounts start with a password the admin chose. Fix: invite link and set-your-own
  password on first sign-in. Open.
ID: SEC-023 (Low) The finance payout CSV contains decrypted account numbers (needed by the bank). Now behind
  staff MFA and audited; add a step-up code prompt on export. Partly mitigated.
```

## Checks that passed (no finding)

- **Passwords:** bcrypt cost 11. Minimum 8 characters with letters and digits, now with a breach check.
- **Authorization:** every booking, document, message, call and tracking route checks owner, driver or staff. Cross-user tests in the comms, tracking and security test files return 404.
- **Server-side computation:** fares, service fees, driver earnings, refunds and wallet balances are all computed on the server; the client never sends prices.
- **Injection:** no SQL or NoSQL engine is used. There is no `eval` or child process, and file paths are built only from UUIDs. The XML parser for Paymentology handles no entities (no XXE). Provider URLs come only from environment variables (no SSRF).
- **Uploads:** checked by file content (PDF/JPEG/PNG), 8 MB limit, renamed to UUIDs, encrypted at rest, outside the web root, served only to the owner or compliance staff.
- **Webhooks:** Paystack HMAC-SHA512 and the Paymentology checksum use timing-safe comparison. Payments are verified server-to-server, and ledger posts are idempotent.
- **Headers:** Helmet sets HSTS (1 year), nosniff, frame-ancestors 'self', Referrer-Policy and a CSP without inline scripts; Permissions-Policy limits the camera and microphone to this site. CORS uses an allow-list, without credentials.
- **Secrets:** none in code or git history; `.env` is git-ignored; the mobile bundle doesn't exist yet.
- **Card data:** no full card numbers or CVVs are stored (Paymentology tokens and masked PANs only), which keeps PCI scope small.
