# Catalog Module — PL Readiness Audit

**Date:** 2026-05-03
**Companion to:** [2026-05-03-mvp-s-week-2-pl-sales-config.md](../2026-05-03-mvp-s-week-2-pl-sales-config.md)
**Status:** Audit complete — supplementary for Week 2 spec

## TLDR

`catalog` module ma kompletny system unitów (40 wartości w 7 grupach: piece, weight, volume, length, area, digital, time, energy). 7/9 jednostek z EPIC plan'u już istnieje. Brakuje: `mb` (metr bieżący — typowo PL), `t` (tona). Polskie labele są **wyłącznie po angielsku** w seed'zie — wymagają i18n keys lub overlay'a per-tenant. Tydzień 2 spec został rozszerzony o ten gap.

## Co jest w `catalog/lib/seeds.ts` (DEFAULT_UNITS)

40 jednostek w grupach (sygnalizowanych w label przez `(piece)`, `(weight)`, etc.):

```typescript
const UNIT_DEFAULTS = [
  // Piece
  { value: 'pc', label: 'Piece (piece)' },        // ⇒ PL "szt."
  { value: 'set', label: 'Set (piece)' },         // ⇒ PL "kpl."
  { value: 'pkg', label: 'Package (piece)' },     // ⇒ PL "opak."
  { value: 'box', label: 'Box (piece)' },
  { value: 'roll', label: 'Roll (piece)' },
  { value: 'pair', label: 'Pair (piece)' },
  { value: 'dozen', label: 'Dozen (piece)' },
  { value: 'unit', label: 'Unit (piece)' },
  
  // Weight
  { value: 'g', label: 'Gram (weight)' },
  { value: 'kg', label: 'Kilogram (weight)' },
  { value: 'mg', label: 'Milligram (weight)' },
  { value: 'lb', label: 'Pound (weight)' },
  { value: 'oz', label: 'Ounce (weight)' },
  // BRAK: t (tona)                              ← gap dla PL
  
  // Volume
  { value: 'ml', label: 'Milliliter (volume)' },
  { value: 'l', label: 'Liter (volume)' },
  { value: 'cl', label: 'Centiliter (volume)' },
  { value: 'm3', label: 'Cubic Meter (volume)' }, // ⇒ PL "m³"
  
  // Length
  { value: 'mm', label: 'Millimeter (length)' },
  { value: 'cm', label: 'Centimeter (length)' },
  { value: 'm', label: 'Meter (length)' },        // ⇒ PL "m"
  { value: 'km', label: 'Kilometer (length)' },
  { value: 'in', label: 'Inch (length)' },
  { value: 'ft', label: 'Foot (length)' },
  // BRAK: mb (metr bieżący)                     ← gap dla PL (very common w budownictwie)
  
  // Area
  { value: 'm2', label: 'Square Meter (area)' },  // ⇒ PL "m²"
  { value: 'cm2', label: 'Square Centimeter (area)' },
  { value: 'ft2', label: 'Square Foot (area)' },
  
  // Digital
  // ... (gb, mb, tb, license, seat — irrelevant dla MVP)
  
  // Time
  { value: 'sec', label: 'Second (time)' },
  { value: 'min', label: 'Minute (time)' },
  { value: 'hour', label: 'Hour (time)' },        // ⇒ PL "h"
  { value: 'day', label: 'Day (time)' },
  { value: 'week', label: 'Week (time)' },
  { value: 'month', label: 'Month (time)' },
  { value: 'year', label: 'Year (time)' },
  
  // Energy
  { value: 'kwh', label: 'Kilowatt Hour (energy)' },
]
```

## EPIC S2.2 mapping → openm

| EPIC PL | openm value | openm label | PL display | Status |
|---|---|---|---|---|
| szt. | `pc` | "Piece (piece)" | szt. | ⚠️ Value OK, label PL needed |
| kpl. | `set` | "Set (piece)" | kpl. | ⚠️ Value OK, label PL needed |
| m | `m` | "Meter (length)" | m | ⚠️ Label PL needed |
| **mb** | **brak** | — | mb | ❌ Add new value |
| m² | `m2` | "Square Meter (area)" | m² | ⚠️ Label PL needed (display "m²" zamiast "m2") |
| m³ | `m3` | "Cubic Meter (volume)" | m³ | ⚠️ Label PL needed |
| kg | `kg` | "Kilogram (weight)" | kg | ⚠️ Label PL needed |
| **t** | **brak** | — | t | ❌ Add new value |
| h | `hour` | "Hour (time)" | h | ⚠️ Value to long ("hour"), label PL needed |

## Gaps for PL MVP

### Gap 1 — Brakuje `mb` (metr bieżący) i `t` (tona)

W `seeds.ts` dodać:

```typescript
{ value: 'mb', label: 'Running Meter (length)' },  // metr bieżący
{ value: 't', label: 'Ton (weight)' },             // tona
```

**Acceptance:** New tenant z `seedDefaults` dostaje 42 jednostek (40 + 2 nowe).

**Estymata:** 0.5 h (1 commit do `lib/seeds.ts`).

### Gap 2 — Polskie labele i symbole

Aktualnie label jest English-only. Kilka opcji:

