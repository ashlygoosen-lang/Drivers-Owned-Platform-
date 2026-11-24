# DROP passenger & driver apps — implementation plan

The website and API already provide accounts, fares, bookings, the driver queue, trip status, ratings, support and admin.
The apps should reuse that API rather than introduce a second backend.

## Recommended stack
- **Expo (React Native + TypeScript)**, one monorepo: `apps/passenger`, `apps/driver`, `packages/ui` (DROP tokens, buttons, cards, icons), `packages/api` (typed client shared with the website).
- Builds and store submission with EAS.

## Phases
1. **Foundation** — monorepo, shared design tokens from `/brand`, API client, auth (existing JWT), splash and icons from `brand/png`.
2. **Passenger core** — onboarding, register/login, home, pickup/destination, fare estimate, vehicle choice, confirm, matching, live status, driver profile, cancel, rating, history, receipts, profile, support, SOS.
3. **Driver core** — application with document upload, verification status, online/offline, incoming requests, accept/decline, pickup → start → complete, earnings (daily/weekly), history, rating, documents.
4. **Real-time & maps** — WebSocket or SSE for live status (replaces polling), live driver location, navigation hand-off.
5. **Payments & messaging** — card payments, in-app chat/calls, push notifications.

## External services and credentials needed
| Feature | Service options | You provide |
|---|---|---|
| Maps, geocoding, routing, live map | Google Maps Platform or Mapbox | API key + billing account |
| OTP by SMS | Twilio, Clickatell, BulkSMS | Account + sender ID |
| Card payments | Paystack, Peach Payments, Yoco | Merchant account + keys |
| Push notifications | Expo Push / Firebase Cloud Messaging | Firebase project |
| In-app calling (masked numbers) | Twilio Voice | Account + numbers |
| App stores | Apple Developer ($99/yr), Google Play ($25) | Developer accounts |

Until these are connected the apps must not present them as working (e.g. no fake OTP or fake card charges).
