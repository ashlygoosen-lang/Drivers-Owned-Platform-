/**
 * Vehicle catalogue for the apps: the shape of /api/vehicles/catalogue and the eligibility rules,
 * mirroring backend/src/vehicles.js so drivers see what their vehicle can do before they submit.
 */
export interface VehicleCatalogue {
  types: { key: string; label: string; seats: number; blurb: string; serves: { key: string; label: string; maxAge: number }[] }[];
  models: { id: string; make: string; model: string; type: string; seats: number }[];
  makes: string[];
  rules: { key: string; label: string; types: Record<string, number>; minSeats?: number }[];
  operators: { bus: string[]; flightDomestic: string[]; flightInternational: string[] };
  year: number;
}
export interface VehicleProfile { type: string; make: string; model: string; year: number; plate: string; colour: string; seats: number; listed: boolean; categories: string[]; submittedAt?: string }
export interface VehicleChoice { type: string; catalogueId: string; make: string; model: string; seats: number; year: string; colour: string; plate: string }
export const emptyVehicleChoice = (): VehicleChoice => ({ type: '', catalogueId: '', make: '', model: '', seats: 0, year: '', colour: '', plate: '' });

/** Rules this vehicle meets (same as the server). */
export function eligibleRules(c: Pick<VehicleCatalogue, 'rules' | 'year'>, type: string, year: number, seats: number) {
  const age = c.year - year;
  return c.rules.filter((r) => r.types[type] != null && age <= r.types[type] && (!r.minSeats || seats >= r.minSeats));
}
/** Oldest model year accepted for a type, for any category. */
export const oldestYear = (c: Pick<VehicleCatalogue, 'types' | 'year'>, type: string) => {
  const t = c.types.find((x) => x.key === type);
  return t ? c.year - Math.max(...t.serves.map((s) => s.maxAge)) : c.year - 15;
};
/** Body for POST /drivers/apply (vehicleDetails) and PUT /drivers/vehicle. */
export const vehicleChoiceBody = (v: VehicleChoice) => (v.catalogueId
  ? { catalogueId: v.catalogueId, year: Number(v.year), colour: v.colour.trim(), plate: v.plate.trim() }
  : { type: v.type, make: v.make.trim(), model: v.model.trim(), seats: v.seats, year: Number(v.year), colour: v.colour.trim(), plate: v.plate.trim() });

/** "Ride: Go, Comfort · Delivery: Documents, Bakkie" from rule keys like "Ride:Go". */
export function canDoSummary(keys: string[]) {
  const groups = new Map<string, string[]>();
  for (const k of keys) {
    const [service, category] = k.split(':');
    const g = category === 'Minibus' ? 'School and staff transport' : service;
    groups.set(g, [...(groups.get(g) || []), category === 'Bakkie' ? 'Bakkie (bulky goods)' : category]);
  }
  return [...groups].map(([g, cats]) => `${g}: ${cats.join(', ')}`).join(' · ');
}
