/**
 * Vehicle catalogue: the vehicle types, makes and models drivers choose from, and which DROP services and
 * categories each vehicle may do. One source of truth for the API, website, apps, dispatch and maps.
 *
 * Age limits follow the published South African rules of the major platforms (Uber ZA, 2026): Go up to
 * 12 years (hatchbacks and sedans), everyday sedans up to 8 years (UberX), premium up to 5 years
 * (Comfort/Black), MPVs/XL up to 8 years. Minibuses (scholar and staff transport), bakkies (bulky goods)
 * and motorbikes (deliveries) are DROP's own rules. Review them with operations before launch.
 */

export const VEHICLE_TYPES = {
  hatchback: { label: 'Hatchback', seats: 5, blurb: 'Compact 5-door cars' },
  sedan: { label: 'Sedan', seats: 5, blurb: '4-door cars with a boot' },
  suv: { label: 'SUV or crossover', seats: 5, blurb: 'Higher, roomier 5-seaters' },
  mpv: { label: 'MPV (7-seater)', seats: 7, blurb: 'Three rows of seats' },
  minibus: { label: 'Minibus or passenger van', seats: 14, blurb: '8 to 16 passengers, for school and staff transport' },
  bakkie: { label: 'Bakkie (pickup)', seats: 2, blurb: 'Load bin for bulky goods and moving' },
  motorbike: { label: 'Motorbike or scooter', seats: 1, blurb: 'Fast city deliveries' },
  luxury_sedan: { label: 'Luxury sedan', seats: 5, blurb: 'Premium German, Japanese and Swedish sedans' },
  luxury_suv: { label: 'Luxury SUV', seats: 5, blurb: 'Premium SUVs for executive transfers' },
};

