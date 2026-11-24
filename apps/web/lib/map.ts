/**
 * Map configuration (ADR-022). The style is configuration: OpenFreeMap by default, a self-hosted
 * or paid provider by setting NEXT_PUBLIC_MAP_STYLE_URL.
 */
export const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';

/** [longitude, latitude] */
export type LngLat = [number, number];

/** Kenya as a whole, for properties without a pin. */
export const KENYA: { center: LngLat; zoom: number } = { center: [37.9, 0.2], zoom: 5.4 };

/** Where to start dropping a pin: the county's main town (approximate), else all of Kenya. */
const COUNTY_CENTER: Partial<Record<string, LngLat>> = {
  Nairobi: [36.817, -1.286],
  Mombasa: [39.668, -4.043],
  Kisumu: [34.768, -0.092],
  Nakuru: [36.08, -0.303],
  Kiambu: [36.831, -1.031],
  Machakos: [37.263, -1.517],
  Kajiado: [36.78, -1.852],
  Kwale: [39.45, -4.18],
  Kilifi: [39.85, -3.63],
  'Uasin Gishu': [35.27, 0.514],
  Nyeri: [36.951, -0.42],
  Meru: [37.649, 0.047],
  Kakamega: [34.751, 0.282],
  Kericho: [35.283, -0.368],
  Laikipia: [37.074, 0.016],
  Lamu: [40.902, -2.27],
  Embu: [37.457, -0.531],
  "Murang'a": [37.15, -0.72],
  Kirinyaga: [37.28, -0.5],
  Nyandarua: [36.43, -0.18],
  Narok: [35.87, -1.08],
  Bungoma: [34.56, 0.56],
  'Trans Nzoia': [35.0, 1.02],
};

export function startView(county: string | null | undefined): { center: LngLat; zoom: number } {
  const c = county ? COUNTY_CENTER[county] : undefined;
  return c ? { center: c, zoom: 11.5 } : KENYA;
}

/** Occupancy → pin colour (same meanings as the status badges). */
export function occupancyColor(occupied: number, units: number): string {
  if (units === 0) return 'var(--info)';
  const share = occupied / units;
  if (share >= 0.9) return 'var(--success)';
  if (share >= 0.6) return 'var(--warning)';
  return 'var(--murram)';
}
