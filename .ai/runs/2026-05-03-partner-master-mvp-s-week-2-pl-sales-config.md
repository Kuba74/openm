# Run plan — MVP-S Week 2: Polish Sales Configuration

**Date:** 2026-05-03
**Branch:** `feat/partner-master-mvp-s-week-2-pl-sales-config`
**Source spec:** [.ai/specs/2026-05-03-mvp-s-week-2-pl-sales-config.md](../specs/2026-05-03-mvp-s-week-2-pl-sales-config.md)
**Companion audits:**
- [.ai/specs/analysis/ANALYSIS-2026-05-03-mvp-s-week-2-readiness.md](../specs/analysis/ANALYSIS-2026-05-03-mvp-s-week-2-readiness.md)
- [.ai/specs/analysis/ANALYSIS-2026-05-03-catalog-pl-readiness.md](../specs/analysis/ANALYSIS-2026-05-03-catalog-pl-readiness.md)

## Goal

Add Polish-specific configuration on top of openm sales: 5 PL VAT rates (with `is_exempt` distinction), Polish document numbering formats (OF/ZS/FV/KOR/KFV), default currency PLN per tenant, plus catalog PL units (mb, t) and i18n unit shorts. All purely additive — no entity rename, no breaking changes.

## Scope

- New columns on `SalesTaxRate.is_exempt` (boolean, default false).
- New columns on `SalesSettings`: `default_currency_code`, `invoice_number_format`, `return_number_format`, `credit_memo_number_format` (all nullable / defaulted).
- 5 PL VAT rate seed entries (vat-23/8/5/0/zw with `country_code='PL'`, `is_exempt=true` for vat-zw).
- 5 new `DEFAULT_*_NUMBER_FORMAT` constants (OF/ZS/FV/KOR/KFV per spec D2/D3).
- `taxCalculationService` skip-exempt branch when resolving rate.
- `salesDocumentNumberGenerator` reads invoice/return/credit_memo formats from `SalesSettings` with constants fallback.
- `getDefaultCurrency()` helper + `onTenantCreated` populating new columns.
- UI in `/backend/config/sales` for 5 number formats + default currency selector + "Zwolnione" badge.
- Catalog PL units: `mb` + `t` in `UNIT_DEFAULTS`, i18n `catalog.unit.<value>.short` keys, `useUnitDisplay()` hook + integration in `LineItemDialog` + `ItemsSection`.

Non-goals:
- JPK_V7 export module (Phase 8).
- Rebuilding existing tenants' VAT rates or document number formats.
- PL unit `label` translations (only `.short` per audit recommendation, value remains stable identifier).
- Refactoring `defaultCurrency` to country-aware (Phase 8 per Decision D4).

## External References

None. No `--skill-url` provided.

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Migration generator unavailable in sandbox | Low | Commit explicit migration file alongside entity changes; document blocker in PR. |
| 2 | Existing tenants have legacy `QUOTE-*`/`ORDER-*` formats; constant change might surprise them | Low | Constants default for new tenants only; existing `SalesSettings` rows keep their stored format. |
| 3 | `vat-zw` semantics differ from accountant expectation in JPK_V7 export | Medium | `is_exempt` is logically equivalent to "skip from VAT total"; refine in Phase 8. |
| 4 | `salesDocumentNumberGenerator.peekSequences` typing change risks generator cache | Low | Keep return shape identical (`order/quote/return`); add invoice/credit_memo as additive optional fields. |
| 5 | Existing UI calls `loadDefaultCurrency()` from price-kinds API; introducing settings-based source may regress | Low | Preserve existing path as final fallback in chain; settings takes priority but only when populated. |

## Backward compatibility

All changes additive (per BC contract surface 8 — DB schema additive only):
- New nullable/defaulted columns.
- New seed entries via existing idempotent code-path (`existingMap.has(value)` skip).
- New constants only affect NEW tenants.
- Constants exported names unchanged (no rename).

## Implementation Plan

### Phase 1 — Schema additions
- Add `is_exempt` to `SalesTaxRate` entity (default false).
- Add 4 new columns to `SalesSettings`: `default_currency_code` nullable, `invoice_number_format`/`return_number_format`/`credit_memo_number_format` defaulted to constants.
- Run `yarn db:generate` (or hand-write migration mirroring entity additive changes if blocked).

### Phase 2 — PL VAT seed + tax calc exempt
- Update `DEFAULT_TAX_RATES` in `setup.ts` to 5 PL entries.
- Extend `seedSalesTaxRates` to populate `isExempt` and `countryCode='PL'`.
- Update `taxCalculationService.resolveRate` to read `isExempt` and short-circuit (rate=0, exempt flag true).
- Tests: `seedTaxRates.test.ts` (idempotency + count + exempt), update `taxCalculationService.test.ts`.
- i18n: `sales.taxRates.exempt` ("Zwolnione" / "Exempt" etc.) for badge.