/** [make, model, type, seats?] Popular South African models. Anything else can be added as "other" and is reviewed. */
const MODELS = [
  // Hatchbacks
  ['Toyota', 'Starlet', 'hatchback'], ['Toyota', 'Vitz', 'hatchback'], ['Toyota', 'Agya', 'hatchback'], ['Toyota', 'Yaris', 'hatchback'],
  ['Suzuki', 'Swift', 'hatchback'], ['Suzuki', 'Celerio', 'hatchback'], ['Suzuki', 'Baleno', 'hatchback'], ['Suzuki', 'Ignis', 'hatchback'],
  ['Volkswagen', 'Polo Vivo', 'hatchback'], ['Volkswagen', 'Polo', 'hatchback'],
  ['Hyundai', 'Grand i10', 'hatchback'], ['Hyundai', 'i20', 'hatchback'], ['Kia', 'Picanto', 'hatchback'], ['Kia', 'Rio hatch', 'hatchback'],
  ['Renault', 'Kwid', 'hatchback'], ['Renault', 'Clio', 'hatchback'], ['Renault', 'Sandero', 'hatchback'], ['Ford', 'Figo', 'hatchback'],
  ['Honda', 'Fit', 'hatchback'], ['Honda', 'Jazz', 'hatchback'], ['Honda', 'Brio', 'hatchback'], ['Nissan', 'Micra', 'hatchback'],
  ['Citroën', 'C3', 'hatchback'], ['Peugeot', '208', 'hatchback'], ['Mahindra', 'KUV100', 'hatchback'],
  // Sedans
  ['Toyota', 'Corolla', 'sedan'], ['Toyota', 'Corolla Quest', 'sedan'], ['Suzuki', 'Dzire', 'sedan'], ['Suzuki', 'Ciaz', 'sedan'],
  ['Volkswagen', 'Polo Sedan', 'sedan'], ['Volkswagen', 'Jetta', 'sedan'], ['Volkswagen', 'Passat', 'sedan'],
  ['Hyundai', 'Accent', 'sedan'], ['Hyundai', 'Elantra', 'sedan'], ['Hyundai', 'Grand i10 Sedan', 'sedan'],
  ['Kia', 'Pegas', 'sedan'], ['Kia', 'Soluto', 'sedan'], ['Kia', 'Rio sedan', 'sedan'], ['Kia', 'Cerato', 'sedan'],
  ['Honda', 'Amaze', 'sedan'], ['Honda', 'Ballade', 'sedan'], ['Honda', 'Civic', 'sedan'],
  ['Nissan', 'Almera', 'sedan'], ['Nissan', 'Sentra', 'sedan'], ['Mazda', 'Mazda3 Sedan', 'sedan'], ['Proton', 'Saga', 'sedan'], ['Toyota', 'Camry', 'sedan'],
  // SUVs and crossovers
  ['Toyota', 'Urban Cruiser', 'suv'], ['Toyota', 'Corolla Cross', 'suv'], ['Toyota', 'C-HR', 'suv'], ['Toyota', 'RAV4', 'suv'], ['Toyota', 'Rush', 'suv'],
  ['Suzuki', 'Brezza', 'suv'], ['Suzuki', 'Grand Vitara', 'suv'], ['Suzuki', 'Fronx', 'suv'],
  ['Volkswagen', 'T-Cross', 'suv'], ['Volkswagen', 'Taigo', 'suv'], ['Volkswagen', 'Tiguan', 'suv'],
  ['Hyundai', 'Venue', 'suv'], ['Hyundai', 'Creta', 'suv'], ['Hyundai', 'Tucson', 'suv'], ['Kia', 'Sonet', 'suv'], ['Kia', 'Seltos', 'suv'], ['Kia', 'Sportage', 'suv'],
  ['Haval', 'Jolion', 'suv'], ['Haval', 'H6', 'suv'], ['Chery', 'Tiggo 4 Pro', 'suv'], ['Chery', 'Tiggo 7 Pro', 'suv'], ['Omoda', 'C5', 'suv'],
  ['Nissan', 'Magnite', 'suv'], ['Nissan', 'Qashqai', 'suv'], ['Nissan', 'X-Trail', 'suv'], ['Renault', 'Kiger', 'suv'], ['Renault', 'Duster', 'suv'],
  ['Ford', 'Territory', 'suv'], ['Ford', 'EcoSport', 'suv'], ['Mazda', 'CX-3', 'suv'], ['Mazda', 'CX-30', 'suv'], ['Mazda', 'CX-5', 'suv'],
  ['Mitsubishi', 'ASX', 'suv'], ['Mitsubishi', 'Eclipse Cross', 'suv'], ['Mitsubishi', 'Outlander', 'suv'],
  ['Honda', 'WR-V', 'suv'], ['Honda', 'HR-V', 'suv'], ['Honda', 'CR-V', 'suv'], ['Mahindra', 'XUV 3XO', 'suv'], ['Citroën', 'C5 Aircross', 'suv'],
  // MPVs and 7-seaters
  ['Toyota', 'Avanza', 'mpv'], ['Toyota', 'Veloz', 'mpv'], ['Toyota', 'Rumion', 'mpv'], ['Toyota', 'Innova', 'mpv'], ['Toyota', 'Fortuner', 'mpv'],
  ['Suzuki', 'Ertiga', 'mpv'], ['Suzuki', 'XL6', 'mpv'], ['Renault', 'Triber', 'mpv'], ['Mitsubishi', 'Xpander', 'mpv'], ['Honda', 'BR-V', 'mpv'],
  ['Chery', 'Tiggo 8 Pro', 'mpv'], ['Mahindra', 'XUV700', 'mpv'], ['Kia', 'Carnival', 'mpv', 8], ['Hyundai', 'Staria', 'mpv', 9],
  // Minibuses and passenger vans
  ['Toyota', 'Quantum 14-seater', 'minibus', 14], ['Toyota', 'Quantum Ses\'fikile 15-seater', 'minibus', 15], ['Toyota', 'HiAce Bus', 'minibus', 14],
  ['Nissan', 'NV350 Impendulo', 'minibus', 15], ['Hyundai', 'H-1 Bus', 'minibus', 9], ['Volkswagen', 'Kombi / Transporter', 'minibus', 9],
  ['Volkswagen', 'Crafter Bus', 'minibus', 16], ['Mercedes-Benz', 'Vito Tourer', 'minibus', 8], ['Mercedes-Benz', 'Sprinter Bus', 'minibus', 16],
  ['Ford', 'Tourneo Custom', 'minibus', 8], ['Ford', 'Transit Bus', 'minibus', 14], ['Foton', 'View', 'minibus', 15], ['BAIC', 'Inkunzi Bus', 'minibus', 15],
  // Bakkies
  ['Toyota', 'Hilux', 'bakkie'], ['Ford', 'Ranger', 'bakkie'], ['Isuzu', 'D-Max', 'bakkie'], ['Nissan', 'Navara', 'bakkie'], ['Nissan', 'NP200', 'bakkie'],
  ['GWM', 'P-Series', 'bakkie'], ['GWM', 'Steed', 'bakkie'], ['Mahindra', 'Pik Up', 'bakkie'], ['Volkswagen', 'Amarok', 'bakkie'], ['Mitsubishi', 'Triton', 'bakkie'],
  ['Peugeot', 'Landtrek', 'bakkie'], ['JAC', 'T8', 'bakkie'], ['Suzuki', 'Super Carry', 'bakkie'], ['Toyota', 'Land Cruiser 79', 'bakkie'],
  // Motorbikes and scooters
  ['Honda', 'Ace 125', 'motorbike'], ['Honda', 'Wave 110', 'motorbike'], ['Honda', 'CB125F', 'motorbike'], ['Yamaha', 'YBR125', 'motorbike'], ['Yamaha', 'Crypton', 'motorbike'],
  ['Suzuki', 'Address 110', 'motorbike'], ['TVS', 'HLX 125', 'motorbike'], ['TVS', 'Apache RTR 160', 'motorbike'], ['Bajaj', 'Boxer 150', 'motorbike'], ['Bajaj', 'Pulsar 150', 'motorbike'],
  ['Kymco', 'Agility 125', 'motorbike'], ['SYM', 'Orbit 125', 'motorbike'],
  // Luxury sedans
  ['Audi', 'A4', 'luxury_sedan'], ['Audi', 'A6', 'luxury_sedan'], ['BMW', '3 Series', 'luxury_sedan'], ['BMW', '5 Series', 'luxury_sedan'], ['BMW', '7 Series', 'luxury_sedan'],
  ['Mercedes-Benz', 'C-Class', 'luxury_sedan'], ['Mercedes-Benz', 'E-Class', 'luxury_sedan'], ['Mercedes-Benz', 'S-Class', 'luxury_sedan'],
  ['Lexus', 'ES', 'luxury_sedan'], ['Lexus', 'IS', 'luxury_sedan'], ['Volvo', 'S60', 'luxury_sedan'], ['Volvo', 'S90', 'luxury_sedan'], ['Jaguar', 'XF', 'luxury_sedan'],
  // Luxury SUVs
  ['Audi', 'Q5', 'luxury_suv'], ['Audi', 'Q7', 'luxury_suv', 7], ['BMW', 'X3', 'luxury_suv'], ['BMW', 'X5', 'luxury_suv'], ['BMW', 'X7', 'luxury_suv', 7],
  ['Mercedes-Benz', 'GLC', 'luxury_suv'], ['Mercedes-Benz', 'GLE', 'luxury_suv'], ['Mercedes-Benz', 'GLS', 'luxury_suv', 7], ['Mercedes-Benz', 'V-Class', 'luxury_suv', 7],
  ['Lexus', 'NX', 'luxury_suv'], ['Lexus', 'RX', 'luxury_suv'], ['Volvo', 'XC60', 'luxury_suv'], ['Volvo', 'XC90', 'luxury_suv', 7],
  ['Land Rover', 'Range Rover Evoque', 'luxury_suv'], ['Land Rover', 'Range Rover Velar', 'luxury_suv'], ['Land Rover', 'Range Rover Sport', 'luxury_suv'], ['Land Rover', 'Discovery', 'luxury_suv', 7],
  ['Toyota', 'Land Cruiser Prado', 'luxury_suv', 7], ['Toyota', 'Land Cruiser 300', 'luxury_suv', 7],
];

