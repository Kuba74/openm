# MVP-S Week 2 — Polish Sales Configuration

**Status:** Draft (depends on Week 1 PR merge)
**Created:** 2026-05-03
**Target window:** 06.05 – 12.05.2026 (Week 2 of May MVP-S)
**Author:** Kuba74
**Parent spec:** [2026-05-03-partner-master-migration.md](2026-05-03-partner-master-migration.md)
**Companion audits:** [ANALYSIS-2026-05-03-mvp-s-week-2-readiness.md](analysis/ANALYSIS-2026-05-03-mvp-s-week-2-readiness.md), [ANALYSIS-2026-05-03-catalog-pl-readiness.md](analysis/ANALYSIS-2026-05-03-catalog-pl-readiness.md)
**Estimated:** ~11 h (8 h core PL VAT/numbering/currency + 3 h catalog units PL)

## TLDR

Add Polish-specific configuration on top of openm's existing sales infrastructure: 5 PL VAT rates (23/8/5/0/zw with `is_exempt` distinction), Polish document numbering formats (OF/ZS/FV/KOR/KFV), and PLN as default currency per tenant. All purely additive — no entity rename, no breaking changes.

## Decisions (ratified 2026-05-03)

- **D1 — VAT zwolnione (zw):** Option A — new boolean column `is_exempt: bool default false` on `sales_tax_rates`. Distinguishes `vat-zw` (zwolnione, completely outside VAT) from `vat-0` (0% rate but inside VAT system, e.g. exports/WDT).
- **D2 — Quote number format:** `OF/{yyyy}/{seq:5}` (5-digit sequence cap = 99999/year)
- **D3 — Update ALL document kind defaults to PL formats:** OF/ZS/FV/KOR/KFV
- **D4 — Default currency:** hardcoded `'PLN'` in `onTenantCreated`. Refactor to country-aware in Phase 8.

## Stories in scope

### S2.1 — PL VAT rates seed + `is_exempt` column

**Goal:** seed all 5 Polish VAT rates with semantic distinction between zero-rated and exempt.

**Schema change:**

```typescript
// packages/core/src/modules/sales/data/entities.ts (SalesTaxRate)
@Property({ name: 'is_exempt', type: 'boolean', default: false })
isExempt: boolean = false
```

**Seed update:**

```typescript
// packages/core/src/modules/sales/setup.ts
const DEFAULT_TAX_RATES = [
  { code: 'vat-23',  name: '23% VAT',          rate: '23', countryCode: 'PL', isDefault: true,  isExempt: false },
  { code: 'vat-8',   name: '8% VAT',           rate: '8',  countryCode: 'PL', isDefault: false, isExempt: false },
  { code: 'vat-5',   name: '5% VAT',           rate: '5',  countryCode: 'PL', isDefault: false, isExempt: false },
  { code: 'vat-0',   name: '0% VAT',           rate: '0',  countryCode: 'PL', isDefault: false, isExempt: false },
  { code: 'vat-zw',  name: 'Zwolnione (zw.)',  rate: '0',  countryCode: 'PL', isDefault: false, isExempt: true  },
] as const
```

**`taxCalculationService` update:**

```typescript
// packages/core/src/modules/sales/services/taxCalculationService.ts
// In computeTaxBreakdown / similar:
if (taxRate.isExempt) {
  // Skip line from VAT total — but DO include in net total
  // The line still appears on invoice with rate label "zw."
  return { lineNet, lineVat: 0, lineGross: lineNet }
}
```

**Acceptance:**
- New tenant gets 5 PL VAT rates seeded with `vat-23` as default
- Existing tenant gets new rates added via idempotent `seedSalesTaxRates` (existing rates respected)
- Line with `vat-zw` doesn't add to VAT total but does add to net/gross
- Line with `vat-0` adds 0 to VAT total (taxable, just zero rate)
- Unit test for `taxCalculationService` covering exempt skip case
- UI in `/backend/config/sales` shows all 5 rates with "Zwolnione" badge for exempt

**Estimate:** 2 h

### S2.2 — Polish document numbering formats

**Goal:** replace generic `QUOTE-{yyyy}{mm}{dd}-{seq:5}` defaults with PL business conventions.

**New defaults:**

```typescript
// packages/core/src/modules/sales/lib/documentNumberTokens.ts
export const DEFAULT_QUOTE_NUMBER_FORMAT       = 'OF/{yyyy}/{seq:5}'           // Oferta
export const DEFAULT_ORDER_NUMBER_FORMAT       = 'ZS/{yyyy}/{seq:5}'           // Zamówienie sprzedaży
export const DEFAULT_INVOICE_NUMBER_FORMAT     = 'FV/{yyyy}/{mm}/{seq:5}'      // Faktura (month-scoped per JPK_V7)
export const DEFAULT_RETURN_NUMBER_FORMAT      = 'KOR/{yyyy}/{seq:5}'          // Korekta
export const DEFAULT_CREDIT_MEMO_NUMBER_FORMAT = 'KFV/{yyyy}/{mm}/{seq:5}'     // Korekta faktury (month-scoped)
```

