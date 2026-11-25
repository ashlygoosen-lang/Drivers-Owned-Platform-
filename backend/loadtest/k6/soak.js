// Soak: steady target load for 4 hours to find memory leaks and slow degradation. Staging only.
import { passenger, driver, browse } from './booking-flow.js';
export { passenger, driver, browse };
export const options = {
  scenarios: {
    passengers: { executor: 'constant-arrival-rate', exec: 'passenger', rate: 33, timeUnit: '1s', duration: '4h', preAllocatedVUs: 300, maxVUs: 2000 },
    drivers: { executor: 'constant-vus', exec: 'driver', vus: 800, duration: '4h' },
    browsers: { executor: 'constant-arrival-rate', exec: 'browse', rate: 100, timeUnit: '1s', duration: '4h', preAllocatedVUs: 100 },
  },
  thresholds: { 'http_req_duration{expected_response:true}': ['p(95)<300'], http_req_failed: ['rate<0.01'] },
};
