/**
 * DROP fare engine.
 *
 * TARIFFS BELOW ARE LAUNCH PLACEHOLDERS — confirm them before taking real bookings.
 * They can also be overridden with the DRIVER_SERVICE_FEE_RATE environment variable.
 *
 * Model: the passenger pays the fare and NO passenger platform commission. The driver keeps the
 * fare less a single disclosed DROP service fee.
 */
export const DRIVER_SERVICE_FEE_RATE = Number(process.env.DRIVER_SERVICE_FEE_RATE ?? 0.1);

export const CATEGORIES = {
  Ride: {
    Comfort: { base: 25, perKm: 9.5, perMin: 1.1, minimum: 45, seats: 4, description: 'Everyday sedans, air-conditioned' },
    XL: { base: 35, perKm: 13, perMin: 1.4, minimum: 70, seats: 6, description: 'Larger vehicles for groups and luggage' },
    Executive: { base: 60, perKm: 18, perMin: 2, minimum: 140, seats: 4, description: 'Premium sedans and professional drivers' },
  },
  Delivery: {
    Documents: { base: 30, perKm: 6.5, perMin: 0.6, minimum: 45, seats: 0, description: 'Envelopes and documents up to 1 kg' },
    'Small parcel': { base: 40, perKm: 7.5, perMin: 0.7, minimum: 60, seats: 0, description: 'Boxes up to 5 kg' },
    'Food & retail': { base: 35, perKm: 7, perMin: 0.7, minimum: 50, seats: 0, description: 'Takeaways, groceries and shop orders' },
  },
  'Premium Drive': {
    'Executive sedan': { base: 90, perKm: 22, perMin: 2.5, minimum: 220, seats: 4, description: 'Luxury sedans with chauffeur' },
    'Luxury SUV': { base: 120, perKm: 27, perMin: 3, minimum: 280, seats: 6, description: 'Luxury SUVs for airport and corporate transfers' },
  },
};

/** Approximate coordinates for common pickup points (South Africa). */
export const PLACES = [
  ['Cape Town City Centre', -33.9249, 18.4241], ['V&A Waterfront', -33.9036, 18.4207],
  ['Cape Town International Airport', -33.9715, 18.6021], ['Sea Point Promenade', -33.915, 18.386],
  ['Camps Bay', -33.951, 18.3776], ['Green Point', -33.907, 18.408], ['Gardens', -33.933, 18.412],
  ['District Six', -33.933, 18.432], ['Woodstock', -33.927, 18.447], ['Observatory', -33.938, 18.471],
  ['Rondebosch', -33.96, 18.475], ['Claremont', -33.981, 18.465], ['Constantia', -34.026, 18.444],
  ['Century City', -33.893, 18.51], ['Bellville', -33.9, 18.629], ['Durbanville', -33.832, 18.647],
  ['Table View', -33.824, 18.49], ['Hout Bay', -34.043, 18.354], ['Kirstenbosch Gardens', -33.9875, 18.4327], ['Muizenberg', -34.108, 18.469],
  ['Mitchells Plain', -34.05, 18.618], ['Khayelitsha', -34.04, 18.678], ['Stellenbosch', -33.9321, 18.8602],
  ['Johannesburg CBD', -26.2041, 28.0473], ['Sandton City', -26.1076, 28.0567], ['Rosebank', -26.146, 28.0436],
  ['Soweto', -26.2485, 27.854], ['Midrand', -25.999, 28.126], ['OR Tambo International Airport', -26.1367, 28.2411],
  ['Pretoria CBD', -25.7479, 28.2293], ['Menlyn', -25.7826, 28.2754],
  ['Durban CBD', -29.8587, 31.0218], ['Umhlanga', -29.727, 31.084], ['King Shaka International Airport', -29.6144, 31.1197],
].map(([name, lat, lng]) => ({ name, lat, lng }));

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function findPlace(text) {
  const q = norm(text);
  if (!q) return null;
  return PLACES.find((p) => norm(p.name) === q)
    || PLACES.find((p) => q.includes(norm(p.name)) || norm(p.name).includes(q))
    || null;
}

export function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round = (n, step = 1) => Number((Math.round(n / step) * step).toFixed(2));

/** Returns { distanceKm, durationMin, approximate } for two free-text addresses. */
export function route(pickup, destination) {
  const a = findPlace(pickup);
  const b = findPlace(destination);
  if (a && b) {
    const km = Math.max(1.2, haversineKm(a, b) * 1.3); // straight line → road distance
    const speed = km > 25 ? 55 : 28; // km/h: highway vs city average
    return { distanceKm: round(km, 0.1), durationMin: Math.max(4, Math.round((km / speed) * 60)), approximate: false };
  }
  // Unknown address: standard metro trip. The final fare is confirmed when the driver accepts.
  return { distanceKm: 10, durationMin: 22, approximate: true };
}

export function categoriesFor(service) {
  return CATEGORIES[service] || null;
}

export function quote({ service, category, pickup, destination }) {
  const cats = categoriesFor(service);
  if (!cats) throw Object.assign(new Error('Unknown service.'), { status: 400 });
  const r = route(pickup, destination);
  const options = Object.entries(cats).map(([name, t]) => {
    const fare = Math.max(t.minimum, round(t.base + t.perKm * r.distanceKm + t.perMin * r.durationMin, 5));
    const serviceFee = round(fare * DRIVER_SERVICE_FEE_RATE, 0.01);
    return {
      category: name,
      description: t.description,
      seats: t.seats,
      fare,
      passengerCommission: 0,
      driverServiceFee: serviceFee,
      driverEarnings: round(fare - serviceFee, 0.01),
      etaMin: 3 + (name.length % 5),
    };
  });
  const selected = options.find((o) => o.category === category) || options[0];
  return { service, ...r, currency: 'ZAR', options, selected, serviceFeeRate: DRIVER_SERVICE_FEE_RATE };
}