export const CATALOGUE = MODELS.map(([make, model, type, seats]) => ({ id: `${make}|${model}`.toLowerCase().replace(/[^a-z0-9|]+/g, '-'), make, model, type, seats: seats || VEHICLE_TYPES[type].seats }));

/**
 * What each vehicle may do: `${service}:${category}` → { type: maximum age in years }, plus a minimum
 * number of passenger seats where it matters. Scholar transport additionally needs a vetted driver
 * (see plans.js scholarEligibility).
 */
export const RULES = {
  'Ride:Go': { types: { hatchback: 12, sedan: 12 }, label: 'Ride · Go' },
  'Ride:Comfort': { types: { sedan: 8, suv: 8, luxury_sedan: 8, luxury_suv: 8 }, label: 'Ride · Comfort' },
  'Ride:XL': { types: { mpv: 8, minibus: 10, luxury_suv: 8 }, minSeats: 7, label: 'Ride · XL' },
  'Ride:Executive': { types: { luxury_sedan: 5, luxury_suv: 5 }, label: 'Ride · Executive' },
  'Ride:Minibus': { types: { minibus: 12 }, minSeats: 8, label: 'School and staff transport · Minibus' },
  'Delivery:Documents': { types: { motorbike: 10, hatchback: 15, sedan: 15, suv: 15, mpv: 15, bakkie: 15 }, label: 'Delivery · Documents' },
  'Delivery:Small parcel': { types: { motorbike: 10, hatchback: 15, sedan: 15, suv: 15, mpv: 15, bakkie: 15 }, label: 'Delivery · Small parcel' },
  'Delivery:Food & retail': { types: { motorbike: 10, hatchback: 15, sedan: 15, suv: 15, mpv: 15, bakkie: 15 }, label: 'Delivery · Food & retail' },
  'Delivery:Bakkie': { types: { bakkie: 15 }, label: 'Delivery · Bakkie (bulky goods)' },
  'Premium Drive:Executive sedan': { types: { luxury_sedan: 5 }, label: 'Premium Drive · Executive sedan' },
  'Premium Drive:Luxury SUV': { types: { luxury_suv: 5 }, label: 'Premium Drive · Luxury SUV' },
};

