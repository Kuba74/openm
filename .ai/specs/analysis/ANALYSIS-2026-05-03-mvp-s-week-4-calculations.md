# MVP-S Week 4 Readiness — Quote Lines + Calculations

**Date:** 2026-05-03
**Target window:** 20.05 – 26.05.2026 (Week 4 of May MVP-S)
**Companion to:** [2026-05-03-partner-master-migration.md](../2026-05-03-partner-master-migration.md), [2026-05-03-openm-sales-readiness.md](ANALYSIS-2026-05-03-openm-sales-readiness.md)
**Status:** Audit complete — ready for spec

## TLDR

`salesCalculationService` (31 linii orchestrator + 393 linie kalkulacji) i `taxCalculationService` (141 linii) są **enterprise-grade**: extensible registry z hookami `before/after` per linia + per dokument, EventBus integration, wsparcie dla 4 typów adjustments (discount/tax/shipping/surcharge), 5 typów kalkulacji rabatu, mode-aware tax (net↔gross), zaokrąglanie do 4 miejsc po przecinku. Brakuje **3 elementów dla PL MVP**: (1) skip `is_exempt` rates from VAT total, (2) PL-specific rounding policy (groszy = 0.01 PLN), (3) explicit testy dla multi-VAT documents. Estymata Tygodnia 4: **~10 h** (most line UI + items section already exists, calculations need targeted tweaks).

## Co już jest

### `salesCalculationService.ts` (orchestrator, 31 linii)

```typescript
class DefaultSalesCalculationService {
  calculateLine(opts) → registry.calculateLine
  calculateDocumentTotals(opts) → registry.calculateDocument
}
```

Resolved via DI per AGENTS.md "MUST use salesCalculationService from DI".

### `taxCalculationService.ts` (141 linii)

- `calculateUnitAmounts(input)` z mode `'net' | 'gross'`
- Resolves `taxRateId` (lookup in DB) lub raw `taxRate` value
- Hooks: `sales.tax.calculate.before` + `.after` z opcją `setResult` (override)
- Walidacja: amount must be ≥ 0, rate normalized to non-negative
- Rounding: 4 decimal places (`precision = 4`)

### `lib/calculations.ts` (393 linii) — **kompletna logika**

#### Line calculation (`buildBaseLineResult`)

Obsługuje:
- `quantity` z fallback na 0
- `unitPriceNet` LUB `unitPriceGross` (auto-konwersja przez `taxRate`)
- Rabat: `discountAmount` (kwotowy per unit) LUB `discountPercent` (procent unitNet)
- Tax: `taxRate` (procent) lub `taxAmount` override
- Gross: `totalGrossAmount` override lub auto-calc

Edge cases handled:
- Discount ≥ subtotal → capped at netSubtotal
- Negative quantity → clamp to 0
- Discount-per-unit × quantity = discountTotal
- Tax = round(netSubtotal × max(taxRate, 0)) chyba że jest override

#### Document calculation (`buildBaseDocumentResult`)

Obsługuje:
- 4 typy adjustments: `discount`, `tax`, `shipping`, `surcharge`, `return`
- Adjustment z `rate` (%) lub `amountNet`/`amountGross` (kwotowy)
- Adjustment metadata.taxRate dla net↔gross konwersji
- Adjustment scope: `'order'` (default) vs `'line'` (skipped from order-level)
- Existing totals: paidTotalAmount, refundedTotalAmount → outstanding calculation
- Sumy per kategoria: subtotal/discount/tax/shipping/surcharge/grand

#### Registry pattern (`SalesCalculationRegistry`)

- `registerLineCalculator(hook, { prepend? })` — extensions
- `registerTotalsCalculator(hook, { prepend? })` — extensions
- EventBus events: `sales.line.calculate.{before,after}`, `sales.document.calculate.{before,after}`
- Każdy hook może zwrócić nowy `result` lub modyfikować przez `setResult`

### Test coverage (260 linii istniejących testów)

`salesCalculationService.test.ts` (181 linii):
- Line delegation z eventBus forwarding
- Document totals delegation z adjustments + existingTotals
- Registry calculators + event bus hooks integration

