// Spike: 10× the normal booking arrival rate for 2 minutes (e.g. a stadium emptying). Staging only.
import { passenger, driver } from './booking-flow.js';
export { passenger, driver };
export const options = {
  scenarios: {
    spike: { executor: 'ramping-arrival-rate', exec: 'passenger', startRate: 10, timeUnit: '1s', preAllocatedVUs: 500, maxVUs: 5000,
      stages: [{ target: 33, duration: '2m' }, { target: 330, duration: '30s' }, { target: 330, duration: '2m' }, { target: 33, duration: '1m' }] },
    drivers: { executor: 'constant-vus', exec: 'driver', vus: 1500, duration: '6m' },
  },
  thresholds: { http_req_failed: ['rate<0.02'], 'http_req_duration{expected_response:true}': ['p(99)<2000'] },
};
