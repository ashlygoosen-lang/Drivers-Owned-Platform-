# Incident response plan: DROP

Keep a printed or offline copy. In an incident, speed matters more than being perfect: contain first, investigate second.

## Contacts (fill in)
| Role | Name | Phone | Backup |
|---|---|---|---|
| Incident lead (decides) | Vincent Kafula, Managing Director | [ ] | [ ] |
| Technical lead | [ ] | [ ] | [ ] |
| Information Officer (POPIA) | [ ] (must be registered with the Information Regulator) | [ ] | [ ] |
| Legal counsel | [ ] | [ ] | |
| Paystack support | dashboard.paystack.com → Support | | |
| Paymentology support | your account manager | | |
| Railway support | station.railway.com / team support | | |
| Cloudflare | dashboard → Support | | |

## Severity
| Level | Examples | Response |
|---|---|---|
| **SEV-1** | Personal data exposed; money moved without authorisation; admin account compromised; site down | All hands now, lead informed within 15 min |
| **SEV-2** | Active attack being blocked (stuffing, DDoS); audit chain broken; backups failing | Within 1 hour |
| **SEV-3** | A single account taken over; suspicious but contained activity | Same working day |

## First 30 minutes: contain
Use whichever of these fit the incident. Every action is reversible.

| Need | How | Effect |
|---|---|---|
| Stop customer traffic but keep staff working | Admin → **Security** → Maintenance mode **On** (or Railway variable `MAINTENANCE_MODE=on`) | Customers see a maintenance message (503). Staff, sign-in and payment callbacks keep working |
| Sign **everyone** out | Railway → DROP service → Variables → change `SESSION_EPOCH` (e.g. 1 → 2) → redeploy | All access and refresh tokens stop working at once. People sign in again (staff with MFA) |
| Sign out one person | Admin → Users or Staff → **Sign out** / Disable | Ends that person's sessions immediately |
| Lock a compromised staff member | Staff → Disable, then Reset two-step | Sessions end; they can't sign in |
| Absorb a flood or DDoS | Cloudflare → Security → **Under Attack Mode**; tighten the WAF rate rules | Challenge page for every visitor at the edge |
| Freeze a driver card | Finance → Cards → Stop card | Paymentology declines further spending |
| Stop payouts | Finance → Payouts: don't mark withdrawals as paid; reject suspicious ones | No money leaves the pool |

Write down the time and what you did. The audit log records staff actions automatically.

## Rotate keys (when a secret may have leaked)
Rotate in this order. Change each in its provider first, then in the Railway variables, then redeploy.

| Secret | Where | Notes |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack → Settings → API Keys | Also re-check the webhook URL |
| `PAYMENTOLOGY_TERMINAL_PASSWORD` | Paymentology account manager | Coordinate so card authorisations don't fail |
| `TWILIO_AUTH_TOKEN` | Twilio Console | |
| `GOOGLE_MAPS_SERVER_KEY` / browser key | Google Cloud → Credentials | Keep referrer restrictions |
| `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → Rotate | |
| `JWT_SECRET` | Railway variable | Signs everyone out (same effect as `SESSION_EPOCH`) |
| `FILE_ENCRYPTION_KEY` | **Do not rotate without a re-encryption run**: it decrypts stored documents, ID numbers and bank numbers. Ask the technical lead. |
| `BACKUP_KEY` | New key for new backups; keep the old key offline until old backups expire. |
| GitHub tokens / Railway tokens | Revoke and re-issue in each dashboard | |

## Investigate
- **Admin → Security:** recent security events (lockouts, staff sign-ins from new networks, token reuse, spikes) and audit-log integrity.
- **Admin → Audit log:** every staff action on KYC, money, chats and settings.
- **Railway → Logs:** structured JSON lines, searchable by `id` (request ID), `path`, `status` and `user` (8-character prefix).
- **Paystack and Paymentology dashboards:** compare transactions with Finance → Ledger and run **Reconcile**.
- Keep evidence: export logs and the data file before changing anything else. Take a backup with `npm run backup`.

## Recover
1. Fix the cause (patch, revoke, rotate) and confirm with a test.
2. If data was damaged, restore from the latest good backup into a new folder, check it, then switch over:
   - Run `npm run restore -- <file> <folder>`.
   - Start a new service with `DATA_DIR=<folder>`.
3. Turn maintenance mode off. Watch the Security tab and the error rate for an hour.

## Notify (POPIA section 22)
If personal information **has been, or may have been**, accessed or acquired by an unauthorised person:
- **Notify the Information Regulator as soon as reasonably possible** using the prescribed form (eServices portal on inforegulator.org.za). In practice, aim for within 72 hours.
- **Notify affected people** directly (email, and SMS if their contact details may be compromised). Say:
  - what happened and what information was involved
  - what DROP has done
  - what they should do (for example change their password, watch for phishing, contact their bank)
  - how to contact the Information Officer
- **Payment card data:** DROP stores no full card numbers. Still inform Paystack and Paymentology if their systems or tokens are involved.
- Delay only if the SAPS or a security agency asks in writing.
- Keep a record of every breach, even small ones, with the decision about whether to notify.

## Afterwards (within 5 working days)
Write a blameless post-incident review:
- timeline, cause and impact
- what worked and what didn't
- actions, each with an owner and a date

Add a test or a monitoring rule so the same thing is caught automatically next time.
