# MVP-S Week 2 Readiness — Sales Catalog Wiring

**Date:** 2026-05-03
**Target window:** 06.05 – 12.05.2026 (Week 2 of May MVP-S)
**Companion to:** [2026-05-03-partner-master-migration.md](../2026-05-03-partner-master-migration.md), [2026-05-03-openm-sales-readiness.md](ANALYSIS-2026-05-03-openm-sales-readiness.md)
**Status:** Audit complete — ready for spec

## TLDR

Week 2 closes the Polish-specific configuration on top of openm's existing sales infrastructure. Three areas require action:
1. **VAT rates** — current seed has only `vat-23` + `vat-0`; PL needs **5 stawki** (23/8/5/0/zw)
2. **Document numbering** — current defaults `QUOTE-{yyyy}{mm}{dd}-{seq:5}` / `ORDER-...`; EPIC plan calls for `OF/{yyyy}/{seq:4}` (e.g. `OF/2026/0001`)
3. **Default currency** — PLN is seeded as one of three currencies, but no `defaultCurrency` is configured per tenant; quotes can ship with NULL currency

Estimated effort: **~8 h** (was 40 h in original EPIC plan — confirmed re-estimate from sales readiness audit).

## What's already there

### `sales_tax_rates` entity ✅

Full entity with `code`, `name`, `rate` (numeric 7,4), `country_code`, `region_code`, `postal_code`, `city`, `isDefault`, `isCompound`, `priority`. Unique on (organizationId, tenantId, code).

Current seed in [packages/core/src/modules/sales/setup.ts](../../packages/core/src/modules/sales/setup.ts):

```typescript
const DEFAULT_TAX_RATES = [
  { code: 'vat-23', name: '23% VAT', rate: '23' },
  { code: 'vat-0',  name: '0% VAT',  rate: '0' },
] as const
```

### `sales_document_sequences` entity + numbering generator ✅

Fully tokenized number generator in [packages/core/src/modules/sales/lib/documentNumberTokens.ts](../../packages/core/src/modules/sales/lib/documentNumberTokens.ts):

| Token | Description |
|---|---|
| `{yyyy}` | 4-digit year (2026) |
| `{yy}` | 2-digit year (26) |
| `{mm}` | Month padded (05) |
| `{dd}` | Day padded (03) |
| `{hh}` | Hour 24h |
| `{seq}` | Sequence per (org, tenant, kind), e.g. `{seq:5}` pads to 5 digits |
| `{rand}` | Random numeric block, default 4 digits |
| `{nanoid}` | Nano ID (default 12 chars) |
| `{guid}` | UUID v4 |
| `{kind}` | Document kind label |

Current defaults:

```typescript
DEFAULT_QUOTE_NUMBER_FORMAT     = 'QUOTE-{yyyy}{mm}{dd}-{seq:5}'   // QUOTE-20260503-00001
DEFAULT_ORDER_NUMBER_FORMAT     = 'ORDER-{yyyy}{mm}{dd}-{seq:5}'
DEFAULT_INVOICE_NUMBER_FORMAT   = 'INV-{yyyy}{mm}{dd}-{seq:5}'
DEFAULT_RETURN_NUMBER_FORMAT    = 'RET-{yyyy}{mm}{dd}-{seq:5}'
DEFAULT_CREDIT_MEMO_NUMBER_FORMAT = 'CM-{yyyy}{mm}{dd}-{seq:5}'
```

`SalesDocumentNumberKind`: `'quote' | 'order' | 'return' | 'invoice' | 'credit_memo'`.

### Currencies module ✅

Seed in [packages/core/src/modules/currencies/lib/seeds.ts](../../packages/core/src/modules/currencies/lib/seeds.ts):

```typescript
{ code: 'PLN', name: 'Polish Zloty', decimalPlaces: 2, symbol: 'zł',
  decimalSeparator: ',', thousandsSeparator: ' ' }
{ code: 'EUR', ... }
{ code: 'USD', ... }
```

Quote/Order/Invoice entities all have `currency_code: text` field (mostly required, some nullable).

`SalesSettings` entity stores per-(org, tenant) defaults: `orderNumberFormat`, `quoteNumberFormat`. **No** `defaultCurrencyCode` column yet.

## Gaps for Week 2

### Gap 1 — Missing VAT rates (PL)

**Required:**

```typescript
const PL_VAT_RATES = [
  { code: 'vat-23',  name: '23% VAT',  rate: '23',  isDefault: true,  countryCode: 'PL' },
  { code: 'vat-8',   name: '8% VAT',   rate: '8',   isDefault: false, countryCode: 'PL' },
  { code: 'vat-5',   name: '5% VAT',   rate: '5',   isDefault: false, countryCode: 'PL' },
  { code: 'vat-0',   name: '0% VAT',   rate: '0',   isDefault: false, countryCode: 'PL' },
  { code: 'vat-zw',  name: 'Zwolnione (zw.)', rate: '0', isDefault: false, countryCode: 'PL', isExempt: true },
] as const
```

