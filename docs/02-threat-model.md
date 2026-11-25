# 02 · Threat model: DROP

Method: STRIDE for each component, with attackers assumed to use AI tools. These tools can read the source code (it is on GitHub), generate exploits, run bots at scale and write convincing phishing.
L = likelihood, I = impact (H/M/L). The "Mitigation" column says what exists now (✅), what was fixed in Phase 3 (🔧 with the finding ID), and what is planned in later phases (📅).

## Components

1. **Browser app (SPA):** public site, customer and staff dashboards.
2. **API (Express):** auth, bookings, KYC, money, communication, tracking.
3. **Data store:** `drop-db.json` plus encrypted KYC files on the Railway volume.
4. **Live channel:** the server-sent events (SSE) hub and WebRTC signalling.
5. **Payment integrations:** Paystack (in) and Paymentology (card authorisations).
6. **Other providers:** Google Maps, Twilio, TURN.
7. **Staff tools:** compliance, finance and admin dashboards.
8. **Delivery pipeline:** GitHub repository, npm packages, Railway deploys.
9. **Future mobile apps:** passenger and driver (Phase 5).

## AI-driven and automated attacks

| Threat | L | I | Current protection | Mitigation |
|---|---|---|---|---|
| AI vulnerability scanners reading the public repo and probing every endpoint | H | H | Server-side checks on every route; helmet headers; generic errors | 🔧 SEC-001…006 fixed; 📅 Semgrep/CodeQL and ZAP in CI (Phase 4); consider making the repo private |
| Credential stuffing and password spraying | H | H | Per-IP limit of 25 per 15 min | 🔧 SEC-004: per-account lockout with back-off, breached-password refusal, equal timing for unknown emails; 📅 Turnstile bot check (Phase 4) |
| Bots mass-booking or holding drivers (inventory denial) | M | M | Verification gate before booking (ID plus proof of address); bookings need sign-in | 📅 Per-user open-booking cap, Turnstile on booking, booking idempotency keys (SEC-009) |
| Fake accounts at scale, promo abuse | M | M | KYC before booking; duplicate-ID check; no promo codes exist yet | 📅 Turnstile on sign-up; phone verification (OTP) |
| Scraping prices and availability | M | L | Fares are public by design; no availability inventory | 📅 Edge rate limits (Cloudflare) |
| ID enumeration (`/bookings/DRP-1001…`) | H | M | Every lookup checks the owner, driver or staff role; internal ids are UUIDs | 🔧 Real drivers can no longer read demo requests and vice versa (SEC-001); 📅 stop accepting refs as ids (SEC-010) |
| AI phishing of staff, leading to admin takeover | M | **H** | Staff sessions use the same 7-day token; no MFA | 🔧 SEC-003: mandatory authenticator-app MFA for staff, 12-hour staff sessions, revocation; 📅 passkeys |
| SIM swap / OTP interception | M | M | No SMS OTP is used | ✅ Authenticator apps are used instead of SMS (no SIM-swap exposure) |
| Application-layer DDoS (expensive endpoints in bulk) | M | H | 600 requests per 15 min per IP; 100 KB body limit; single instance | 📅 Cloudflare WAF, Redis rate limits, horizontal scaling (Phases 4 and 6) |
| AI-generated fake "DROP support" messages asking drivers for passwords or bank changes | M | H | Bank-change notification | 🔧 SEC-006: password needed for bank changes, 24-hour payout hold; 📅 security-awareness notice in the driver app |

## STRIDE per component

### 1–2. Browser app and API
| STRIDE | Threat | L | I | Mitigation |
|---|---|---|---|---|
| Spoofing | Stolen JWT reused for 7 days, surviving logout and password change | M | H | 🔧 SEC-002: token version, revoked on password change, sign out everywhere, suspension and role change; staff 12 h. 📅 httpOnly refresh-token cookie and 15-minute access tokens (SEC-017) |
| Spoofing | Anyone using a demo admin login on the live site | **H** | **Critical** | 🔧 SEC-001 |
| Tampering | Client-side price or fare tampering | L | H | ✅ Fares, fees and earnings are computed on the server; the client only sends a category |
| Tampering | Mass assignment (sending `role: admin` at sign-up) | L | H | ✅ Allow-listed fields only; role is limited to passenger/business |
| Repudiation | Staff deny reading KYC or chats | M | M | ✅ Audit log for KYC decisions, chat reads and finance actions. 📅 Append-only, hash-chained audit (SEC-013) |
| Info disclosure | XSS stealing a token from `localStorage` | L | H | ✅ React escaping, strict CSP (no inline scripts). 📅 Move to cookies (SEC-017) |
| Info disclosure | API responses leaking secret fields | M | H | 🔧 SEC-007: `publicUser` strips MFA secrets, token versions and encrypted bank numbers |
| DoS | Malformed multipart upload crashing the single process | M | H | 🔧 SEC-005: multer 2.x |
| Elevation | IDOR on bookings, KYC documents, messages | M | H | ✅ Ownership checks on every route, covered by tests |

