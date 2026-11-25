# Store submission checklist: DROP and DROP Driver

## Both stores
- [ ] Privacy policy URL: `https://<your-domain>/privacy` (live, reviewed by your attorney, Information Officer filled in)
- [ ] Terms URL: `https://<your-domain>/terms`
- [ ] Account deletion URL (Google Play requirement): `https://<your-domain>/delete-account`. In-app deletion is under Account → Delete account
- [ ] Support email and URL: the contact email in `CONTACT_EMAIL`
- [ ] Demo accounts for reviewers on the **production** API:
  - one verified passenger
  - one verified, approved driver with an active test trip
  - put the credentials in the review notes; two-step sign-in must be off for these accounts
- [ ] Screenshots: 6.7" and 5.5" iPhone, plus a Pixel-size Android phone. Show booking, the live map, chat, verification and earnings
- [ ] App icon (1024 px, no transparency for iOS), already in `apps/*/assets/icon.png`
- [ ] Age rating: 18+ (financial features and unmoderated user chat)

## Google Play: Data safety form
| Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Name, email, phone | Yes | With the trip counterpart (first name only) | Account, app functionality | Required |
| Precise location | Yes (driver: background while online; passenger: only if shared) | With the trip counterpart | App functionality, fraud prevention, safety | Driver required to go online; passenger optional |
| Photos (documents, selfie) | Yes | No | Identity verification, fraud prevention | Required to book or drive |
| Government ID number | Yes (encrypted) | Paymentology (driver cards only) | Verification, compliance | Required |
| Financial info (bank account, payment history) | Yes | Paystack, Paymentology | Payments | Drivers: required for withdrawals |
| Messages | Yes | With the trip counterpart | App functionality, safety | Optional |
| Audio and video | **Not collected** (calls are peer-to-peer and not recorded) | n/a | n/a | n/a |
| Device IDs (push token, integrity verdict) | Yes | Expo/Google/Apple | App functionality, security | Required |

- Data is **encrypted in transit**. Users **can request deletion** (in-app and on the web).
- **Background location declaration (DROP Driver):** explain that drivers' location is shared with the passenger and used for ETAs and safety while they are online, even when the app is closed. Attach a short video of the disclosure screen and the online switch.
- **Foreground service type:** `location`. Justification: live trip tracking while online.
- **Permissions justification:** camera (documents, video calls), microphone (calls), notifications (trips, calls).
- **Financial features declaration:** the driver wallet and card are provided through Paymentology (licensed issuer). The app itself doesn't hold funds. Confirm the wording with counsel.

## Apple App Store: App Privacy labels
- **Data linked to the user:** contact info, location (precise), user content (messages, photos), identifiers, financial info, sensitive info (government ID).
- **Tracking:** **No** (no ATT prompt is needed). The privacy manifest is declared in `app-config.base.js`.
- **Review notes:**
  - DROP is a ride-hailing service where drivers own the platform. In-app calls are WebRTC between rider and driver.
  - Payments are for a physical service (transport), so Apple in-app purchase does not apply (guideline 3.1.3(e)).
  - DROP Driver uses background location only while the driver is online.
- **Export compliance:** `ITSAppUsesNonExemptEncryption=false` (standard HTTPS only).
- **Background modes:** location (driver), audio and voip (calls), remote notifications.

## Before each release
- [ ] Bump `version` in `app-config.base.js` (EAS auto-increments build numbers)
- [ ] CI green, including the `mobile` job
- [ ] Maestro flows pass on staging (`maestro test apps/passenger/.maestro` and `apps/driver/.maestro`)
- [ ] If the release fixes a security issue: raise `MOBILE_MIN_VERSION_PASSENGER` / `_DRIVER` on the server once the update is live in both stores