/** Categories a driver could already do before vehicles were catalogued; drivers without a profile keep them. */
const LEGACY = ['Ride:Comfort', 'Ride:XL', 'Ride:Executive', 'Delivery:Documents', 'Delivery:Small parcel', 'Delivery:Food & retail', 'Premium Drive:Executive sedan', 'Premium Drive:Luxury SUV'];

/** Map image per booking category, used when the car's own type isn't known yet. */
export const CATEGORY_IMAGE = { Go: 'hatchback', Comfort: 'sedan', XL: 'mpv', Executive: 'luxury_sedan', Minibus: 'minibus', Documents: 'motorbike', 'Small parcel': 'motorbike', 'Food & retail': 'motorbike', Bakkie: 'bakkie', 'Executive sedan': 'luxury_sedan', 'Luxury SUV': 'luxury_suv' };

export const currentYear = () => new Date().getFullYear();

/** Categories a vehicle may do, from its type, model year and seats. */
export function eligibleCategories({ type, year, seats }) {
  const age = currentYear() - Number(year);
  return Object.entries(RULES).filter(([, r]) => r.types[type] != null && age <= r.types[type] && (!r.minSeats || (seats || VEHICLE_TYPES[type]?.seats || 0) >= r.minSeats)).map(([k]) => k);
}