### 3. Data store
| STRIDE | Threat | L | I | Mitigation |
|---|---|---|---|---|
| Info disclosure | Volume or backup leak exposes ID numbers | L | H | ✅ Documents and bank numbers are AES-256-GCM encrypted. ⚠️ ID numbers are in plain text (SEC-008) |
| Tampering / loss | File corruption or volume loss; no backups | L | **H** | ✅ Atomic writes plus a corrupt-file copy. 📅 Managed Postgres with point-in-time recovery (SEC-014, Phase 6) |
| DoS | Whole dataset in memory; a single instance | M | H | 📅 Postgres and Redis (Phase 6) |

### 4. Live channel (SSE / WebRTC)
| STRIDE | Threat | L | I | Mitigation |
|---|---|---|---|---|
| Spoofing | Joining another user's event stream | L | H | ✅ One-use, 60-second ticket bound to the user |
| Info disclosure | Location shared beyond the trip | L | H | ✅ Only the active trip's passenger and staff; passenger location stays in memory and stops at pickup |
| Tampering | Spoofed GPS from a modified client | M | M | ✅ Plausibility checks (range, accuracy). 📅 Speed/teleport checks; app attestation (Phase 5) |
| DoS | Flooding signalling or messages | M | L | ✅ Message throttle, 20 KB signal cap |

### 5. Payments
| STRIDE | Threat | L | I | Mitigation |
|---|---|---|---|---|
| Spoofing | Forged Paystack webhook | M | H | ✅ HMAC-SHA512 with timing-safe compare; server-to-server verify before marking paid; idempotent ledger keys |
| Spoofing | Forged Paymentology authorisation calls | M | H | ✅ Checksum (timing-safe), terminal id. 📅 Source-IP allow-list at the edge |
| Tampering | Double-spend from concurrent withdrawals | L | H | ✅ Balance check and ledger post run without an `await` between them (atomic in one process). 📅 Database transactions with row locks (Phase 6) |
| Elevation | Session hijack redirecting payouts | M | H | 🔧 SEC-006 |

### 6. Other providers
| Threat | L | I | Mitigation |
|---|---|---|---|
| Google Maps key abuse (billing) | M | M | 📅 Owner: restrict the browser key by HTTP referrer and set quotas (documented) |
| Twilio toll fraud through the phone bridge | L | M | ✅ Only between the two trip parties' registered numbers, 4 calls a minute, a time limit |
| SSRF through provider URLs | L | M | ✅ Provider base URLs come only from environment variables, never from user input |

### 7. Staff tools
| Threat | L | I | Mitigation |
|---|---|---|---|
| Insider misuse (bulk KYC or bank-detail export) | L | H | ✅ Least-privilege roles (finance cannot see KYC documents, compliance cannot see money), audit log. 📅 Alerts on bulk exports, MFA step-up on CSV export |
| Staff account takeover | M | H | 🔧 SEC-003 |

### 8. Delivery pipeline
| Threat | L | I | Mitigation |
|---|---|---|---|
| Malicious npm package or update | M | H | ✅ Lockfiles committed, only 8 runtime dependencies, `npm audit` clean. 📅 Dependabot, `npm ci`, OSV scan in CI |
| Secrets committed to git | M | H | ✅ None found in history. 📅 gitleaks in CI, pre-commit hook |
| GitHub account compromise, malicious deploy | L | H | 📅 Owner: GitHub 2FA, branch protection, required reviews |

### 9. Mobile apps (future)
Tokens in the device keychain, no secrets in the bundle, certificate pinning, Play Integrity and App Attest checked on the server, and a force-update gate. All of this is planned for Phase 5 (MASVS).

## AI / LLM features
None exist. The OWASP LLM Top 10 is not applicable today. If an AI assistant is added later, it needs its own review (prompt injection through trip notes and chat, tool-permission limits).
