/**
 * Vehicle pictures for the apps: PNG renders of the website's illustrations (frontend/src/lib/vehicleArt.ts),
 * so riders see the same vehicle on every map. Regenerate them when the artwork changes.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
export const VEHICLE_TOP = {
  bakkie: { image: require('../../assets/vehicles/top-bakkie.png'), width: 29, height: 49 },
  hatchback: { image: require('../../assets/vehicles/top-hatchback.png'), width: 27, height: 37 },
  luxury_sedan: { image: require('../../assets/vehicles/top-luxury_sedan.png'), width: 28, height: 49 },
  luxury_suv: { image: require('../../assets/vehicles/top-luxury_suv.png'), width: 30, height: 47 },
  minibus: { image: require('../../assets/vehicles/top-minibus.png'), width: 32, height: 58 },
  motorbike: { image: require('../../assets/vehicles/top-motorbike.png'), width: 20, height: 39 },
  mpv: { image: require('../../assets/vehicles/top-mpv.png'), width: 29, height: 47 },
  sedan: { image: require('../../assets/vehicles/top-sedan.png'), width: 27, height: 44 },
  suv: { image: require('../../assets/vehicles/top-suv.png'), width: 30, height: 44 },
} as const;
export const VEHICLE_SIDE = {
  bakkie: { image: require('../../assets/vehicles/side-bakkie.png'), width: 120, height: 64 },
  bus: { image: require('../../assets/vehicles/side-bus.png'), width: 120, height: 64 },
  hatchback: { image: require('../../assets/vehicles/side-hatchback.png'), width: 120, height: 64 },
  luxury_sedan: { image: require('../../assets/vehicles/side-luxury_sedan.png'), width: 120, height: 64 },
  luxury_suv: { image: require('../../assets/vehicles/side-luxury_suv.png'), width: 120, height: 64 },
  minibus: { image: require('../../assets/vehicles/side-minibus.png'), width: 120, height: 64 },
  motorbike: { image: require('../../assets/vehicles/side-motorbike.png'), width: 120, height: 64 },
  mpv: { image: require('../../assets/vehicles/side-mpv.png'), width: 120, height: 64 },
  plane: { image: require('../../assets/vehicles/side-plane.png'), width: 120, height: 64 },
  sedan: { image: require('../../assets/vehicles/side-sedan.png'), width: 120, height: 64 },
  suv: { image: require('../../assets/vehicles/side-suv.png'), width: 120, height: 64 },
} as const;
export type VehicleArt = keyof typeof VEHICLE_SIDE;
export const VEHICLE_LABEL: Record<string, string> = { hatchback: 'Hatchback', sedan: 'Sedan', suv: 'SUV', mpv: '7-seater', minibus: 'Minibus', bakkie: 'Bakkie', motorbike: 'Motorbike', luxury_sedan: 'Luxury sedan', luxury_suv: 'Luxury SUV', bus: 'Coach', plane: 'Aircraft' };
/** Picture for a booking category before a driver is assigned. */
export const CATEGORY_ART: Record<string, string> = { Go: 'hatchback', Comfort: 'sedan', XL: 'mpv', Executive: 'luxury_sedan', Minibus: 'minibus', Documents: 'motorbike', 'Small parcel': 'motorbike', 'Food & retail': 'motorbike', Bakkie: 'bakkie', 'Executive sedan': 'luxury_sedan', 'Luxury SUV': 'luxury_suv' };
export const topArt = (type?: string | null) => VEHICLE_TOP[(type && type in VEHICLE_TOP ? type : 'sedan') as keyof typeof VEHICLE_TOP];
export const sideArt = (type?: string | null) => VEHICLE_SIDE[(type && type in VEHICLE_SIDE ? type : 'sedan') as VehicleArt];
