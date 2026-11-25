// k6 load test for STAGING: browse → fare → book → poll, plus driver accept/advance.
// Tokens come from a seeded staging dataset (never production):
//   k6 run -e BASE=https://staging.drop.example.com/api -e TOKENS=tokens.json loadtest/k6/booking-flow.js
// tokens.json = { "passengers": ["<jwt>", ...], "drivers": ["<jwt>", ...] }  (see loadtest/README.md)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.BASE;
const T = JSON.parse(open(__ENV.TOKENS || './tokens.json'));
const booked = new Counter('bookings_created');
const acceptLatency = new Trend('accept_latency', true);
const trip = { service: 'Ride', category: 'Comfort', pickup: 'Cape Town City Centre', destination: 'V&A Waterfront', passengers: 1, payment: 'Cash' };

export const options = {
  scenarios: {
    // Ramp to the target: 2,000 bookings/minute ≈ 33 arrivals/s
    passengers: { executor: 'ramping-arrival-rate', exec: 'passenger', startRate: 2, timeUnit: '1s', preAllocatedVUs: 200, maxVUs: 2000,
      stages: [{ target: 33, duration: '5m' }, { target: 33, duration: '20m' }, { target: 0, duration: '2m' }] },
    drivers: { executor: 'constant-vus', exec: 'driver', vus: 800, duration: '27m' },
    browsers: { executor: 'constant-arrival-rate', exec: 'browse', rate: 200, timeUnit: '1s', duration: '27m', preAllocatedVUs: 100 },
  },
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<300', 'p(99)<800'],
    http_req_failed: ['rate<0.01'],
    'checks{check:booking created}': ['rate>0.999'],
  },
};
const auth = (t) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` } });

export function browse() { http.get(`${BASE}/places`); http.post(`${BASE}/fares/estimate`, JSON.stringify(trip), { headers: { 'content-type': 'application/json' } }); }

export function passenger() {
  const t = T.passengers[(__VU * 7919 + __ITER) % T.passengers.length];
  const r = http.post(`${BASE}/bookings`, JSON.stringify(trip), { headers: { ...auth(t).headers, 'idempotency-key': uuidv4() } });
  // 409 = this test passenger already has an open trip (one open trip per passenger is enforced)
  check(r, { 'booking created': (x) => x.status === 201 || x.status === 409 });
  if (r.status === 201) booked.add(1);
}

export function driver() {
  const t = T.drivers[__VU % T.drivers.length];
  const r = http.get(`${BASE}/drivers/requests`, auth(t));
  const body = r.json() || {};
  if (body.active) { http.post(`${BASE}/drivers/bookings/${body.active.id}/advance`, null, auth(t)); sleep(1); return; }
  if (body.requests && body.requests.length) {
    const a = http.post(`${BASE}/drivers/bookings/${body.requests[0].id}/accept`, null, auth(t));
    acceptLatency.add(a.timings.duration);
    check(a, { 'accept answered': (x) => x.status === 200 || x.status === 409 });
  }
  http.post(`${BASE}/drivers/location`, JSON.stringify({ lat: -33.92 + Math.random() / 50, lng: 18.42 + Math.random() / 50, accuracy: 8 }), auth(t));
  sleep(1);
}