/** Validate a driver's vehicle choice and build the stored profile. Throws a message string on bad input. */
export function vehicleProfile(input) {
  const b = input || {};
  const listed = b.catalogueId ? CATALOGUE.find((c) => c.id === String(b.catalogueId)) : null;
  if (b.catalogueId && !listed) throw 'Choose your vehicle from the list, or pick “Other” and type it.';
  const type = listed ? listed.type : String(b.type || '');
  if (!VEHICLE_TYPES[type]) throw 'Choose the type of vehicle.';
  const make = listed ? listed.make : String(b.make || '').trim();
  const model = listed ? listed.model : String(b.model || '').trim();
  if (make.length < 2 || model.length < 1 || make.length > 40 || model.length > 60) throw 'Enter the make and model of the vehicle.';
  const year = Number(b.year);
  if (!Number.isInteger(year) || year < currentYear() - 25 || year > currentYear() + 1) throw 'Enter the vehicle’s model year.';
  const plate = String(b.plate || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!/^[A-Z0-9 -]{4,12}$/.test(plate)) throw 'Enter the registration number as on the licence disc, e.g. CA 123-456.';
  const colour = String(b.colour || '').trim().slice(0, 30);
  if (colour.length < 3) throw 'Enter the vehicle colour.';
  const seats = listed ? listed.seats : Math.max(1, Math.min(23, Number(b.seats) || VEHICLE_TYPES[type].seats));
  const categories = eligibleCategories({ type, year, seats });
  if (!categories.length) {
    const max = Math.max(...Object.values(RULES).map((r) => r.types[type] || 0));
    throw `A ${VEHICLE_TYPES[type].label.toLowerCase()} must be ${max} years old or newer to drive with DROP.`;
  }
  return { type, make, model, year, plate, colour, seats, listed: Boolean(listed), catalogueId: listed?.id || null, categories };
}

/** The legacy one-line description stored on the user and shown on trips. */
export const vehicleLabel = (p) => `${p.make} ${p.model} · ${p.colour} · ${p.plate}`;

/** Can this driver's (approved) vehicle do this booking? Drivers without a catalogued vehicle keep the old categories. */
export function canTake(driver, booking) {
  const key = `${booking.service}:${booking.category}`;
  const cats = driver?.vehicleProfile?.categories;
  return cats ? cats.includes(key) : LEGACY.includes(key);
}

/** Image for a driver on the map: their vehicle type, else the booking's category, else a sedan. */
export const imageFor = (driver, booking) => driver?.vehicleProfile?.type || (booking && CATEGORY_IMAGE[booking.category]) || 'sedan';

/** Coach operators and airlines staff can pick when adding group travel partners (they still need a signed agreement). */
export const TRAVEL_OPERATORS = {
  bus: ['Intercape', 'Eldo Coaches', 'Translux', 'City to City', 'Eagle Liner', 'Intercity Xpress', 'Citiliner', 'Baz Bus'],
  flightDomestic: ['FlySafair', 'Airlink', 'South African Airways', 'CemAir', 'LIFT'],
  flightInternational: ['South African Airways', 'Airlink', 'FlySafair', 'Emirates', 'Qatar Airways', 'Ethiopian Airlines', 'Kenya Airways', 'Turkish Airlines', 'British Airways', 'Lufthansa', 'KLM', 'Air France', 'Etihad Airways', 'RwandAir'],
};

/** What the API returns to the website and apps. */
export function catalogueView() {
  return {
    types: Object.entries(VEHICLE_TYPES).map(([key, t]) => ({ key, ...t, serves: Object.entries(RULES).filter(([, r]) => r.types[key] != null).map(([k, r]) => ({ key: k, label: r.label, maxAge: r.types[key] })) })),
    models: CATALOGUE,
    makes: [...new Set(CATALOGUE.map((c) => c.make))].sort(),
    rules: Object.entries(RULES).map(([key, r]) => ({ key, ...r })),
    categoryImage: CATEGORY_IMAGE,
    operators: TRAVEL_OPERATORS,
    year: currentYear(),
  };
}