### Phase 3 — PL number formats
- Update 5 `DEFAULT_*_NUMBER_FORMAT` constants to OF/ZS/FV/KOR/KFV.
- Wire new SalesSettings columns in `onTenantCreated`.
- Update `salesDocumentNumberGenerator.getSettings` to surface invoice/return/credit_memo formats; update `generate()` to read from settings with fallback.
- Extend `salesSettingsUpsertSchema` with new format fields (optional).
- Update `loadSalesSettings` and `sales.settings.save` command handler to persist.
- Update `DocumentNumberSettings.tsx` to expose 5 inputs.
- Update document-numbers route to return all 5 formats.
- Tests: extend or add new for generator covering all 5 kinds.
- i18n: keys for invoice/return/creditMemo labels.

### Phase 4 — Default currency
- New `lib/defaultCurrency.ts` with `getDefaultCurrency(em, scope)`.
- `onTenantCreated` sets `defaultCurrencyCode='PLN'`.
- API surface: extend `salesSettingsUpsertSchema` with `defaultCurrencyCode` (optional ISO 3-letter); persist via existing settings command.
- UI: surface selector under DocumentNumberSettings (or new section); pre-fill quote/order create form via fallback chain (`payload.currencyCode` → `customerBilling.preferredCurrency` (Week 1) → `salesSettings.defaultCurrencyCode` → `'PLN'`).
- Wire `loadDefaultCurrency()` to read `defaultCurrencyCode` via the settings GET payload before falling back to price-kinds (preserves legacy behavior).
- Tests: `defaultCurrency.test.ts` covering 4 fallback levels.

### Phase 5 — Catalog PL units
- Add `mb` + `t` to `UNIT_DEFAULTS` in `catalog/lib/seeds.ts`.
- Add `catalog.unit.<value>.short` keys for pc/set/kg/t/m/mb/m2/m3/hour to all 4 i18n locales (pl/en/de/es).
- New `catalog/lib/unitDisplay.ts` exporting `useUnitDisplay()`.
- Integrate in `sales/components/documents/LineItemDialog.tsx` (Select option label) and `ItemsSection.tsx` (table cell).
- Test: `catalog/lib/__tests__/seeds.test.ts` for idempotent re-seed (count check).

### Phase 6 — Validation gate + PR
- `yarn build:packages`, `yarn generate`, `yarn db:generate` if available, `yarn build:packages` again, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.
- Open PR `feat(sales): MVP-S Tydzień 2 — polskie konfiguracje (VAT/numeracja/waluta + catalog units)`.
- Apply labels `review`, `feature`, `needs-qa`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema additions

- [ ] 1.1 `is_exempt` column on `SalesTaxRate`
- [ ] 1.2 4 new columns on `SalesSettings` (default_currency_code, invoice/return/credit_memo number formats)
- [ ] 1.3 Run `yarn db:generate` (or hand-write migration if blocked)
- [ ] 1.4 Verify migration applies cleanly

### Phase 2: PL VAT seed + tax calculation

- [ ] 2.1 Update `DEFAULT_TAX_RATES` in `setup.ts` to 5 PL entries
- [ ] 2.2 Update `seedSalesTaxRates` to handle `isExempt` and `countryCode`
- [ ] 2.3 Update `taxCalculationService` to surface exempt flag in result
- [ ] 2.4 Unit tests: idempotency + exempt skip + 5-rate count
- [ ] 2.5 i18n: "Zwolnione" badge keys in PL/EN/DE/ES

### Phase 3: PL number formats

- [ ] 3.1 Update 5 `DEFAULT_*_NUMBER_FORMAT` constants to OF/ZS/FV/KOR/KFV
- [ ] 3.2 Update `onTenantCreated` to populate new SalesSettings columns
- [ ] 3.3 Update `salesDocumentNumberGenerator` to read from SalesSettings (fallback to constants)
- [ ] 3.4 UI in `/backend/config/sales` for all 5 format inputs
- [ ] 3.5 Unit tests for each format
- [ ] 3.6 i18n keys for new UI labels

### Phase 4: Default currency

- [ ] 4.1 `getDefaultCurrency()` helper + unit tests
- [ ] 4.2 `onTenantCreated` sets `defaultCurrencyCode='PLN'`
- [ ] 4.3 Wire currency fallback chain in form prefill
- [ ] 4.4 UI selector in `/backend/config/sales`
- [ ] 4.5 Unit test all 4 fallback levels

### Phase 5: PL units + i18n shorts

- [ ] 5.1 Add `mb` + `t` to `UNIT_DEFAULTS` in `catalog/lib/seeds.ts`
- [ ] 5.2 i18n shorts for all units used in MVP (catalog/i18n/{pl,en,de,es}.json)
- [ ] 5.3 NEW `catalog/lib/unitDisplay.ts` with `useUnitDisplay()` hook
- [ ] 5.4 Integration in `LineItemDialog.tsx` + `ItemsSection.tsx`
- [ ] 5.5 Test: idempotent re-seed (40 → 42 units, no duplicates)

### Phase 6: Validation gate + PR

- [ ] 6.1 Full validation gate locally
- [ ] 6.2 Open PR
- [ ] 6.3 Apply labels: `review`, `feature`, `needs-qa`
- [ ] 6.4 Run auto-review-pr autofix pass
- [ ] 6.5 Post comprehensive summary comment

## Changelog

- 2026-05-03 — Plan drafted (Kuba74).