**Option A — i18n overlay (recommended):**
- Zostawić `value` po angielsku (stable identifier)
- Dodać i18n keys `catalog.unit.{value}.label` i `catalog.unit.{value}.short`
- Frontend renderuje translated label
- Zaleta: globalnie skalowalne, każdy język może mieć swoje
- Wada: backend nadal zwraca angielski label w API (jeśli nie wpina się i18n)

**Option B — Per-tenant override w dictionary (less recommended):**
- Tenant admin może edytować label dictionary entries
- Zaleta: granularność per-tenant
- Wada: każdy tenant musi sam ustawić; brak globalnego standardu

**Option C — Polish seed jako default (simple but coupled):**
- Zmienić seed żeby od razu zawierał Polish labele
- Zaleta: prosto
- Wada: łamie i18n contract (label jest data, nie i18n string)

**Rekomendacja: Option A** — symbol `m²`, `m³`, `szt.`, `kpl.`, `t`, `mb`, `h` jako i18n keys.

i18n example:

```json
// packages/core/src/modules/catalog/i18n/pl.json
{
  "catalog.unit.pc.label": "Sztuka",
  "catalog.unit.pc.short": "szt.",
  "catalog.unit.set.label": "Komplet",
  "catalog.unit.set.short": "kpl.",
  "catalog.unit.pkg.label": "Opakowanie",
  "catalog.unit.pkg.short": "opak.",
  "catalog.unit.kg.label": "Kilogram",
  "catalog.unit.kg.short": "kg",
  "catalog.unit.t.label": "Tona",
  "catalog.unit.t.short": "t",
  "catalog.unit.m.label": "Metr",
  "catalog.unit.m.short": "m",
  "catalog.unit.mb.label": "Metr bieżący",
  "catalog.unit.mb.short": "mb",
  "catalog.unit.m2.label": "Metr kwadratowy",
  "catalog.unit.m2.short": "m²",
  "catalog.unit.m3.label": "Metr sześcienny",
  "catalog.unit.m3.short": "m³",
  "catalog.unit.hour.label": "Godzina",
  "catalog.unit.hour.short": "h"
}
```

**Estymata:** 1 h (i18n keys w 4 locales + helper `formatUnitShort(unitValue)`).

### Gap 3 — UI używania label.short na quote lines

W `LineItemDialog` / `ItemsSection` w sales documents, w PDF — wszędzie gdzie wyświetlana jest jednostka — powinna iść `short` form (np. "szt.", "m²"), nie `value` (np. `pc`, `m2`).

```typescript
// helper
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function useUnitDisplay() {
  const t = useT()
  return useCallback((unitValue: string): string => {
    return t(`catalog.unit.${unitValue}.short`, unitValue)
  }, [t])
}

// usage in component
const formatUnit = useUnitDisplay()
<Text>{formatUnit(line.unit)}</Text>  // "szt." zamiast "pc"
```

**Estymata:** 1 h (helper + integracja w 3-4 miejscach: LineItemDialog, ItemsSection, PDF LinesTable).

## Re-estymata

Total dla PL units configuration:

| Zadanie | h |
|---|---|
| Dodać `mb` + `t` do seeds | 0.5 h |
| i18n keys (PL/EN/DE/ES) dla unit shorts | 1 h |
| Helper `useUnitDisplay()` + integracja | 1 h |
| Tests (idempotent re-seed, helper rendering) | 0.5 h |
| **Razem** | **3 h** |

## Backward compatibility

**Additive:**
- Nowe wartości seeds (`mb`, `t`) — istniejący tenanci dostaną na re-seed
- Nowe i18n keys — bez zmian istniejących
- Helper `useUnitDisplay` — nowy export

Per `BACKWARD_COMPATIBILITY.md` żadna powierzchnia kontraktu nie naruszona.

## Włączenie do Week 2

Ten audit dorzuca **3 h pracy** do Tygodnia 2 (oryginalna estymata 8 h → ~11 h). Zaktualizuję per-phase spec Tygodnia 2 o:

- W2.S2.2: Add `mb` + `t` to catalog unit seeds (Phase 5 in Week 2 spec)
- W2.S2.2: Polish i18n shorts for all units used in MVP
- W2.S2.2: `useUnitDisplay()` helper + integration

Plik do touchu (dorzuć do Week 2 spec):

```
packages/core/src/modules/catalog/lib/seeds.ts        (+ 2 entries)
packages/core/src/modules/catalog/lib/unitDisplay.ts  (NEW)
packages/core/src/modules/catalog/i18n/{pl,en,de,es}.json  (+ ~40 keys: 20 units × 2 keys)
packages/core/src/modules/sales/components/documents/LineItemDialog.tsx  (use useUnitDisplay)
packages/core/src/modules/sales/components/documents/ItemsSection.tsx  (use useUnitDisplay)
packages/core/src/modules/sales/pdf/components/LinesTable.tsx  (use useUnitDisplay) — Week 5
```

## Sources

- `packages/core/src/modules/catalog/lib/seeds.ts` (DEFAULT_UNITS array)
- `packages/core/src/modules/catalog/setup.ts` (seedCatalogUnits)
- `packages/core/src/modules/catalog/data/entities.ts` (CatalogProductUnitConversion entity)
- EPIC plan S2.2 wymagania (Tydzień 2 ma: szt., kpl., m, mb, m², m³, kg, t, h)