**Notes:**
- `vat-zw` (zwolnione = exempt) requires either:
  - **Option A:** New boolean column `is_exempt` on `sales_tax_rates` to differentiate from `vat-0` (0% but taxable, e.g. WDT/eksport)
  - **Option B:** Use `code='vat-zw'` + `rate='0'` and rely on UI/PDF to render "zw." instead of "0%"
- **Recommendation: Option A** — semantic correctness, future-proof for SAFT/JPK_V7 export

**Implementation:**
1. Add `is_exempt: boolean default false` column to `SalesTaxRate` entity
2. Update `setup.ts` `DEFAULT_TAX_RATES` to PL_VAT_RATES (above)
3. Add `country_code: 'PL'` to seed entries
4. Migrate existing tenants via `setup.ts` idempotent path (`seedSalesTaxRates`)
5. Update `taxCalculationService.ts` to skip exempt rates from VAT total (just skip line)

**Acceptance:**
- New tenant gets 5 PL VAT rates seeded
- Existing tenant adds missing rates without overwriting customizations
- `vat-zw` lines don't add to VAT total but appear on PDF as "zw."

**Estimate:** 2 h

### Gap 2 — Polish document numbering format

**Required (EPIC plan S3.2):** `OF/{yyyy}/{seq:4}` → `OF/2026/0001`

Current `DEFAULT_QUOTE_NUMBER_FORMAT` = `'QUOTE-{yyyy}{mm}{dd}-{seq:5}'` is too long for PL business documents.

**Decision required:**

| Option | Format | Pros | Cons |
|---|---|---|---|
| A | `OF/{yyyy}/{seq:4}` | Matches EPIC plan, short, common in PL ERPs | Breaks at 10000 quotes/year |
| B | `OF/{yyyy}/{seq:5}` | Same shape, 99999 cap | Slightly longer |
| C | `OF/{yyyy}/{mm}/{seq:3}` | Resets per month, granular | More complex, 3-digit seq=999/mo cap |
| D | Configurable per tenant with PL defaults | Flexible | Same default needed |

**Recommendation: Option B** — `OF/{yyyy}/{seq:5}` (5-digit seq for safety) as DEFAULT_QUOTE_NUMBER_FORMAT.

For other documents (PL invoices have legal numbering requirements):
- Quote: `OF/{yyyy}/{seq:5}` (oferta)
- Order: `ZS/{yyyy}/{seq:5}` (zamówienie sprzedaży)
- Invoice: `FV/{yyyy}/{mm}/{seq:5}` (faktura — month-scoped per JPK_V7)
- Return: `KOR/{yyyy}/{seq:5}` (korekta)
- Credit memo: `KFV/{yyyy}/{mm}/{seq:5}` (korekta faktury)

**Implementation:**
1. Update `DEFAULT_QUOTE_NUMBER_FORMAT`, `DEFAULT_ORDER_NUMBER_FORMAT`, etc. constants
2. Existing tenants: leave their `SalesSettings.*Format` alone (per-tenant override)
3. New tenants get PL defaults via `onTenantCreated` in `setup.ts`
4. Add UI for tenant admin to override format (already exists at `/backend/config/sales` — verify it surfaces all 5 kinds, not just quote/order)

**Acceptance:**
- New tenant's first quote = `OF/2026/00001`
- Existing tenant unchanged (no breaking)
- UI lets admin override per kind
- `salesDocumentNumberGenerator` test for new format

**Estimate:** 3 h

### Gap 3 — Default currency per tenant

**Required:** `SalesSettings.defaultCurrencyCode = 'PLN'` for new PL tenants. Auto-fill on quote/order create when none specified.

**Implementation:**

1. Add column to `SalesSettings`:
   ```typescript
   @Property({ name: 'default_currency_code', type: 'text', nullable: true })
   defaultCurrencyCode?: string | null
   ```
2. Update `onTenantCreated` in `setup.ts` to set `defaultCurrencyCode: 'PLN'`
3. In quote/order create logic: if `currency_code` not provided in payload, fall back to `SalesSettings.defaultCurrencyCode`
4. UI in `/backend/config/sales` for changing default
5. Optionally: helper `getDefaultCurrency(em, scope) → string`

**Acceptance:**
- New PL tenant has `defaultCurrencyCode='PLN'` after `seedDefaults`
- Quote without explicit currency → falls back to PLN
- Existing quotes unchanged (currencyCode is column on each document)

**Estimate:** 3 h

## Dependency on customer module

**S2** stories (catalog wiring) work independently of partner master. But:

- **Customer billing helper from Week 1** (`getDefaultCurrency(companyId)`) should be added to `customer_company_billing.preferredCurrency` lookup chain. Quote create logic:
  ```
  payload.currency_code
    ?? customerBilling.preferredCurrency
    ?? salesSettings.defaultCurrencyCode
    ?? 'PLN'  // hardcoded final fallback
  ```

This matches Week 3 wiring (S3.3 — Tworzenie nagłówka oferty: pre-fill warunki/walutę z klienta).

## Backward compatibility

