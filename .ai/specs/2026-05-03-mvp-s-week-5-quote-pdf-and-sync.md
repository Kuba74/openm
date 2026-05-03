# MVP-S Week 5 — Quote PDF + Historical Sync + Demo

**Status:** Draft (depends on Weeks 1-4 PR merges)
**Created:** 2026-05-03
**Target window:** 27.05 – 31.05.2026
**Author:** Kuba74
**Parent spec:** [2026-05-03-partner-master-migration.md](2026-05-03-partner-master-migration.md)
**Companion audit:** [ANALYSIS-2026-05-03-mvp-s-week-5-pdf-research.md](analysis/ANALYSIS-2026-05-03-mvp-s-week-5-pdf-research.md)
**Estimated:** ~35 h (PDF 19 + sync 12 + demo prep 4)

## TLDR

Tydzień 5 dostarcza PDF generator (`@react-pdf/renderer` per ADR-8) z polskim B2B template'em ofert, jednorazowy import 8100 historycznych SalesOffer z erp-fromee do `sales_quotes` (MVP-zakres top 500 active, per ADR-9), oraz przygotowanie demo end-to-end. Po Tygodniu 5 system jest gotowy do prezentacji zarządowi.

## Decisions (per master spec ADRs)

- **ADR-8** — Library: `@react-pdf/renderer` v4.x
- **ADR-9** — Sync historycznych SalesOffer: MVP-zakres top 500 (status != cancelled, sortowane po valueNet desc)

## Stories in scope

### W5.1 — Setup `@react-pdf/renderer` + Roboto fonts (2 h)

```bash
yarn workspace @open-mercato/core add @react-pdf/renderer@^4
```

Pobierz Roboto fonty (Apache 2.0) do `packages/core/src/modules/sales/pdf/fonts/`:
- `Roboto-Regular.ttf`
- `Roboto-Bold.ttf`
- `Roboto-Italic.ttf`

Source: https://fonts.google.com/specimen/Roboto

License notice w `pdf/fonts/README.md` (Apache 2.0).

### W5.2 — PDF components (6 h)

Lokalizacja: `packages/core/src/modules/sales/pdf/`

```
pdf/
├── fonts/
│   ├── Roboto-Regular.ttf
│   ├── Roboto-Bold.ttf
│   └── Roboto-Italic.ttf
├── components/
│   ├── DocumentHeader.tsx       # logo + numer + data
│   ├── PartiesSection.tsx       # wystawca + nabywca + kontakt
│   ├── LinesTable.tsx           # tabela pozycji
│   ├── TotalsSection.tsx        # podsumowanie netto/VAT/brutto z grupowaniem stawek (incl. zw.)
│   ├── PaymentTermsSection.tsx
│   └── DocumentFooter.tsx       # stopka z page numbering
├── templates/
│   ├── QuotePdfPL.tsx
│   └── shared.ts                # styles, fonts register, helpers
└── render.ts                    # renderToBuffer entry point
```

Pełen template z prototype'a w [audyt'cie Week 5](analysis/ANALYSIS-2026-05-03-mvp-s-week-5-pdf-research.md). Komponenty:

- **DocumentHeader** — issuer block (left) + number block (right with date + validUntil)
- **PartiesSection** — 2 cards side-by-side (WYSTAWCA / NABYWCA), z NIP + adresem + kontaktem
- **LinesTable** — header + rows; każdy wiersz `wrap={false}` (page-break-safe); kolumny: Lp, Opis, Ilość, J.M., Cena j. netto, Wartość netto
- **TotalsSection** — tabela per-rate (23% / 8% / 5% / 0% / zw.) + Razem; right-aligned
- **PaymentTermsSection** — warunki + IBAN + waluta + uwagi
- **DocumentFooter** — fixed bottom, page numbering "1/N"

### W5.3 — `QuotePdfPL` template (2 h)

Composition powyższych komponentów w 1 stronę A4 (z auto-multi-page jeśli >20 pozycji).

```typescript
// pdf/templates/QuotePdfPL.tsx
export function QuotePdfPL({ snapshot }: { snapshot: QuoteSnapshot }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <DocumentHeader snapshot={snapshot} />
        <PartiesSection snapshot={snapshot} />
        <LinesTable lines={snapshot.lines} currencyCode={snapshot.currencyCode} />
        <TotalsSection
          totalsByVatRate={snapshot.totalsByVatRate}
          grandTotal={snapshot.grandTotal}
          currencyCode={snapshot.currencyCode}
        />
        <PaymentTermsSection
          paymentTerms={snapshot.paymentTerms}
          bankAccountIban={snapshot.bankAccountIban}
          currencyCode={snapshot.currencyCode}
          notes={snapshot.notes}
        />
        <DocumentFooter snapshot={snapshot} />
      </Page>
    </Document>
  )
}
```

