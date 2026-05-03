# MVP-S Week 4 — Calculations + VAT Exempt + Multi-VAT

**Status:** Draft (depends on Week 2 + Week 3 PR merges)
**Created:** 2026-05-03
**Target window:** 20.05 – 26.05.2026
**Author:** Kuba74
**Parent spec:** [2026-05-03-partner-master-migration.md](2026-05-03-partner-master-migration.md)
**Companion audit:** [ANALYSIS-2026-05-03-mvp-s-week-4-calculations.md](analysis/ANALYSIS-2026-05-03-mvp-s-week-4-calculations.md)
**Estimated:** ~10 h

## TLDR

`salesCalculationService` jest enterprise-grade — extensible registry, EventBus hooks, 5 typów adjustments. Tydzień 4 dokłada: (1) `is_exempt` skip w `taxCalculationService`, (2) `formatFinancial` helper dla PL groszy precision, (3) kompletny zestaw multi-VAT testów, (4) edge case'y. UI lines (`ItemsSection`, `LineItemDialog`) jest gotowy — jedynie verification + drobne fix'y.

## Decisions (ratified 2026-05-03)

- **W4.1** Rounding policy: 4-decimal w trakcie kalkulacji + 2-decimal przy persist do DB
- **W4.2** `is_exempt` UX: dropdown stawek VAT pokazuje "23% (default), 8%, 5%, 0%, zw." z badge dla "zw." (subtle gray)
- **W4.3** Adjustment scope='order' z `is_exempt` line: obniżać proporcjonalnie do udziału per-rate (nie 100% z exempt subset)

## Stories in scope

### W4.1 — `is_exempt` skip w taxCalculationService (1 h)

W [packages/core/src/modules/sales/services/taxCalculationService.ts](../../packages/core/src/modules/sales/services/taxCalculationService.ts):

```typescript
type ResolvedRate = { rate: number; hasValue: boolean; isExempt: boolean }

private async resolveRate(input: CalculateTaxInput): Promise<ResolvedRate> {
  if (input.taxRateId) {
    const rate = await this.em.findOne(SalesTaxRate, {
      id: input.taxRateId,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      deletedAt: null,
    }, { fields: ['rate', 'isExempt', 'organizationId', 'tenantId'] })
    if (!rate) {
      throw new CrudHttpError(400, { error: 'Tax class not found for this organization.' })
    }
    return {
      rate: this.normalizeRate(rate.rate),
      hasValue: true,
      isExempt: rate.isExempt === true,
    }
  }
  if (input.taxRate !== undefined && input.taxRate !== null) {
    return {
      rate: this.normalizeRate(input.taxRate),
      hasValue: true,
      isExempt: false,  // raw rate value never marked exempt
    }
  }
  return { rate: 0, hasValue: false, isExempt: false }
}

private async performCalculation(input: CalculateTaxInput): Promise<TaxCalculationResult> {
  const amount = this.normalizeAmount(input.amount)
  const mode = input.mode === 'gross' ? 'gross' : input.mode === 'net' ? 'net' : null
  if (!mode) throw new CrudHttpError(400, { error: 'Unsupported tax calculation mode.' })
  
  const { rate, hasValue, isExempt } = await this.resolveRate(input)
  
  // W4.1: exempt rates yield zero VAT and null taxRate (semantyczne "outside VAT")
  if (isExempt) {
    return {
      netAmount: roundAmount(amount),
      grossAmount: roundAmount(amount),
      taxAmount: 0,
      taxRate: null,  // null sygnalizuje "no rate" (zw.) w przeciwieństwie do 0 (0%)
    }
  }
  
  const fraction = hasValue ? rate / 100 : 0
  let netAmount: number
  let grossAmount: number
  if (mode === 'net') {
    netAmount = amount
    grossAmount = amount * (1 + fraction)
  } else {
    grossAmount = amount
    netAmount = fraction > 0 ? amount / (1 + fraction) : amount
  }
  const taxAmount = grossAmount - netAmount
  
  return {
    netAmount: roundAmount(netAmount),
    grossAmount: roundAmount(grossAmount),
    taxAmount: roundAmount(taxAmount),
    taxRate: hasValue ? roundRate(rate) : null,
  }
}
```

**Acceptance:**
- `vat-zw` line: taxAmount=0, taxRate=null (UI/PDF rendererują "zw.")
- `vat-0` line: taxAmount=0, taxRate=0 (UI/PDF rendererują "0%")
- Existing rates without `is_exempt` (legacy) → traktowane jak `is_exempt=false` (default)

### W4.2 — `formatFinancial` helper (2 h)

NEW `lib/financialFormat.ts`:

