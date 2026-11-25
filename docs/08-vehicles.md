# 08 · Vehicles: catalogue, rules and map images

**For:** Vincent Kafula, VINK Group (Pty) Ltd · **Date:** 25 November 2026

Drivers choose their vehicle from a South African catalogue instead of typing it. DROP then knows what each vehicle may do, offers drivers only the trips their vehicle qualifies for, and shows riders a picture of the real vehicle type on every map.

| Part | Files |
|---|---|
| Catalogue, rules, travel operators | `backend/src/vehicles.js` (served at `GET /api/vehicles/catalogue`) |
| Driver vehicle and changes | `backend/src/routes/drivers.js` (`GET/PUT /api/drivers/vehicle`), `routes/compliance.js` (`/api/compliance/vehicles`) |
| Dispatch | `backend/src/dispatch.js` and the accept route use `canTake()` |
| Illustrations | `frontend/src/lib/vehicleArt.ts` (website); PNG renders in `mobile/packages/shared/assets/vehicles` with `src/lib/vehicleImages.ts` (apps) |
| Pickers | `frontend/src/components/VehiclePicker.tsx`, `mobile/packages/shared/src/components/VehiclePicker.tsx` |
| Plan maps | `GET /api/plans/:id/map`, `frontend/src/dashboard/PlanMap.tsx`, `mobile/packages/shared/src/components/PlanMap.tsx` |
| Tests | `backend/test/vehicles.test.js`, `mobile/packages/shared/__tests__/vehicles.test.ts` |

## 1. Vehicle types and what they may do

Age limits follow Uber South Africa's published 2026 rules where a matching category exists (Go 12 years, UberX sedans 8, premium 5, MPV/XL 8). Minibus, bakkie and motorbike limits are DROP's own and should be confirmed by operations.

| Type | Examples | May do (maximum age) |
|---|---|---|
| Hatchback | Polo Vivo, Swift, Starlet, Kwid, i20 | Ride Go (12) · deliveries (15) |
| Sedan | Corolla, Dzire, Ciaz, Accent, Almera, Jetta | Ride Go (12) · Ride Comfort (8) · deliveries (15) |
| SUV | Urban Cruiser, Corolla Cross, T-Cross, Jolion, Creta | Ride Comfort (8) · deliveries (15) |
| MPV (7-seater) | Avanza, Rumion, Ertiga, XL6, Triber, Xpander | Ride XL (8) · deliveries (15) |
| Minibus | Toyota Quantum, Hyundai H-1, Nissan Impendulo, Sprinter | **School and staff transport, Minibus (12)** · Ride XL (10) |
| Bakkie | Hilux, Ranger, D-Max, Navara, NP200, P-Series | **Delivery Bakkie, bulky goods (15)** · deliveries (15) |
| Motorbike | Honda Ace 125, TVS HLX 125, Bajaj Boxer, Yamaha YBR125 | **Deliveries: documents, small parcels, food (10)** |
| Luxury sedan | BMW 3/5/7 Series, Mercedes C/E/S-Class, Audi A4/A6, Lexus | Ride Executive (5) · Premium Drive Executive sedan (5) · Comfort (8) |
| Luxury SUV | BMW X3/X5, Mercedes GLC/GLE/V-Class, Volvo XC90, Range Rover | Ride Executive (5) · Premium Drive Luxury SUV (5) · Comfort (8) · XL with 7 seats (8) |

New categories: **Ride Go** (cheapest, hatchbacks and older sedans), **Delivery Bakkie** (furniture and bulky goods) and **Minibus** for monthly scholar and staff plans (up to 14 learners or staff; never offered for on-demand rides). Comfort stays the default ride. Their tariffs in `backend/src/pricing.js` are placeholders like the others; confirm them before launch.

Drivers whose vehicle was entered before the catalogue keep the categories they had (Comfort, XL, Executive, deliveries, Premium Drive) until they choose their vehicle from the list. The new categories need a catalogued vehicle.

## 2. Adding and changing a vehicle

- **Applying:** drivers pick the type (with pictures), then make and model from the list, or "My vehicle isn't listed" (type it; flagged for compliance), then year, colour and registration. The form shows what the vehicle can do before they submit, and the server refuses vehicles too old for any category.
- **Changing after approval:** the new vehicle waits under **Verification queue → Vehicle changes to check**. The driver keeps their current vehicle until compliance approves the new one, after checking its registration, licence disc, roadworthy and insurance. Approvals and refusals are audited, and the driver is notified.
- **Dispatch:** a trip is only offered to, and can only be accepted by, a driver whose approved vehicle may do that service and category. This works alongside the scholar-transport vetting rule.

## 3. Pictures on the maps

Original illustrations, with no brand artwork, for each type. The top-down view rotates with the driver's heading and keeps real proportions, so a minibus looks bigger than a hatchback. The side view is used when choosing.

- **Riders:** the trip map and the booking preview show the vehicle that's coming (or the category's vehicle before a driver accepts). Ride and delivery options show a picture per category.
- **Staff:** the live fleet map shows every online driver as their vehicle type.
- **Plans:** each plan page (website and app) has a map of the route with the plan's vehicle, moving live while a trip on the plan is under way. Plan cards show the vehicle.
- **Group travel:** coach and aircraft pictures on search results and partners.

To change the artwork, edit `vehicleArt.ts`, then regenerate the app PNGs with the render script in the commit history (Playwright renders each SVG at 3× with a transparent background).

## 4. Group travel partners

When staff add a partner, the form suggests coach operators (Intercape, Eldo Coaches, Translux, City to City, Eagle Liner, Intercity Xpress, Citiliner, Baz Bus) and airlines: domestic (FlySafair, Airlink, SAA, CemAir, LIFT) and international (Emirates, Qatar Airways, Ethiopian, Kenya Airways, Turkish Airlines, British Airways, Lufthansa, KLM, Air France, Etihad, RwandAir and others). These are only suggestions: add a partner only once a written group agreement is signed.
