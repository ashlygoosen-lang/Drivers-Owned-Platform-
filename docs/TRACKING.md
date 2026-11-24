# Real-time vehicle tracking (Google Maps)

## What people see

| Who | Where | What |
|---|---|---|
| Passenger | Trip screen (Track) | The car moving live, the road route, the ETA to the pickup and then to the destination, and an "arrived" message. Optional **Share my location with my driver** until pickup. |
| Driver | Ride requests → active trip | Their own car, the pickup, the passenger's shared location, the route and the ETA. A GPS status line shows whether sharing is working. |
| Admin / Support | **Live map** tab | Every online driver (available or on a trip), requests waiting for a driver, and the live map of any selected trip. |
| Both, after the trip | Trip screen | The route actually driven (orange line). |

## How it works

1. **Collecting the driver's position.** While the driver is online, the driver's phone sends a GPS fix about every 3 seconds (`POST /api/drivers/location`). The phone browser's location permission is needed, and the page must stay open; it keeps the screen awake where the phone supports it.
2. **Sending it to the passenger.** The server passes each fix straight to the passenger on that driver's active trip, using the same live connection as chat. The car glides smoothly between fixes and turns to face its heading.
3. **Route and arrival time.** These come from the Google **Routes API** with live traffic. The server refreshes the route at most every 30 seconds or when the car leaves it, and scales the arrival time in between. This keeps Google costs low.
4. **Turning addresses into map points.** Pickup and destination addresses are converted with the Google **Geocoding API**, limited to South Africa. Known DROP places use built-in coordinates and cost nothing.
5. **Without Google keys.** Tracking still works: positions are drawn on a simple grid, and the arrival time is estimated from distance.

## Privacy (POPIA)

- **Who sees a driver's position:** only the passenger on that driver's active trip, plus admin and support staff.
- **When it is tracked:** only while the driver is online or on a trip. Going offline stops it.
- **The passenger's location:** shared only if the passenger turns it on. It stops automatically at pickup and is never written to disk.
- **What is kept:** a sampled trail of the trip route (one point every 15 seconds or 60 m) is saved on the booking for safety and disputes. Mention this in your privacy policy.

## Google Cloud setup

1. In Google Cloud Console, create a project and enable billing. Google gives a monthly free usage allowance.
2. Enable three APIs: **Maps JavaScript API**, **Geocoding API** and **Routes API**.
3. Create a **browser key**:
   - Restrict it to the Maps JavaScript API.
   - Add HTTP referrers for your domains, such as `https://your-app.up.railway.app/*` and your custom domain.
   - Set it as `GOOGLE_MAPS_BROWSER_KEY`.
4. Create a **server key**:
   - Restrict it to the Geocoding API and Routes API.
   - Set it as `GOOGLE_MAPS_SERVER_KEY`. Never put this key in frontend code.
5. Optional: under Map Management, create a Map ID (JavaScript, vector) styled in DROP colours, and set `GOOGLE_MAPS_MAP_ID`. Without it, Google's `DEMO_MAP_ID` is used, which is fine for testing.
6. Redeploy. The site picks up the keys at runtime, so no rebuild is needed.

## Demo

The demo driver's car is simulated. It drives from Green Point to the V&A Waterfront pickup, waits, and loops. After **Passenger collected · start trip**, it drives along the M3 to Kirstenbosch. To see it, sign in as the demo passenger (My trips → Track), the demo driver, or the demo admin (Live map). The simulator only runs in demo mode and never moves real accounts.

## Not included yet

- **Background tracking with the screen off.** This needs the native driver app (see APPS-ROADMAP.md). Browsers stop GPS when the page is closed.
- **Turn-by-turn navigation for drivers.** The driver can open Google Maps or Waze from their phone for that.