`taxCalculationService.test.ts` (79 linii):
- Mode net→gross
- Mode gross→net
- Rate from `taxRateId` (DB lookup)
- Raw `taxRate` value

## Coverage matrix — EPIC S3.5 + S3.6 vs reality

| Story | Status |
|---|---|
| **S3.5 Pozycje oferty** — model `SalesOfferItem` (offerId, salesItemId, type, name, description, quantity, unit, unitNetPrice, discountType, discountValue, vatRate, sortOrder) | ✅ `sales_quote_lines` istnieje (sprawdzić w entities — wszystkie pola obecne?) |
| **S3.5 Add line z katalogu / manualna / tekstowa** | ✅ (UI w `ItemsSection.tsx` + `LineItemDialog.tsx`) |
| **S3.5 Edit/delete pozycje** | ✅ |
| **S3.5 Sortowanie pozycji** | ✅ (`line_number: integer default 0`) |
| **S3.5 Validations: qty > 0, price ≥ 0, valid VAT** | ⚠️ Validation mostly w `validators.ts` — verify edge case: text-only line (no qty/price) |
| **S3.6 Calc netto** | ✅ `buildBaseLineResult` |
| **S3.6 Rabat % i kwotowy** | ✅ `discountAmount` (per unit) i `discountPercent` |
| **S3.6 Calc VAT** | ✅ `taxRate × netSubtotal`, override via `taxAmount` |
| **S3.6 Calc brutto** | ✅ `netSubtotal + taxAmount` |
| **S3.6 Sumy per dokument** | ✅ `buildBaseDocumentResult.totals.{subtotalNet, subtotalGross, taxTotal, grandTotalNet, grandTotalGross}` |
| **S3.6 Aktualizacja po zmianie pozycji** | ✅ (po side-effect events) |

## Gaps for Week 4

### Gap 1 — `is_exempt` rate skip (zależność od Tygodnia 2 PR)

W `taxCalculationService.performCalculation` po `resolveRate`, sprawdzić czy `SalesTaxRate.isExempt = true` i jeśli tak — zwrócić `taxAmount: 0` z `taxRate: null` (semantycznie "outside VAT").

```typescript
// W resolveRate:
if (rate.isExempt) {
  return { rate: 0, hasValue: true, isExempt: true }
}

// W performCalculation:
if (resolved.isExempt) {
  return {
    netAmount: roundAmount(amount),
    grossAmount: roundAmount(amount),
    taxAmount: 0,
    taxRate: null,  // null sygnalizuje "no rate", odróżnia od 0%
  }
}
```

W PDF/UI: `taxRate === null` → renderuj jako "zw." (Week 5 PDF + UI).

