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
| Passport number, date of birth, nationality (group travel) | Yes (passport encrypted) | With the airline or coach operator of that trip only | App functionality (ticketing) | Only when booking group travel |
| Vehicle details (drivers: make, model, year, colour, registration) | Yes | Registration and vehicle type shown to the passenger | App functionality, safety | Drivers: required |
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
- **Data linked to the user:** contact info, location (precise), user content (messages, photos), identifiers, financial info, sensitive info (government ID and, for group travel, passport number), other info (date of birth and nationality for group travel).
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

## Store listing text (ready to paste; adjust prices and areas once confirmed)

### DROP (passenger) · `za.co.drop.passenger`
- **Name:** DROP: Rides, Deliveries & Travel
- **Short description (Play, 80 max):** Rides, deliveries, school runs and group travel, from driver-owners.
- **Subtitle (App Store, 30 max):** Ride Smart. Go Further.
- **Category:** Travel (Play: Maps & Navigation or Travel & Local)
- **Full description:**
  DROP is South Africa's driver-owned mobility platform. Book a ride, send a parcel, set up monthly school or staff transport, or join a group flight or coach trip at the group rate.
  • Rides from Go to Comfort, XL and Executive, with the fare shown before you book and no passenger commission
  • Deliveries by motorbike, car or bakkie, from documents to furniture
  • Monthly scholar transport with vetted drivers (police clearance, child-protection checks and learner-transport licences), and staff transport for businesses
  • Group travel: join a group on your route and date; when it fills, everyone gets the group rate, and if it doesn't, you get your money back
  • See the actual type of vehicle coming on the live map, with ETA, in-app chat and calls
  • Identity-verified riders and drivers, a panic button, and trip sharing
  DROP is a division of VINK Group (Pty) Ltd.
- **Keywords (App Store):** ride,taxi,e-hailing,delivery,school transport,staff transport,group travel,bus,flights,South Africa

### DROP Driver · `za.co.drop.driver`
- **Name:** DROP Driver
- **Short description:** Drive or deliver with DROP: keep 90% of every fare and own a share of the platform.
- **Subtitle:** Drive. Earn. Own.
- **Category:** Business (Play: Business or Maps & Navigation)
- **Full description:**
  DROP Driver is for the independent drivers and delivery partners who own the DROP platform.
  • Keep the fare less one disclosed 10% service fee; no sign-up or monthly fees
  • Get the trips your vehicle qualifies for: rides, deliveries by motorbike, car or bakkie, minibus school and staff runs, and premium drives
  • Monthly plans give you a regular income from the same school or staff route
  • Wallet and DROP Driver Card for fuel and expenses; withdraw to your bank
  • Upload your documents in the app and track your verification
  • Live navigation details, in-app chat and calls, panic button
  Location is shared with your passenger, even in the background, only while you are online.

### Screenshots to capture (on a phone, staging data)
Passenger: home and booking with vehicle pictures; live trip map; school plan with its map; group travel search; trip chat. Driver: requests list; live trip; My vehicle; wallet; verification.
