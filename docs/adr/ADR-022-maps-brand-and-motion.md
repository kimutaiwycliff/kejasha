# ADR-022 — Maps (MapLibre + OpenFreeMap), brand theme and motion

- Status: Accepted · 2026-11-24
- Amends: CLAUDE.md §3 (adds a Maps row; adds brand font and motion conventions)

## Context
Owners asked to see their properties and units visually. Properties already carry
`latitude`/`longitude` in the contract, but nothing shows them. The web and Android apps also use
stock grey themes with no brand, colour language or motion.

Map options considered:
- **Google Maps** (web + Android): best Kenyan base data, but needs billing and API keys per
  client, restricts styling and caching, and ties both apps to one vendor.
- **Leaflet + raster OSM tiles**: simple, but the public OSM tile servers forbid app traffic and
  raster tiles look dated on high-density screens.
- **MapLibre (vector) + OpenFreeMap tiles**: open source (BSD), one renderer family on web
  (MapLibre GL JS) and Android (MapLibre Native via MapLibre Compose), vector styles we can
  theme, and OpenFreeMap serves OSM-based vector tiles with no key or limits. Its terms are
  "as-is" and the service may change.

## Decision
- **Maps:** MapLibre GL JS `6.x` in `apps/web` (thin React wrapper of our own) and
  `org.maplibre.compose:maplibre-compose` `0.20.x` in `apps/android`. The map style URL is
  configuration (`NEXT_PUBLIC_MAP_STYLE_URL` / Gradle `kejashaMapStyleUrl`), defaulting to
  OpenFreeMap's `liberty` style. OpenStreetMap attribution stays visible. Switching provider
  (self-hosted OpenFreeMap/PMTiles, MapTiler, Stadia) is a configuration change.
- **Coordinates** are set by the owner dropping a pin (or "use my location"); no geocoding
  service in v1. Properties without coordinates still list normally.
- **Brand:** a Kejasha mark and wordmark (see `docs/plans/phase-d.md`), a palette rooted in
  Kenyan landscape (acacia green, murram terracotta, savannah amber, Indian Ocean blue) with
  semantic status colours shared by web and Android, and **Plus Jakarta Sans** (SIL OFL) on both.
- **Motion:** CSS (Tailwind + `tw-animate-css`) on web and Compose animation APIs on Android —
  no animation library. Every animation is short (≤ 300 ms), purposeful (entering content,
  state changes) and disabled under `prefers-reduced-motion` / the system animator scale.

## Consequences
+ Maps without keys or billing in development and at launch; one style language on both apps.
+ A recognisable product with colour that carries meaning (occupied, vacant, owing, booked).
− OpenFreeMap has no SLA: before scale, self-host tiles or move to a paid provider (config only).
− Two map dependencies to keep current; MapLibre Compose is pre-1.0.