All changes are **additive**:
- New columns nullable (`is_exempt`, `default_currency_code`)
- New seed entries don't replace existing (idempotent `ensure*` pattern)
- Existing tenants keep their custom format/rates
- No API changes, no entity rename, no event ID changes

Per `BACKWARD_COMPATIBILITY.md` no surface broken.

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| W2.1 | Existing tenant's format `QUOTE-...` doesn't change to `OF/...` (no migration of existing customers' settings) | Low | Documented behavior. UI lets admin update manually. |
| W2.2 | `vat-zw` semantics tricky — accountant may want different behavior in JPK_V7 | Medium | Add `is_exempt: boolean` early; refine for JPK in Phase 8 |
| W2.3 | `customerBilling.preferredCurrency` might already be set, conflicting with new tenant default | Low | Lookup order respects per-customer override (correct precedence) |
| W2.4 | First quote of 2026 = `OF/2026/00001` — but if migrating mid-year, sequence resets weirdly | Low | Sequences are per-(org, tenant, kind) — independent across years |

## Pre-implementation queries (for user to run after Week 1 lands)

```sql
-- Check existing tenants' tax rates
SELECT organization_id, tenant_id, code, rate, is_default
FROM sales_tax_rates
WHERE deleted_at IS NULL
ORDER BY organization_id, tenant_id, priority;

-- Check existing format settings
SELECT organization_id, tenant_id, quote_number_format, order_number_format
FROM sales_settings
WHERE deleted_at IS NULL OR deleted_at IS NULL;
```

## Re-estimate vs original EPIC plan

| Story | Original EPIC | After audit |
|---|---|---|
| S2.1 Catalog produktów | 16 h | **0 h** (catalog module exists, only seed verification needed in Week 3) |
| S2.2 Jednostki miary | 8 h | **0 h** (catalog_product_unit_conversions exists, seed is part of catalog setup) |
| S2.3 Stawki VAT | 8 h | 2 h (above) |
| Document numbering | (in S3.2 Week 3) | 3 h (better to do now) |
| Default currency | (implicit) | 3 h |
| **Razem Tydzień 2** | 40 h | **8 h** |

**Slack: ~32 h** in Week 2. Use for:
- Audit catalog module's PL seed gaps (units in PL)
- Optional: prepare Week 3 audit (UI for quotes/customers)
- Buffer for Week 1 overflow

## Files to touch

| Path | Action |
|---|---|
| `packages/core/src/modules/sales/data/entities.ts` | + `is_exempt` on `SalesTaxRate`, + `default_currency_code` on `SalesSettings` |
| `packages/core/src/modules/sales/setup.ts` | Update `DEFAULT_TAX_RATES` to 5 entries (PL VAT), set `defaultCurrencyCode='PLN'` in `onTenantCreated` |
| `packages/core/src/modules/sales/lib/documentNumberTokens.ts` | Update `DEFAULT_*_NUMBER_FORMAT` to PL formats |
| `packages/core/src/modules/sales/services/taxCalculationService.ts` | Skip `is_exempt=true` rates from VAT total |
| `packages/core/src/modules/sales/migrations/MigrationYYYYMMDDHHMMSS.ts` | generated |
| `packages/core/src/modules/sales/__tests__/seedTaxRates.test.ts` | NEW (idempotency, PL VAT count) |
| `packages/core/src/modules/sales/services/__tests__/taxCalculationService.test.ts` | + exempt-rate skip case |
| `packages/core/src/modules/sales/services/__tests__/salesDocumentNumberGenerator.test.ts` | + `OF/{yyyy}/{seq:5}` format check |
| `packages/core/src/modules/sales/i18n/{pl,en,de,es}.json` | + labels for new VAT rates, exempt UI |

## Decision points before implementation

1. **`vat-zw` modeling:** Option A (`is_exempt: bool` column) vs Option B (rely on `code='vat-zw'` semantic) — **recommend A**
2. **Quote number format:** `OF/{yyyy}/{seq:5}` (recommended) vs `OF/{yyyy}/{seq:4}` (EPIC plan literal)
3. **Whether to also update Order/Invoice/Return/CreditMemo defaults** to PL formats — **recommend yes** (consistency)
4. **Default currency PLN hardcoded in `onTenantCreated`?** Or read from `Organization.countryCode` if present? — **recommend hardcoded for MVP**, refactor in Phase 8

## Action items

1. Confirm decisions 1-4 above
2. After Week 1 PR merges, write per-phase spec `2026-05-03-mvp-s-week-2-pl-sales-config.md` based on this audit
3. Run pre-implementation queries on user's tenant to surface any conflicting state

## Sources

- `packages/core/src/modules/sales/setup.ts` (current tax rate seed)
- `packages/core/src/modules/sales/lib/documentNumberTokens.ts` (current formats + tokens)
- `packages/core/src/modules/sales/data/entities.ts` (SalesSettings, SalesTaxRate, SalesDocumentSequence)
- `packages/core/src/modules/currencies/lib/seeds.ts` (PLN seed)