**Estymata:** 1 h (po Tygodniu 2 PR'u).

### Gap 2 — PL rounding policy

Aktualnie `roundAmount(value, precision = 4)` zaokrągla do 4 miejsc po przecinku (0.0001). To jest CORRECT dla intermediate calculations (precyzja groszy w trakcie multiplikacji), ale FINANCIAL output musi być zaokrąglony do 0.01 PLN (groszy).

Audyt obecnego stanu:
- Line: round(value × 1e4) / 1e4 — 4 miejsca
- Document totals: same rounding
- Display: zależy od formatera w UI/PDF

**Decyzja:** W kalkulacjach trzymać 4 miejsca (precyzja). Final display rounding do 2 miejsc (PLN groszy) leży po stronie `Intl.NumberFormat`. Jednak DOKUMENTOWANE TOTALS w bazie powinny być już zaokrąglone do 0.01 zł żeby uniknąć "cents off-by-one" przy PDF generation.

**Action:**
- Zostawić `lib/calculations.ts` jak jest (4-decimal precyzja)
- Dodać helper `formatFinancial(amount, currency) → number` zaokrąglający do `currencies.decimalPlaces` (PLN=2)
- Stosować przy zapisie do bazy: `quote.totals.grandTotalNetAmount = formatFinancial(...)`
- Lub: dodać `precision` parametr w `currency` config (już jest `decimalPlaces` w currencies module — wystarczy podpiąć)

**Estymata:** 2 h (helper + integration w command create/update quote).

### Gap 3 — Multi-VAT testy

Brak istniejących testów dla scenariusza multi-rate dokumentu (mix 23% + 8% + 5% + zw.). To jest **kluczowy edge case** dla PL B2B faktur:

Przykład:
- Linia 1: qty=10, unitNet=100, vat=23% → 1000 net, 230 vat, 1230 gross
- Linia 2: qty=1, unitNet=500, vat=8% → 500 net, 40 vat, 540 gross
- Linia 3: qty=1, unitNet=200, vat=zw. → 200 net, 0 vat, 200 gross
- **Total:** 1700 net, 270 vat, 1970 gross

Test powinien sprawdzić:
- Sumy per stawka VAT (do PDF totals table)
- Grand total
- `is_exempt` rate nie wkłada się do VAT total
- Kombinacja rabat-line + adjustment-document pracuje poprawnie

**Estymata:** 3 h (8-10 testów multi-rate scenarios).

### Gap 4 — Edge case testy

Aktualne testy są high-level (delegation + integration). Brakuje:

| # | Edge case | Estymata |
|---|---|---|
| E1 | 100% rabat → wszystko 0 | 0.5 h |
| E2 | Rabat % + adjustment kwotowy łącznie | 0.5 h |
| E3 | Bardzo duża quantity (1M+) | 0.3 h |
| E4 | Fractional quantity (0.5, 1.25) | 0.3 h |
| E5 | Mode gross zamiast net (B2C) | 0.5 h |
| E6 | Adjustment scope='line' nie dodaje się do order-level | 0.4 h |
| E7 | Existing totals: partially paid → outstanding correct | 0.3 h |
| E8 | `taxAmount` override (bypass kalkulacji rate) | 0.2 h |

**Estymata:** ~3 h.

### Gap 5 — UI w ItemsSection

UI istnieje (per Week 3 audyt), ale można jeszcze sprawdzić:
- Czy text-only line (bez ceny) renderuje się poprawnie w totals?
- Czy reorder przez drag-and-drop działa?
- Czy formatter currency respektuje `decimalPlaces` z currencies module?

**Estymata:** 1-2 h verification + drobne fix'y.

## Re-estymata Tygodnia 4

| Story | Original EPIC | After audit |
|---|---|---|
| S3.5 Pozycje | 16 h | 1-2 h (verification) |
| S3.6 Obliczenia | 16 h | 6 h (gaps 1-4) |
| S3.7 Statusy | 8 h | 0-2 h (verify state machine, blokady edycji) |
| **Razem Tydzień 4** | **40 h** | **~10 h** |

**Slack: ~30 h** w Tygodniu 4. Use for:
- Polish PDF prep (early start)
- Pre-fill chain z Tygodnia 3 (jeśli się przeciągnie)
- Bonus: status workflow visualization na UI (timeline)
- Bufor

## Dependencies

- **Week 2 PR (PL VAT/numbering/currency)** — wymagane dla `is_exempt` column na `sales_tax_rates`
- Bez Tygodnia 2: `vat-zw` traktowane jak `vat-0` (taxAmount=0 ale "0%" w wyświetlaniu zamiast "zw.")

## Pre-implementation queries

```sql
-- Sprawdź czy istnieją multi-VAT quotes
SELECT q.id, count(DISTINCT l.tax_rate) AS distinct_rates, count(*) AS line_count
FROM sales_quotes q
JOIN sales_quote_lines l ON l.quote_id = q.id AND l.deleted_at IS NULL
WHERE q.deleted_at IS NULL
GROUP BY q.id
HAVING count(DISTINCT l.tax_rate) > 1
LIMIT 10;

-- Sprawdź coverage discount fields w istniejących linach
SELECT
  count(*) FILTER (WHERE discount_amount IS NOT NULL) AS with_discount_amount,
  count(*) FILTER (WHERE discount_percent IS NOT NULL) AS with_discount_percent,
  count(*) FILTER (WHERE discount_amount IS NULL AND discount_percent IS NULL) AS no_discount,
  count(*) AS total
FROM sales_quote_lines WHERE deleted_at IS NULL;
```

## Backward compatibility

Wszystkie zmiany **additive**:
- `is_exempt` skip — nowa gałąź w `taxCalculationService` (existing tax rates without flag default false)
- `formatFinancial` helper — nowa funkcja, opt-in usage przy zapisie totals
- Nowe testy — wzbogacenie suite, no breaking changes

Per `BACKWARD_COMPATIBILITY.md` żadna powierzchnia kontraktu nie naruszona.

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| W4.1 | Po dodaniu `is_exempt` skip, istniejące dokumenty z `taxRate=0` zaczną się rendererować jako "zw." zamiast "0%" | Medium | Zachować `vat-0` (rate=0, isExempt=false) jako odrębny rekord; tylko `vat-zw` (rate=0, isExempt=true) zostaje "zw." |
| W4.2 | Rounding 4-decimal vs 2-decimal: zsumowanie 100 linii każda 0.0001 cents off → grand total ma off-by-one zł | Medium | `formatFinancial` zaokrągla per-line PRZED sumowaniem; testy sprawdzają symetrię |
| W4.3 | Multi-VAT documents nie sumują się prawidłowo gdy adjustment-discount jest scope='order' | Medium | Test scenario weryfikuje proporcjonalne odjęcie; jeśli błąd — fix w `buildBaseDocumentResult` |
| W4.4 | EventBus hooks zmieniają result mid-pipeline (third-party plugin) — niedeterministic totals | Low | Idempotency testy + stable ordering of registered hooks |

## Files to touch (Week 4 implementation)

| Path | Action |
|---|---|
| `packages/core/src/modules/sales/services/taxCalculationService.ts` | + `isExempt` skip branch |
| `packages/core/src/modules/sales/lib/calculations.ts` | (no changes — kalkulacje są ok) |
| `packages/core/src/modules/sales/lib/financialFormat.ts` | NEW — `formatFinancial(amount, currencyCode)` helper |
| `packages/core/src/modules/sales/commands/quotes.ts` (lub similar) | Wpiąć `formatFinancial` przy zapisie totals do DB |
| `packages/core/src/modules/sales/services/__tests__/taxCalculationService.test.ts` | + `isExempt` test cases |
| `packages/core/src/modules/sales/services/__tests__/salesCalculationService.test.ts` | + multi-VAT scenarios + edge cases (E1-E8) |
| `packages/core/src/modules/sales/lib/__tests__/financialFormat.test.ts` | NEW |
| `packages/core/src/modules/sales/__integration__/TC-MVP-S-W4-multi-vat-quote.spec.ts` | NEW |

NO migration changes (logika tylko, bez schema).

## Decision points

1. **Rounding policy:** zachować 4-decimal w kalkulacjach + 2-decimal przy zapisie totals do DB? Lub 2-decimal cały pipeline? **Rekomenduję: 4-decimal w trakcie + 2-decimal przy persist** (najlepsza precyzja + brak surprise off-by-one).
2. **`is_exempt` UX:** w detalu quote line dropdown stawek VAT pokazuje "23% (default), 8%, 5%, 0%, zw." — czy "zw." ma osobny styl/badge? **Rekomenduję: tak, badge "zw." z innym kolorem (subtle gray)**.
3. **Adjustment scope='order' z `is_exempt` adjustment**: czy obniżać proporcjonalnie czy całość? **Rekomenduję: proporcjonalnie do udziału per-rate**.

## Action items

1. ⏳ Czekać na Week 1, 2, 3 lądowania
2. Po Tygodniu 3: pisać per-phase spec `2026-05-03-mvp-s-week-4-calculations-vat-exempt.md`
3. Implementacja: fokus na gaps 1, 2, 3 (~10h)

## Sources

- `packages/core/src/modules/sales/services/salesCalculationService.ts` (31 linii)
- `packages/core/src/modules/sales/services/taxCalculationService.ts` (141 linii)
- `packages/core/src/modules/sales/lib/calculations.ts` (393 linii)
- `packages/core/src/modules/sales/services/__tests__/{salesCalculationService,taxCalculationService}.test.ts` (260 linii)
