# DROP identity verification (KYC)

## Who must provide what
| Account | Details | Required documents | Optional |
|---|---|---|---|
| Passenger | Legal name, SA ID or passport number, date of birth, nationality, residential address | ID document, proof of address (≤ 3 months) | — |
| Driver | As above + emergency contact; minimum age 21 | ID, proof of address, selfie holding ID, driving licence, PrDP, vehicle registration/licence disc, vehicle insurance (expiry dates required) | Roadworthy, e-hailing operating licence, police clearance |
| Business | Company name, CIPC number (YYYY/NNNNNN/NN), VAT no. + authorised representative's details | Representative's ID, proof of address, CIPC certificate | — |

## Rules enforced by the API
- SA ID numbers are validated (date of birth + Luhn checksum); date of birth is taken from the ID. One ID number per account.
- Files: PDF, JPG or PNG, max 8 MB, identified by content (magic bytes), not by name. Selfies must be images.
- Files are encrypted with AES-256-GCM (`FILE_ENCRYPTION_KEY`) in `DATA_DIR/uploads/kyc/` and only decrypted for the owner and for Compliance/Super Admin. Responses are `no-store`.
- ID numbers are masked (`•••••••••9086`) everywhere except the compliance review screen.
- Proof of address older than 90 days and documents already past expiry are refused at upload.
- **Passengers/businesses** can book once documents are submitted (`PASSENGER_VERIFICATION=submitted`, default), only after approval (`verified`), or without verification (`off`).
- **Drivers** can only go online when verified. If a document expires or is rejected, they are taken offline automatically.
- Every review action is written to the audit log (who, what, when, reason). Opening a file is logged too.

## Statuses
`not_started` → `in_progress` (details/documents added) → `submitted` (awaiting review) → `verified`, or `action_required` (a document was rejected/expired or changes were requested). Replacing a rejected document sends the file straight back to the queue.

## Staff roles
- **Super Admin**: everything, plus staff accounts (Dashboard → Staff).
- **Compliance officer**: verification queue, review, expiring documents, audit log.
- **Support agent**: tickets, enquiries, user and booking look-up. Cannot open ID documents.

## API
User: `GET /api/verification` · `PUT /api/verification/profile` · `POST /api/verification/documents` (multipart: `type`, `file`, `expiresAt`, `issuedAt`) · `DELETE /api/verification/documents/:id` · `GET /api/verification/documents/:id/file` · `POST /api/verification/submit` `{consent:true}` · `GET /api/notifications` · `POST /api/notifications/read`
Staff: `GET /api/compliance/queue?status=&role=&q=` · `GET /api/compliance/verifications/:userId` · `POST /api/compliance/documents/:docId/review` `{decision, reason, expiresAt}` · `POST /api/compliance/verifications/:userId/decision` `{decision: approve|request_changes, note}` · `GET /api/compliance/expiring?days=` · `POST /api/compliance/remind/:userId` · `GET /api/compliance/audit`
Admin: `GET/POST /api/admin/staff` · `PATCH /api/admin/staff/:id`

## Not included (needs an external provider)
Automated ID checks against Home Affairs, face matching/liveness, and criminal record checks require a verification provider (e.g. Smile ID, VerifyNow, Onfido, Thisisme) with an account and API keys. The workflow above is designed so an automated check can be added as an extra step before human review.

## POPIA notes
Users give explicit consent at submission (time-stamped). Set a retention policy (e.g. delete documents of closed accounts after the legally required period) and appoint an Information Officer before launch.