### W5.4 — `fetchQuoteSnapshot` helper (3 h)

`packages/core/src/modules/sales/lib/quoteSnapshot.ts`:

```typescript
export type QuoteSnapshot = {
  number: string
  issuedAt: string
  validUntil: string | null
  currencyCode: string
  issuer: { name: string; nip: string; address: string; krs?: string; phone?: string; website?: string }
  customer: { name: string; nip: string | null; address: string }
  contact: { name: string; email: string; phone: string } | null
  lines: Array<{
    no: number
    description: string
    sku: string | null
    quantity: number
    unit: string
    unitNet: number
    discount: { type: 'percent' | 'amount'; value: number } | null
    taxRate: number | null  // null = exempt (zw.)
    taxRateLabel: string  // '23%' | '8%' | '5%' | '0%' | 'zw.'
    isExempt: boolean
    netTotal: number
  }>
  totalsByVatRate: Array<{
    rateLabel: string
    isExempt: boolean
    netTotal: number
    vatTotal: number
    grossTotal: number
  }>
  grandTotal: { net: number; vat: number; gross: number }
  paymentTerms: string | null
  bankAccountIban: string | null
  notes: string | null
}

export async function fetchQuoteSnapshot(
  em: EntityManager,
  quoteId: string,
  scope: { organizationId: string; tenantId: string },
): Promise<QuoteSnapshot | null> {
  // 1. Load SalesQuote with lines + adjustments via findWithDecryption
  // 2. Load issuer (Organization) + tax_identities
  // 3. Load customer entity + tax_identities + getPrimaryContact + getDefaultOfferAddress
  // 4. Calculate totals via salesCalculationService
  // 5. Group totals by VAT rate (separate vat-zw via isExempt)
  // 6. Resolve currency, paymentTerms, bankAccountIban from customer_company_billing
  // 7. Format addresses (multi-line)
  // 8. Return shaped QuoteSnapshot
}
```

Używa helperów Tygodnia 1: `getPrimaryContact`, `getDefaultOfferAddress`, `getSalesOwner`. Używa `taxCalculationService` dla per-line calculations z `isExempt` skip (Tydzień 4).

### W5.5 — API endpoint `/api/sales/quotes/[id]/pdf` (1 h)

```typescript
// packages/core/src/modules/sales/api/quotes/[id]/pdf/route.ts
import { renderToBuffer } from '@react-pdf/renderer'
import { QuotePdfPL } from '../../../../pdf/templates/QuotePdfPL'
import { fetchQuoteSnapshot } from '../../../../lib/quoteSnapshot'
import { resolveOrganizationScopeForRequest } from '@open-mercato/shared/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const scope = await resolveOrganizationScopeForRequest(req)
  if (!scope.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!scope.features.includes('sales.quotes.view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  
  const snapshot = await fetchQuoteSnapshot(scope.em, id, scope)
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  
  const buffer = await renderToBuffer(<QuotePdfPL snapshot={snapshot} />)
  
  // Audit log (per AGENTS.md command pattern recommendation)
  // emit `sales.quote.pdf_downloaded` event with quoteId + userId
  
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${snapshot.number.replace(/[\\/]/g, '_')}.pdf"`,
      'Cache-Control': 'private, max-age=0, no-cache',
    },
  })
}