**Notes:**
- Invoice + credit memo are month-scoped (`{yyyy}/{mm}/`) per JPK_V7 monthly reporting requirement
- Sequence is per (org, tenant, kind) — independent across years/months
- Existing tenants keep their current format (no migration of `SalesSettings`)
- New tenants get PL defaults via `onTenantCreated` in `setup.ts`

**`SalesSettings` table — verify column coverage:**

Currently has `orderNumberFormat` and `quoteNumberFormat`. The other 3 (invoice/return/credit_memo) are read from constants (no per-tenant override). Decision: extend `SalesSettings` to cover all 5 kinds:

```typescript
@Property({ name: 'invoice_number_format', type: 'text', default: DEFAULT_INVOICE_NUMBER_FORMAT })
invoiceNumberFormat: string = DEFAULT_INVOICE_NUMBER_FORMAT

@Property({ name: 'return_number_format', type: 'text', default: DEFAULT_RETURN_NUMBER_FORMAT })
returnNumberFormat: string = DEFAULT_RETURN_NUMBER_FORMAT

@Property({ name: 'credit_memo_number_format', type: 'text', default: DEFAULT_CREDIT_MEMO_NUMBER_FORMAT })
creditMemoNumberFormat: string = DEFAULT_CREDIT_MEMO_NUMBER_FORMAT
```