```typescript
import type { EntityManager } from '@mikro-orm/postgresql'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'

export type CurrencyPrecision = {
  code: string
  decimalPlaces: number
}

const PL_DEFAULT_DECIMAL_PLACES = 2

export async function loadCurrencyPrecision(
  em: EntityManager,
  currencyCode: string,
  scope: { organizationId: string; tenantId: string },
): Promise<CurrencyPrecision> {
  const currency = await em.findOne(Currency, {
    code: currencyCode,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  return {
    code: currencyCode,
    decimalPlaces: currency?.decimalPlaces ?? PL_DEFAULT_DECIMAL_PLACES,
  }
}

export function formatFinancial(amount: number, precision: CurrencyPrecision): number {
  if (!Number.isFinite(amount)) return 0
  const factor = 10 ** precision.decimalPlaces
  return Math.round(amount * factor) / factor
}

export function formatFinancialBatch(
  amounts: number[],
  precision: CurrencyPrecision,
): number[] {
  return amounts.map((a) => formatFinancial(a, precision))
}
```

Wpiąć w komendach quote create/update **przy zapisie totals do DB** (nie w trakcie kalkulacji). Lokalizacja: `packages/core/src/modules/sales/commands/quotes.ts` (lub podobne) — wszędzie gdzie totals są zapisywane do bazy:

```typescript
// PRZED zapisem totals:
const precision = await loadCurrencyPrecision(em, quote.currencyCode, scope)
quote.subtotalNetAmount = String(formatFinancial(calc.totals.subtotalNetAmount, precision))
quote.subtotalGrossAmount = String(formatFinancial(calc.totals.subtotalGrossAmount, precision))
// ... etc dla wszystkich totals
```

**Acceptance:**
- 1+1+1 cents test: 3 lines × 0.001 zł each → grand total = 0.00 zł (lub 0.01? — zależy od strategy "round each then sum" vs "sum then round" — **WYBÓR: round each line PRZED sumowaniem, żeby UI sum = DB sum**)
- PLN: 0.001 → 0.00, 0.005 → 0.01 (banker's rounding nie wymagany, użyć Math.round z eps)
- EUR (decimalPlaces=2): same logic
- BHD (decimalPlaces=3): zaokrąglanie do 3 miejsc

### W4.3 — Multi-VAT scenarios testy (3 h)

NEW `__integration__/TC-MVP-S-W4-multi-vat-quote.spec.ts`:

```typescript
describe('TC-MVP-S-W4: Multi-VAT quote calculations', () => {
  it('groups totals by VAT rate including is_exempt', async () => {
    const quote = await createQuote({
      lines: [
        { qty: 10, unitNet: 100, taxRateCode: 'vat-23' },  // 1000 net, 230 vat, 1230 gross
        { qty: 1, unitNet: 500, taxRateCode: 'vat-8' },    // 500 net, 40 vat, 540 gross
        { qty: 1, unitNet: 200, taxRateCode: 'vat-zw' },   // 200 net, 0 vat, 200 gross
      ],
    })
    
    expect(quote.totalsByVatRate).toEqual([
      { rateLabel: '23%', netTotal: 1000, vatTotal: 230, grossTotal: 1230 },
      { rateLabel: '8%', netTotal: 500, vatTotal: 40, grossTotal: 540 },
      { rateLabel: 'zw.', netTotal: 200, vatTotal: 0, grossTotal: 200 },  // is_exempt=true
    ])
    expect(quote.grandTotalNet).toBe(1700)
    expect(quote.grandTotalVat).toBe(270)  // exempt nie wkłada się do VAT total
    expect(quote.grandTotalGross).toBe(1970)
  })
  
  // ... 7 więcej scenariuszy:
  // - 100% rabat
  // - rabat % + adjustment kwotowy
  // - bardzo duża quantity
  // - fractional quantity
  // - mode=gross
  // - adjustment scope='line' nie dodaje się do order-level
  // - taxAmount override (bypass kalkulacji rate)
  // - mix vat-0 i vat-zw na jednym dokumencie (różne semantyki)
})
```

### W4.4 — Edge case unit tests (3 h)

W `services/__tests__/salesCalculationService.test.ts` dodać 8 edge case'ów (E1-E8 z audit'u). Krótkie testy parametryczne:

```typescript
describe.each<{ name: string; input: CalculateLineOptions; expected: Partial<SalesLineCalculationResult> }>([
  {
    name: 'E1: 100% rabat → wszystko 0',
    input: { line: { quantity: 1, unitPriceNet: 100, discountPercent: 100, taxRate: 23 }, ... },
    expected: { netAmount: 0, taxAmount: 0, grossAmount: 0, discountAmount: 100 },
  },
  {
    name: 'E2: Rabat % + adjustment kwotowy',
    // ...
  },
  // ... E3-E8
])('Line edge cases', ({ name, input, expected }) => {
  it(name, async () => {
    const result = await salesCalculations.calculateLine(input)
    expect(result).toMatchObject(expected)
  })
})
```

### W4.5 — UI verification (1 h)

Sprawdzić w `ItemsSection` + `LineItemDialog`:
- Text-only line (qty=null, unitNet=null) — czy pojawia się w lines table z pustymi cellami?
- VAT rate dropdown — czy "vat-zw" ma badge "zw." (W4.2 decision)?
- Summary table na detalu — czy zawiera wiersz per VAT rate?
- Currency formatter używa `currencies.decimalPlaces`?

Jeśli któraś nie działa — drobne fix'y (1 h budget).

## Files to touch