export const openApi = {
  summary: 'Generate PDF for a quote',
  tags: ['Sales / Quotes'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: {
    200: { description: 'PDF binary stream', content: { 'application/pdf': {} } },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Quote not found' },
  },
}
```

W UI: dodać przycisk "Pobierz PDF" w detalu quote (`/backend/sales/quotes/[id]`) — wywołuje `apiCall('/api/sales/quotes/[id]/pdf', { responseType: 'blob' })` i triggers download.

### W5.6 — PDF tests (4 h)

NEW `__integration__/TC-MVP-S-W5-quote-pdf.spec.ts`:

15 edge cases per audit (E1-E15):
- E1: 1 pozycja, 1 stawka VAT
- E2: 20+ pozycji (page break)
- E3: Bardzo długi opis pozycji
- E4: Pozycja tekstowa (bez ceny)
- E5: Multi-VAT (23% + 8% + 5% + 0% + zw.)
- E6: 100% rabat
- E7: Rabat % vs kwotowy
- E8: Brak NIP customer (B2C)
- E9: Brak primary contact
- E10: Polskie znaki (ąćęłńóśźż, ĄĆĘŁŃÓŚŹŻ)
- E11: Bardzo duże kwoty (>1 mln PLN)
- E12: Grosze (0.01 PLN)
- E13: EUR currency
- E14: Brak validUntil
- E15: vat-zw exempt rate

Każdy test: render do bufferu, sprawdź że PDF parsuje się (np. `pdf-parse` package), sprawdź obecność expected text (numer, klient, totals).

### W5.7 — i18n keys (1 h)

W `i18n/{pl,en,de,es}.json` dodać klucze pod `sales.pdf.quote.*`:
- `header.quote` → "OFERTA"
- `header.date` → "Data"
- `header.validUntil` → "Termin ważności"
- `parties.issuer` → "WYSTAWCA"
- `parties.customer` → "NABYWCA"
- `parties.contact` → "Kontakt"
- `lines.no` → "Lp"
- `lines.description` → "Opis pozycji"
- `lines.quantity` → "Ilość"
- `lines.unit` → "J.M."
- `lines.unitNetPrice` → "Cena j. netto"
- `lines.netTotal` → "Wartość netto"
- `totals.summary` → "Podsumowanie"
- `totals.taxRate` → "Stawka VAT"
- `totals.exemptLabel` → "zw."
- `totals.grandTotal` → "Razem"
- `terms.paymentTerms` → "Warunki płatności"
- `terms.bankAccount` → "Numer konta"
- `terms.currency` → "Waluta"
- `terms.notes` → "Uwagi"

### W5.8 — Sync historycznych ofert (12 h, MVP-zakres)

Per ADR-9 — top 500 active SalesOffer z erp-fromee.

`packages/core/src/modules/sync_erp_fromee/sync-historical-quotes.ts`:

```typescript
export type SyncHistoricalQuotesOptions = {
  dryRun: boolean
  topN?: number          // default 500
  minValueNet?: number   // optional filter
  organizationId: string
  tenantId: string
}

export type SyncHistoricalQuotesResult = {
  considered: number
  imported: number
  skipped: number
  errors: Array<{ erpFromeeId: string; reason: string }>
  partnerLinks: Array<{ erpFromeeCompanyId: string; openmEntityId: string | null }>
}

export async function syncHistoricalQuotes(
  options: SyncHistoricalQuotesOptions,
): Promise<SyncHistoricalQuotesResult> {
  // 1. Connect to erp-fromee Postgres (via separate connection or env var)
  // 2. Query top N active SalesOffer (status != 'cancelled', ORDER BY valueNet DESC LIMIT N)
  // 3. For each:
  //    a. Lookup customer in openm via customer_entities.metadata.external_id = SalesOffer.companyId
  //    b. Skip if not found (Phase 3 sync inbound for partners must run FIRST)
  //    c. Map status: erp-fromee status → openm sales_quotes.status
  //    d. Create sales_quote with mapped fields
  //    e. Create sales_quote_lines from SalesOfferLine (or skip if empty — most are empty in erp-fromee)
  //    f. Set metadata.external_id = SalesOffer.id, metadata.source = 'erp_fromee_historical'
  //    g. Skip calculations (use erp-fromee's totals as authoritative for historical)
  // 4. Return summary
}
```

**Mapping erp-fromee `SalesOffer` → openm `sales_quotes`:**

| erp-fromee | openm | Notes |
|---|---|---|
| `id` (cuid) | `metadata.external_id` | Mapping table |
| `offerNo` | `number` | Direct copy (zachować historyczne formaty) |
| `title` | `title` lub `notes` | Brak title w sales_quotes — dorzucić do notes |
| `status` | `status` | Mapping: erp-fromee statuses → openm statuses |
| `companyId` | `customerEntityId` | Resolved przez external_id mapping |
| `currency` | `currencyCode` | Direct |
| `valueNet` | snapshot na `metadata.valueNetSnapshot` | Brak rekalkulacji — historyczne wartości |
| `validUntil` | `validUntil` | Direct |
| `owner` | `salesOwnerUserId` | Lookup w auth.users by display name (best-effort) |
| `internalText` | internal note | |
| `paymentTerms` | `paymentTerms` | Direct |
| `deliveryAddress` | snapshot na shipping address | Adres jako tekst, nie FK |

**Status mapping** (erp-fromee → openm):
- erp-fromee `draft` / `new` → openm `draft`
- erp-fromee `sent` / `quoted` → openm `sent`
- erp-fromee `accepted` / `won` → openm `accepted`
- erp-fromee `rejected` / `lost` → openm `rejected`
- erp-fromee `archived` (z `isArchived=true`) → SKIP (per ADR-9 "active only")

CLI command:

```bash
yarn mercato sync-erp-fromee historical-quotes --dry-run --top=500
yarn mercato sync-erp-fromee historical-quotes --commit --top=500
```

Idempotent: re-run aktualizuje (jeśli `metadata.external_id` matches) lub tworzy nowy. Reports `imported/updated/skipped/errors`.

### W5.9 — Demo prep (4 h)

Lista checklist'a:

- [ ] Pełen flow E2E: zaloguj się → utwórz partnera (z NIP) → utwórz quote → dodaj linie (multi-VAT) → status sent → pobierz PDF → konwersja do order
- [ ] Demo dataset: 5-10 prawdziwych klientów (zaimportowanych przez sync) + 1 nowy "świeży" partner (utworzony w trakcie demo)
- [ ] Slide z architekturą: openm modules → strangler integration → erp-fromee read-only
- [ ] Slide z liczbami: ile partnerów zsynchronizowanych, ile aktywnych ofert, top customers
- [ ] Skrypt demo (timing, sequence, fallback w razie awarii)
- [ ] Test stand-by environment (jeśli prod nie jest stable, demo na staging)

## Files to touch

| Path | Action |
|---|---|
| `packages/core/src/modules/sales/pdf/fonts/{Roboto-Regular,Roboto-Bold,Roboto-Italic}.ttf` | NEW (binary) |
| `packages/core/src/modules/sales/pdf/fonts/README.md` | NEW (license) |
| `packages/core/src/modules/sales/pdf/components/{DocumentHeader,PartiesSection,LinesTable,TotalsSection,PaymentTermsSection,DocumentFooter}.tsx` | NEW |
| `packages/core/src/modules/sales/pdf/templates/QuotePdfPL.tsx` | NEW |
| `packages/core/src/modules/sales/pdf/templates/shared.ts` | NEW (Font.register, styles, formatPLN, formatDate) |
| `packages/core/src/modules/sales/lib/quoteSnapshot.ts` | NEW |
| `packages/core/src/modules/sales/api/quotes/[id]/pdf/route.ts` | NEW |
| `packages/core/src/modules/sales/backend/sales/quotes/[id]/page.tsx` | + przycisk "Pobierz PDF" |
| `packages/core/src/modules/sales/__integration__/TC-MVP-S-W5-quote-pdf.spec.ts` | NEW (15 edge cases) |
| `packages/core/src/modules/sales/i18n/{pl,en,de,es}.json` | + ~25 kluczy pod `sales.pdf.*` |
| `apps/mercato/src/modules/sync_erp_fromee/lib/sync-historical-quotes.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/cli.ts` | + `historical-quotes` subcommand |
| `apps/mercato/src/modules/sync_erp_fromee/__integration__/TC-MVP-S-W5-historical-sync.spec.ts` | NEW |
| `apps/mercato/package.json` | + `@react-pdf/renderer@^4` dependency |

## Backward compatibility

- PDF generator: nowy moduł, additive
- Sync historyczny: idempotent, opt-in via CLI flag, write-only do `sales_quotes` z `metadata.source` marker

Per `BACKWARD_COMPATIBILITY.md` żadna powierzchnia kontraktu nie naruszona.

## Dependencies

- **Week 1 PR'y merged** — partner master + helpery
- **Week 2 PR merged** — VAT rates z `is_exempt`, document numbering, default currency
- **Week 3 PR merged** — quote UI z pre-fill chain (do demo flow)
- **Week 4 PR merged** — `is_exempt` skip + `formatFinancial` (do snapshot calculations)
- **Phase 3 sync inbound (partial)** — partnerzy zsynchronizowani z erp-fromee przez `metadata.external_id` (W5.8 wymaga tego mapping'u)

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| W5.R1 | Polski znak nie renderuje się (font issue) | High | Test E10 critical-path; fallback na Inter lub Noto Sans |
| W5.R2 | Page break wewnątrz tabeli pozycji wycina wiersz | Medium | `<View wrap={false}>` na każdym wierszu |
| W5.R3 | Bardzo duży snapshot (>100 pozycji) wolny renderToBuffer | Low | MVP limit do 100 pozycji per oferta; warning UI |
| W5.R4 | Server-side fetch fontów nie działa (404) | Medium | Embed via `import` zamiast URL; lub `fs.readFileSync` w server context |
| W5.R5 | 8100 historycznych ofert do importu (top 500 z lines może być pusty) | High | Per ADR-9: tylko aktywne top 500; `SalesOfferLine` ma 1 record w erp-fromee — większość ofert bezliniowych, snapshot tylko nagłówka |
| W5.R6 | Bundle size powiększa cold start Next.js | Low | Lazy-import w API route |

## Validation gate

```bash
yarn install                                                   # @react-pdf/renderer dependency
yarn build:packages
yarn typecheck
yarn test
yarn jest packages/core/src/modules/sales/pdf/
yarn test:integration --grep TC-MVP-S-W5
yarn build:app

# Manual smoke:
# 1. Open /backend/sales/quotes/[id] → click "Pobierz PDF"
# 2. PDF downloads, opens in viewer with polskie znaki rendering correctly
# 3. Multi-VAT totals are correct
# 4. Run sync CLI: yarn mercato sync-erp-fromee historical-quotes --dry-run --top=10
```

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Setup + fonts (2 h)

- [ ] 1.1 Add `@react-pdf/renderer@^4` dependency
- [ ] 1.2 Add Roboto fonts (3 weights) + LICENSE README
- [ ] 1.3 Create `pdf/templates/shared.ts` z `Font.register` + `styles` + helpery

### Phase 2: PDF components (6 h)

- [ ] 2.1 DocumentHeader.tsx
- [ ] 2.2 PartiesSection.tsx
- [ ] 2.3 LinesTable.tsx (z `wrap={false}` per row)
- [ ] 2.4 TotalsSection.tsx (multi-VAT grouping z exempt distinction)
- [ ] 2.5 PaymentTermsSection.tsx
- [ ] 2.6 DocumentFooter.tsx (page numbering)

### Phase 3: Template + snapshot (5 h)

- [ ] 3.1 NEW `pdf/templates/QuotePdfPL.tsx` (composition)
- [ ] 3.2 NEW `lib/quoteSnapshot.ts` z fetchQuoteSnapshot
- [ ] 3.3 i18n keys (~25 sales.pdf.*)

### Phase 4: API + UI download (1 h)

- [ ] 4.1 NEW `api/quotes/[id]/pdf/route.ts` z RBAC + audit
- [ ] 4.2 Add "Pobierz PDF" button do quote detail page
- [ ] 4.3 OpenAPI export

### Phase 5: PDF tests (4 h)

- [ ] 5.1 NEW `__integration__/TC-MVP-S-W5-quote-pdf.spec.ts`
- [ ] 5.2 E1-E5 (basic + multi-VAT + page break)
- [ ] 5.3 E6-E10 (rabaty + B2C + brak primary contact + polskie znaki)
- [ ] 5.4 E11-E15 (kwoty + grosze + EUR + brak validUntil + vat-zw)

### Phase 6: Sync historical (12 h)

- [ ] 6.1 NEW `sync_erp_fromee/lib/sync-historical-quotes.ts`
- [ ] 6.2 Mapping logic (status, fields, customer lookup)
- [ ] 6.3 NEW CLI command `mercato sync-erp-fromee historical-quotes`
- [ ] 6.4 Dry-run + commit modes
- [ ] 6.5 Idempotency tests
- [ ] 6.6 NEW integration test TC-MVP-S-W5-historical-sync.spec.ts

### Phase 7: Demo prep (4 h)

- [ ] 7.1 E2E flow walkthrough z notatkami timing'u
- [ ] 7.2 Demo dataset prep (5-10 partnerów + 1 fresh)
- [ ] 7.3 Architektura slide
- [ ] 7.4 Liczby slide (counts po sync)
- [ ] 7.5 Skrypt demo + fallback
- [ ] 7.6 Stand-by env test

### Phase 8: Validation gate + PR (1 h, included in budget)

- [ ] 8.1 Full validation gate locally
- [ ] 8.2 Manual smoke per "Validation gate" section
- [ ] 8.3 Open PR (base = develop)
- [ ] 8.4 Apply labels: review, feature, needs-qa

## Changelog

- 2026-05-03 — Initial spec created (Kuba74). Decisions per ADR-8/9. ~35 h estimate (PDF 19 + sync 12 + demo 4).
