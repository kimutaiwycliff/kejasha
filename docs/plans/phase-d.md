# Phase D — Design: brand, theme, motion and maps

> Status: **IN PROGRESS** · drafted 2026-11-24 · ADR-022
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)
> UI only: the API contract does not change (properties already have latitude/longitude).

## Goal
Make Kejasha look and feel like one product on web and Android: a brand, a warm colour system
where colour means something, gentle motion, clearer dashboards, and a map of the portfolio with
a visual board of every unit.

## Brand
- **Name:** *keja* is Sheng for a house or home. The mark is a home: a white roof over a
  terracotta doorway on an acacia-green tile — legible at 16 px, distinct from M-Pesa green.
- **Wordmark:** `kejasha` in Plus Jakarta Sans ExtraBold, lower case, the dot of the *j* in
  terracotta.
- **Palette** (light / dark):

| Role | Light | Dark | Use |
|---|---|---|---|
| Primary — Acacia | `#0F6B52` | `#3DBE8F` | actions, active navigation, links |
| Accent — Murram | `#B44A25` | `#E58A62` | brand accent, highlights |
| Savannah | `#D9922E` | `#EDB55A` | warnings, "due soon" |
| Ocean | `#1F6FB2` | `#6AAEE6` | short stays, information |
| Plum | `#7C4D9E` | `#B793D6` | charts |
| Background | `#FAF8F4` | `#0D1311` | warm paper / deep green-black |

- **Status colours** (identical meaning everywhere): occupied → green, vacant → terracotta,
  owing → red, booked / in house → ocean blue, inactive → grey, due soon → savannah.
- **Type:** Plus Jakarta Sans (400–800), tabular figures for money.
- **Shape:** 12 px radius on cards, 10 px on controls; soft shadows; no hard borders on cards.

## Slices
- [x] **D1 Brand & theme:** ADR-022; logo assets (SVG mark, wordmark, favicon, Android adaptive
  icon, splash); web tokens (light/dark), font, sidebar with logo, auth pages with a brand panel;
  Android colour scheme, typography, shapes, launcher icon and splash; status colours shared.
- [x] **D2 Web polish & motion:** dashboard with coloured KPI cards, count-up figures, a
  six-month chart and occupancy rings; page-enter and list stagger animations; semantic badges;
  empty states; org switcher search; reduced-motion respected.
- [x] **D3 Maps & unit board:** properties list ↔ map (clustered pins coloured by occupancy);
  property page with its map and a unit board (floors × units, coloured by status, tenant and
  balance on hover, legend); set a property's pin by tapping the map or "use my location".
  Android: a Homes tab with list ↔ map and the same unit board.
- [ ] **D4 Android polish & motion:** brand sign-in, Today with coloured cards, count-up and a
  trend chart, animated tab and screen transitions, account moved to the top bar for owners,
  tenant home with a balance card.

## Definition of Done
- Web: typecheck, lint, unit, Playwright journeys and axe accessibility green in both themes.
- Android: lint, unit and Compose UI tests green; Maestro suite green on the emulator.
- Contrast ≥ 4.5:1 for text in both themes; motion off under reduced-motion settings.
- Docs: brand section and map configuration documented.

## Notes
- 2026-11-24 — **Generated Kotlin client fixes found by the maps:** coordinates are JSON numbers,
  so OpenAPI `number` maps to `Double`; `anyOf: [primitive, null]` is normalised to
  `type: [primitive, "null"]` before generation (it produced empty classes), and nullability is
  applied to nested inline objects as well.
- 2026-11-24 — **MapLibre Compose needs its renderer** as an explicit dependency
  (`maplibre-native-ffi-runtime-opengl-android`, OpenGL ES for the widest device support).
- 2026-11-24 — **MapLibre GL 6 worker** is served from `public/maplibre/worker-<version>.mjs`
  (copied before dev/build); bundlers cannot follow its runtime worker URL.