**`salesDocumentNumberGenerator` update:**
- Read from new columns (with fallback to constants for backwards compat with existing tenants who don't have the columns populated)

**UI update:**
- `/backend/config/sales` page should expose all 5 format inputs
- Translation keys `sales.config.numberFormat.{quote,order,invoice,return,credit_memo}`

**Acceptance:**
- New tenant's first quote = `OF/2026/00001`
- New tenant's first invoice in May = `FV/2026/05/00001`
- Existing tenant unchanged
- UI lets admin override per kind
- `salesDocumentNumberGenerator` test for new formats

**Estimate:** 3 h

### S2.3 — Default currency per tenant

**Goal:** ensure quotes/orders/invoices have a sensible currency fallback, not NULL.

**Schema change:**

```typescript
// packages/core/src/modules/sales/data/entities.ts (SalesSettings)
@Property({ name: 'default_currency_code', type: 'text', nullable: true })
defaultCurrencyCode?: string | null
```

**Setup hook update:**

```typescript
// packages/core/src/modules/sales/setup.ts
async onTenantCreated({ em, tenantId, organizationId }) {
  const exists = await em.findOne(SalesSettings, { tenantId, organizationId })
  if (!exists) {
    em.persist(em.create(SalesSettings, {
      tenantId,
      organizationId,
      orderNumberFormat: DEFAULT_ORDER_NUMBER_FORMAT,
      quoteNumberFormat: DEFAULT_QUOTE_NUMBER_FORMAT,
      invoiceNumberFormat: DEFAULT_INVOICE_NUMBER_FORMAT,
      returnNumberFormat: DEFAULT_RETURN_NUMBER_FORMAT,
      creditMemoNumberFormat: DEFAULT_CREDIT_MEMO_NUMBER_FORMAT,
      defaultCurrencyCode: 'PLN',                                 // NEW
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  }
}
```

**Helper:**

```typescript
// packages/core/src/modules/sales/lib/defaultCurrency.ts
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesSettings } from '../data/entities'

export async function getDefaultCurrency(
  em: EntityManager,
  scope: { organizationId: string; tenantId: string },
): Promise<string> {
  const settings = await em.findOne(SalesSettings, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return settings?.defaultCurrencyCode ?? 'PLN'
}
```

**Quote/Order create logic update (commands or API factory):**

Lookup chain when creating a new document:

```
final_currency = payload.currency_code
              ?? customerBilling.preferredCurrency       // from Week 1 helper
              ?? salesSettings.defaultCurrencyCode       // this story
              ?? 'PLN'                                   // hardcoded fallback
```

**UI update:**
- `/backend/config/sales` adds "Default currency" selector (populated from `currencies` module)
- Quote form shows pre-selected currency from chain above

**Acceptance:**
- New PL tenant has `defaultCurrencyCode='PLN'` after `seedDefaults`
- Quote without explicit currency → falls back via chain
- Existing quotes unchanged (currencyCode is column on each document)
- Helper `getDefaultCurrency()` returns correct value with PLN fallback
- Unit test covers all 4 fallback levels

**Estimate:** 3 h

### S2.4 — Polskie jednostki + i18n shorts (3 h)

Per [catalog audit](analysis/ANALYSIS-2026-05-03-catalog-pl-readiness.md) — dodać brakujące PL units i i18n shorts.

**Brakuje w `catalog/lib/seeds.ts`:**

```typescript
// Dodać do UNIT_DEFAULTS:
{ value: 'mb', label: 'Running Meter (length)' },  // metr bieżący — typowo PL w budownictwie
{ value: 't', label: 'Ton (weight)' },             // tona
```

**i18n shorts** w `catalog/i18n/{pl,en,de,es}.json` pod `catalog.unit.{value}.short`:

```json
// pl.json
"catalog.unit.pc.short": "szt.",
"catalog.unit.set.short": "kpl.",
"catalog.unit.kg.short": "kg",
"catalog.unit.t.short": "t",
"catalog.unit.m.short": "m",
"catalog.unit.mb.short": "mb",
"catalog.unit.m2.short": "m²",
"catalog.unit.m3.short": "m³",
"catalog.unit.hour.short": "h"
```

**Helper** `catalog/lib/unitDisplay.ts`:

```typescript
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useCallback } from 'react'

export function useUnitDisplay() {
  const t = useT()
  return useCallback(
    (unitValue: string): string => t(`catalog.unit.${unitValue}.short`, unitValue),
    [t]
  )
}
```

**Integracja:**
- `sales/components/documents/LineItemDialog.tsx` — selector jednostki używa `useUnitDisplay()`
- `sales/components/documents/ItemsSection.tsx` — kolumna J.M. wyświetla short form
- `sales/pdf/components/LinesTable.tsx` (Week 5) — same

**Acceptance:**
- Lista quotes pokazuje "10 szt." zamiast "10 pc"
- Selector jednostek pokazuje polskie skróty z fallback'iem na value
- New tenant z seed `Catalog units: 42` (40 + mb + t)
- Idempotent re-seed — istniejące tenanty dostają nowe wartości bez duplikatów

**Estimate:** 3 h

## Files to touch

| Path | Action |
|---|---|
| `packages/core/src/modules/sales/data/entities.ts` | + `is_exempt` on `SalesTaxRate`; + `default_currency_code`, `invoice_number_format`, `return_number_format`, `credit_memo_number_format` on `SalesSettings` |
| `packages/core/src/modules/sales/lib/documentNumberTokens.ts` | Update 5 `DEFAULT_*_NUMBER_FORMAT` constants to PL values |
| `packages/core/src/modules/sales/lib/defaultCurrency.ts` | NEW — `getDefaultCurrency()` helper |
| `packages/core/src/modules/sales/setup.ts` | Update `DEFAULT_TAX_RATES` to 5 entries; populate new `SalesSettings` columns in `onTenantCreated` |
| `packages/core/src/modules/sales/services/taxCalculationService.ts` | Skip `is_exempt=true` rates from VAT total |
| `packages/core/src/modules/sales/services/salesDocumentNumberGenerator.ts` | Read from `SalesSettings.{invoice,return,creditMemo}NumberFormat` (fallback to constants) |
| `packages/core/src/modules/sales/api/quotes/route.ts` (and similar) | Wire currency fallback chain on create |
| `packages/core/src/modules/sales/backend/config/sales/page.tsx` | + UI for new fields (5 number formats, default currency, exempt badge) |
| `packages/core/src/modules/sales/migrations/MigrationYYYYMMDDHHMMSS.ts` | generated |
| `packages/core/src/modules/sales/__tests__/seedTaxRates.test.ts` | NEW (idempotent re-seed; PL VAT rate count) |
| `packages/core/src/modules/sales/services/__tests__/taxCalculationService.test.ts` | + exempt skip test |
| `packages/core/src/modules/sales/services/__tests__/salesDocumentNumberGenerator.test.ts` | + PL format tests (OF/ZS/FV/KOR/KFV) |
| `packages/core/src/modules/sales/lib/__tests__/defaultCurrency.test.ts` | NEW |
| `packages/core/src/modules/sales/i18n/{pl,en,de,es}.json` | + labels: `vat-zw` "Zwolnione" badge, "Default currency", 3 new format inputs |

## Backward compatibility

All changes are **additive**:

- New nullable/default-valued columns on existing entities
- New seed entries via idempotent `ensureSalesTaxRate` pattern (existing entries respected)
- Format constants change but only affect NEW tenants
- Existing tenants' `SalesSettings` rows unchanged (their custom formats win)
- Helper functions are new (no rename)
- `taxCalculationService` exempt-skip is logically equivalent to "rate=0%" for legacy data without `is_exempt` column (default false)

Per `BACKWARD_COMPATIBILITY.md`:
- Surface 8 (DB schema): additive only — new columns, no removal/rename ✅
- Surface 5 (Event IDs): no event changes ✅
- Surface 7 (API URLs): no API changes ✅
- Surface 13 (Generated files): `entities.generated.ts` grows additively ✅

## Dependency on Week 1

**This Week 2 PR depends on Week 1 PR (and transitively Phase 1 PR #1)** because:

- S2.3 references `customer_company_billing.preferredCurrency` (Phase 1)
- S2.3 lookup chain references the helper `getDefaultCurrency` from Week 1's `customer_company_billing.salesOwnerUserId` companion helper
- (Acceptable to merge Week 2 PR independently if Week 1 missing — fallback chain just skips that level)

Branch base: `feat/partner-master-mvp-s-week-1-foundation` (stacked on top of Week 1) when Week 1 is in review; rebase to `develop` after Week 1 merges.

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| W2.1 | Existing tenant's quote number jumps from `QUOTE-...` to `OF/...` mid-year | Low | Default constants only affect NEW tenants. Existing tenants keep their override. UI lets admin migrate when ready. |
| W2.2 | `vat-zw` interpretation differs from accountant expectation in JPK_V7 export | Medium | Add `is_exempt` early; refine in Phase 8 (full JPK_V7 module). MVP just needs UI rendering as "zw." |
| W2.3 | `salesDocumentNumberGenerator` needs to read from new SalesSettings columns but old tenants don't have them populated yet | Low | Fallback to constants when DB column is NULL/empty (defensive read) |
| W2.4 | Currency lookup chain causes infinite recursion if Week 1 helper not landed | Low | Use `??` short-circuit, never throws; final fallback = `'PLN'` literal |
| W2.5 | `seedSalesTaxRates` runs on existing tenants and adds `vat-8` etc. they didn't want | Low | Idempotent (skip existing codes). User can soft-delete unwanted rates after via UI. |

## Validation gate (mandatory before PR)

```bash
yarn build:packages
yarn generate
yarn db:generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
```

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Schema additions (3 h)

- [ ] 1.1 `is_exempt` column on `SalesTaxRate`
- [ ] 1.2 `default_currency_code` + 3 number format columns on `SalesSettings`
- [ ] 1.3 Run `yarn db:generate` (locally) and commit migration
- [ ] 1.4 Verify migration is reversible

### Phase 2: PL VAT seed + tax calculation (2 h)

- [ ] 2.1 Update `DEFAULT_TAX_RATES` in `setup.ts` to 5 PL entries with `country_code='PL'`
- [ ] 2.2 Update `seedSalesTaxRates` to handle `is_exempt`
- [ ] 2.3 Update `taxCalculationService` to skip exempt lines from VAT
- [ ] 2.4 Unit tests: idempotency + exempt skip + 5-rate count
- [ ] 2.5 i18n: "Zwolnione" badge, rate labels in PL/EN/DE/ES

### Phase 3: PL number formats (3 h)

- [ ] 3.1 Update 5 `DEFAULT_*_NUMBER_FORMAT` constants to OF/ZS/FV/KOR/KFV
- [ ] 3.2 Update `onTenantCreated` to populate new SalesSettings columns
- [ ] 3.3 Update `salesDocumentNumberGenerator` to read from SalesSettings (fallback to constants)
- [ ] 3.4 UI in `/backend/config/sales` for all 5 format inputs
- [ ] 3.5 Unit tests for each format
- [ ] 3.6 i18n keys for new UI labels

### Phase 4: Default currency (3 h)

- [ ] 4.1 `getDefaultCurrency()` helper + unit tests
- [ ] 4.2 `onTenantCreated` sets `defaultCurrencyCode='PLN'`
- [ ] 4.3 Wire currency fallback chain in quote/order/invoice create
- [ ] 4.4 UI selector in `/backend/config/sales`
- [ ] 4.5 Unit test all 4 fallback levels

### Phase 5: PL units + i18n shorts (3 h)

- [ ] 5.1 Add `mb` + `t` to `UNIT_DEFAULTS` in `catalog/lib/seeds.ts`
- [ ] 5.2 i18n shorts dla wszystkich units używanych w MVP (catalog/i18n/{pl,en,de,es}.json)
- [ ] 5.3 NEW `catalog/lib/unitDisplay.ts` z `useUnitDisplay()` hook
- [ ] 5.4 Integracja w `LineItemDialog.tsx` + `ItemsSection.tsx`
- [ ] 5.5 Test: idempotent re-seed (40 → 42 units bez duplikatów)

### Phase 6: Validation gate + PR (1 h)

- [ ] 6.1 Full validation gate locally
- [ ] 6.2 Open PR (base = Week 1 branch if not merged, else develop)
- [ ] 6.3 Apply labels: `review`, `feature`, `needs-qa`

## Changelog

- 2026-05-03 — Initial spec created (Kuba74). Decisions D1-D4 ratified. ~8 h estimate.