| Path | Action |
|---|---|
| `packages/core/src/modules/sales/services/taxCalculationService.ts` | + `isExempt` skip branch w `resolveRate` + `performCalculation` |
| `packages/core/src/modules/sales/lib/financialFormat.ts` | NEW — `formatFinancial`, `loadCurrencyPrecision`, `formatFinancialBatch` |
| `packages/core/src/modules/sales/lib/__tests__/financialFormat.test.ts` | NEW |
| `packages/core/src/modules/sales/commands/quotes.ts` (lub similar) | Wpiąć `formatFinancial` przy zapisie totals |
| `packages/core/src/modules/sales/services/__tests__/taxCalculationService.test.ts` | + 5 testów dla `isExempt` (vat-zw vs vat-0 distinction, legacy rates default false, gross mode) |
| `packages/core/src/modules/sales/services/__tests__/salesCalculationService.test.ts` | + 8 edge cases (E1-E8) |
| `packages/core/src/modules/sales/__integration__/TC-MVP-S-W4-multi-vat-quote.spec.ts` | NEW |
| `packages/core/src/modules/sales/components/documents/LineItemDialog.tsx` | + badge "zw." dla `vat-zw` (W4.2 UX) |
| `packages/core/src/modules/sales/i18n/{en,pl,de,es}.json` | + label "zw." badge |

NO migration file (logika tylko, bez schema). `isExempt` column z Tygodnia 2 — nie powtarzamy tu.

## Backward compatibility

Wszystkie zmiany **additive**:
- `isExempt` skip — nowa gałąź (domyślnie false dla legacy rates)
- `formatFinancial` — nowy helper, opt-in usage
- Nowe testy
- UI badge — additive renderowanie

Per `BACKWARD_COMPATIBILITY.md` żadna powierzchnia kontraktu nie naruszona.

## Dependencies

- **Week 2 PR merged** — wymagany dla `sales_tax_rates.is_exempt` column

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| W4.R1 | Po dodaniu `isExempt` skip, istniejące dokumenty z `vat-0` przestają działać | Low | `isExempt` defaults to false; tylko nowy seed dla `vat-zw` ma true |
| W4.R2 | Round-each-then-sum vs sum-then-round dyskrepancja w UI vs DB | Medium | Decyzja W4.1: round each line PRZED sumowaniem; testy weryfikują symetrię |
| W4.R3 | `formatFinancial` na adjustment.amountNet zmienia historyczne wyliczenia | Low | Apply tylko przy create/update commands; existing data niezmienione |
| W4.R4 | Multi-VAT total breakdown w UI nie matchuje PDF | Low | Test integracyjny weryfikuje równość (sumy są deterministyczne po `formatFinancial`) |

## Validation gate

```bash
yarn build:packages
yarn typecheck
yarn test
yarn jest packages/core/src/modules/sales/services/__tests__
yarn jest packages/core/src/modules/sales/lib/__tests__/financialFormat.test.ts
yarn test:integration --grep TC-MVP-S-W4
yarn build:app
```

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: `is_exempt` skip (1 h)

- [ ] 1.1 Update `resolveRate` żeby zwracał `isExempt`
- [ ] 1.2 Update `performCalculation` żeby skipował VAT dla exempt
- [ ] 1.3 Unit tests (5 cases: vat-zw, vat-0, legacy default, gross mode exempt, taxRate raw value)

### Phase 2: `formatFinancial` (2 h)

- [ ] 2.1 NEW `lib/financialFormat.ts`
- [ ] 2.2 Unit tests (PLN 2-decimal, EUR 2-decimal, BHD 3-decimal, edge case 0.005, NaN)
- [ ] 2.3 Wpiąć w `commands/quotes.ts` (i orders, invoices, etc.) przy zapisie totals
- [ ] 2.4 Sprawdzić integrację — multi-line sum equals UI sum

### Phase 3: Multi-VAT testy (3 h)

- [ ] 3.1 NEW integration test TC-MVP-S-W4-multi-vat-quote.spec.ts
- [ ] 3.2 Scenariusz 1: 23%+8%+zw. groupowanie
- [ ] 3.3 Scenariusz 2: 100% rabat
- [ ] 3.4 Scenariusze 3-8 (rabat+adjustment, large qty, fractional qty, mode=gross, scope='line', taxAmount override)
- [ ] 3.5 Verify: VAT total = sum(lines.taxAmount) (skipping exempt)

### Phase 4: Edge cases unit tests (3 h)

- [ ] 4.1 Add E1-E8 do `services/__tests__/salesCalculationService.test.ts`
- [ ] 4.2 Parametryczne testy via `describe.each`

### Phase 5: UI verification + i18n (1 h)

- [ ] 5.1 Verify VAT dropdown badge dla `vat-zw`
- [ ] 5.2 Verify summary table multi-rate breakdown
- [ ] 5.3 Verify currency formatter respektuje decimalPlaces
- [ ] 5.4 i18n keys (badge "zw.", error messages)

## Changelog

- 2026-05-03 — Initial spec created (Kuba74). Decisions W4.1-W4.3 ratified. ~10 h estimate.
