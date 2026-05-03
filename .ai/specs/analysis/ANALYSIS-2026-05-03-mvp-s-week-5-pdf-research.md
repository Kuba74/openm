# MVP-S Week 5 — PDF Renderer Research + Prototype

**Date:** 2026-05-03
**Target window:** 27.05 – 31.05.2026 (Week 5 of May MVP-S)
**Companion to:** [2026-05-03-partner-master-migration.md](../2026-05-03-partner-master-migration.md), ADR-8
**Status:** Research complete — ready for implementation when Week 4 closes

## TLDR

`@react-pdf/renderer` v4.x jest najlepszą opcją dla tego stack'a (Next.js 16 + React 19): React-native API, server-side rendering bez headless browser, ~500KB bundle. Polskie znaki wymagają register'owania niesystemowego fontu (Roboto / Inter / Noto Sans). Prototyp template'a B2B oferty PL: 1 strona A4, header z wystawcą + numer + datą, blok klienta + kontakt + adres, tabela pozycji, podsumowanie netto/VAT/brutto z grupowaniem stawek, warunki płatności, stopka. Dwie strony jeśli >20 pozycji. Estymata implementacji: **~16 h** (4 h template + 4 h font/i18n + 4 h API endpoint + 4 h testy + edge cases).

## Wybór biblioteki

### `@react-pdf/renderer` (rekomendacja — confirmed ADR-8)

Wybrana na podstawie ADR-8 z master spec.

**Plus:**
- React-native API: piszesz `<Page><View><Text>` — naturalne dla zespołu znającego React
- Server-side w Next.js: `renderToBuffer()`/`renderToStream()` w API route — bez headless Chrome
- Wsparcie dla React 19 od v4.0.0
- `@react-email/components` już jest w `dependencies` (powiązany ekosystem) — nie blokuje, ale sygnalizuje że team jest zaznajomiony z deklaratywnymi PDF-ami
- Bundle ~500 KB (lib) + 200-400 KB (custom fonty), bez Chromium binary
- Embedded fonts via `Font.register({ family, src })` — wsparcie dla TTF/WOFF
- Style API zbliżony do Flexbox CSS

**Minus:**
- Mniej kontroli niż HTML+CSS (nie ma `display: grid`, nie ma full CSS3)
- Tabele wymagają ręcznego layoutu przez `View flexDirection: row`
- Polskie znaki wymagają eksplicytnego font.register'u (system fonts mogą nie obsługiwać PL Latin Extended)
- Page-break: częściowo automatyczny dla `Text`, ale dla `View` trzeba ręcznie kontrolować

### Odrzucone alternatywy

| Lib | Powód odrzucenia |
|---|---|
| `puppeteer` (HTML→PDF) | Wymaga Chromium binary w produkcji (300+ MB), runtime cost wysokie, deployment skomplikowany w containerach |
| `pdfkit` | Niskopoziomowe API, wymaga ręcznego pozycjonowania, brak React idiom |
| `pdfmake` | JSON-DSL, mniej elastyczny niż React, słabsze wsparcie dla custom fontów |
| `playwright pdf` | Jak puppeteer (Chromium) |
| `jsPDF` | Klient-side oriented, słabe dla complex layouts, problem z polskimi znakami |

## Konfiguracja w monorepo

### Dodanie zależności

```bash
# w packages/core/src/modules/sales/package.json (lub ogólnie monorepo root)
yarn add @react-pdf/renderer
```

Wersja: ostatnia stabilna 4.x.

### Lokalizacja kodu

```
packages/core/src/modules/sales/pdf/
├── fonts/
│   ├── Roboto-Regular.ttf
│   ├── Roboto-Bold.ttf
│   ├── Roboto-Italic.ttf
│   └── README.md (licencja Apache 2.0)
├── components/
│   ├── DocumentHeader.tsx       # logo + numer + data
│   ├── PartiesSection.tsx       # wystawca + nabywca + kontakt
│   ├── LinesTable.tsx           # tabela pozycji
│   ├── TotalsSection.tsx        # podsumowanie netto/VAT/brutto z grupowaniem
│   ├── PaymentTermsSection.tsx
│   └── DocumentFooter.tsx       # stopka
├── templates/
│   ├── QuotePdfPL.tsx           # template oferty B2B (PL)
│   ├── InvoicePdfPL.tsx         # post-MVP
│   └── shared.ts                # styles, common helpers
└── render.ts                    # renderToBuffer / renderToStream entry
```

### API endpoint

`packages/core/src/modules/sales/api/quotes/[id]/pdf/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { resolveOrganizationScopeForRequest } from '@open-mercato/shared/lib/auth'
import { QuotePdfPL } from '@open-mercato/core/modules/sales/pdf/templates/QuotePdfPL'
import { fetchQuoteSnapshot } from '../../../../lib/quoteSnapshot'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = await params
  const scope = await resolveOrganizationScopeForRequest(req)
  if (!scope.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!scope.features.includes('sales.quotes.view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  
  const snapshot = await fetchQuoteSnapshot(scope.em, id, scope)
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  
  const buffer = await renderToBuffer(<QuotePdfPL snapshot={snapshot} locale="pl" />)
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
  responses: {
    200: { description: 'PDF binary stream', content: { 'application/pdf': {} } },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Quote not found' },
  },
}
```

## Polskie znaki — register fontu

```typescript
// pdf/templates/shared.ts
import { Font } from '@react-pdf/renderer'

Font.register({
  family: 'Roboto',
  fonts: [
    { src: '/fonts/Roboto-Regular.ttf', fontWeight: 'normal' },
    { src: '/fonts/Roboto-Bold.ttf', fontWeight: 'bold' },
    { src: '/fonts/Roboto-Italic.ttf', fontStyle: 'italic' },
  ],
})

export const styles = StyleSheet.create({
  page: {
    fontFamily: 'Roboto',
    fontSize: 9,
    padding: 36,  // 36pt = 0.5 inch margin
    backgroundColor: '#ffffff',
  },
  // ... rest
})
```

**Roboto** ma pełne wsparcie dla Latin Extended (ą, ć, ę, ł, ń, ó, ś, ź, ż). Apache 2.0 license — można redystrybuować.

## Layout templatu (A4 portrait)

```
┌────────────────────────────────────────────────────────────────────┐
│  [Logo wystawcy]                                  OF/2026/00001    │  ← header (60pt)
│  Open Mercato Sp. z o.o.                          Data: 03.05.2026  │
│  ul. Przykładowa 1, 00-000 Warszawa               Termin: 02.06.2026│
│  NIP: 5260250995                                                    │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  WYSTAWCA                       │  NABYWCA                          │  ← parties (80pt)
│  Open Mercato Sp. z o.o.        │  Acme Industries Sp. z o.o.       │
│  ul. Przykładowa 1              │  ul. Klienta 5                    │
│  00-000 Warszawa                │  31-000 Kraków                    │
│  NIP: 5260250995                │  NIP: 6790012345                  │
│                                 │                                   │
│                                 │  Kontakt: Jan Kowalski            │
│                                 │  jan.kowalski@acme.com            │
│                                 │  +48 600 100 200                  │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Lp │ Opis pozycji                       │ Ilość│ J.M.│ Cena j.   │  ← lines (variable)
│     │                                    │      │     │ netto     │
│  ───┼────────────────────────────────────┼──────┼─────┼───────────│
│   1 │ Widget standardowy                 │  10  │ szt.│ 100.00    │
│     │ SKU: WGT-STD-001                   │      │     │           │
│     │ Rabat: 5%                          │      │     │           │
│   2 │ Usługa instalacji                  │   1  │ h   │  500.00   │
│   3 │ Pozycja tekstowa (np. uwaga)       │      │     │           │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                              Podsumowanie:                          │  ← totals (right-aligned)
│                                                                     │
│  Stawka VAT │ Netto      │ VAT       │ Brutto                       │
│  ───────────┼────────────┼───────────┼────────                      │
│  23%        │ 1450.00 zł │ 333.50 zł │ 1783.50 zł                   │
│  8%         │   50.00 zł │   4.00 zł │   54.00 zł                   │
│  zw.        │  100.00 zł │   0.00 zł │  100.00 zł                   │
│  ───────────┼────────────┼───────────┼────────                      │
│  Razem      │ 1600.00 zł │ 337.50 zł │ 1937.50 zł                   │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Warunki płatności: Przelew 14 dni                                  │  ← terms (40pt)
│  Numer konta: PL61 1090 1014 0000 0712 1981 2874                    │
│  Waluta: PLN                                                        │
│                                                                     │
│  Uwagi:                                                             │
│  Lorem ipsum dolor sit amet...                                      │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│  Open Mercato Sp. z o.o. │ KRS 0000123456 │ www.openmercato.pl  1/1│  ← footer (20pt)
└────────────────────────────────────────────────────────────────────┘
```

## Prototyp template'a (skeleton)

```typescript
// pdf/templates/QuotePdfPL.tsx
import React from 'react'
import { Document, Page, View, Text, StyleSheet, Font } from '@react-pdf/renderer'

Font.register({
  family: 'Roboto',
  fonts: [
    { src: '/fonts/Roboto-Regular.ttf', fontWeight: 'normal' },
    { src: '/fonts/Roboto-Bold.ttf', fontWeight: 'bold' },
  ],
})

const styles = StyleSheet.create({
  page: { fontFamily: 'Roboto', fontSize: 9, padding: 36, backgroundColor: '#ffffff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  issuerBlock: { width: '50%' },
  issuerName: { fontWeight: 'bold', fontSize: 12, marginBottom: 4 },
  issuerLine: { fontSize: 8, color: '#444' },
  numberBlock: { width: '50%', alignItems: 'flex-end' },
  numberLabel: { fontSize: 8, color: '#666' },
  numberValue: { fontWeight: 'bold', fontSize: 14, marginBottom: 4 },
  parties: { flexDirection: 'row', marginVertical: 16, gap: 12 },
  partyCard: { flex: 1, padding: 8, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4 },
  partyTitle: { fontSize: 8, fontWeight: 'bold', color: '#666', marginBottom: 4 },
  linesTable: { marginVertical: 16 },
  linesHeader: { flexDirection: 'row', backgroundColor: '#f3f4f6', padding: 6, fontWeight: 'bold' },
  linesRow: { flexDirection: 'row', padding: 6, borderBottomWidth: 0.5, borderColor: '#e5e7eb' },
  colNo: { width: '5%' },
  colDesc: { width: '50%' },
  colQty: { width: '10%', textAlign: 'right' },
  colUnit: { width: '10%', textAlign: 'center' },
  colPrice: { width: '12%', textAlign: 'right' },
  colTotal: { width: '13%', textAlign: 'right' },
  totalsBlock: { marginVertical: 12, alignItems: 'flex-end' },
  totalsTable: { width: '60%' },
  totalsRow: { flexDirection: 'row', padding: 4 },
  totalsRowFinal: { flexDirection: 'row', padding: 6, marginTop: 4, borderTopWidth: 1, borderColor: '#000', fontWeight: 'bold' },
  termsSection: { marginVertical: 12, padding: 8, backgroundColor: '#f9fafb', borderRadius: 4 },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 7, color: '#999', flexDirection: 'row', justifyContent: 'space-between' },
})

type QuoteSnapshot = {
  number: string
  issuedAt: string  // ISO date
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
    taxRate: number
    taxRateLabel: string  // e.g. '23%' or 'zw.'
    isExempt: boolean
    netTotal: number
  }>
  totalsByVatRate: Array<{
    rateLabel: string
    netTotal: number
    vatTotal: number
    grossTotal: number
  }>
  grandTotal: { net: number; vat: number; gross: number }
  paymentTerms: string | null
  bankAccountIban: string | null
  notes: string | null
}

function formatPLN(amount: number, currency: string): string {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pl-PL')
}

export function QuotePdfPL({ snapshot }: { snapshot: QuoteSnapshot }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.issuerBlock}>
            <Text style={styles.issuerName}>{snapshot.issuer.name}</Text>
            <Text style={styles.issuerLine}>{snapshot.issuer.address}</Text>
            <Text style={styles.issuerLine}>NIP: {snapshot.issuer.nip}</Text>
            {snapshot.issuer.krs && <Text style={styles.issuerLine}>KRS: {snapshot.issuer.krs}</Text>}
          </View>
          <View style={styles.numberBlock}>
            <Text style={styles.numberLabel}>OFERTA</Text>
            <Text style={styles.numberValue}>{snapshot.number}</Text>
            <Text style={styles.issuerLine}>Data: {formatDate(snapshot.issuedAt)}</Text>
            {snapshot.validUntil && <Text style={styles.issuerLine}>Termin ważności: {formatDate(snapshot.validUntil)}</Text>}
          </View>
        </View>

        {/* Parties */}
        <View style={styles.parties}>
          <View style={styles.partyCard}>
            <Text style={styles.partyTitle}>WYSTAWCA</Text>
            <Text style={{ fontWeight: 'bold' }}>{snapshot.issuer.name}</Text>
            <Text>{snapshot.issuer.address}</Text>
            <Text>NIP: {snapshot.issuer.nip}</Text>
          </View>
          <View style={styles.partyCard}>
            <Text style={styles.partyTitle}>NABYWCA</Text>
            <Text style={{ fontWeight: 'bold' }}>{snapshot.customer.name}</Text>
            <Text>{snapshot.customer.address}</Text>
            {snapshot.customer.nip && <Text>NIP: {snapshot.customer.nip}</Text>}
            {snapshot.contact && (
              <>
                <Text style={{ marginTop: 4 }}>Kontakt: {snapshot.contact.name}</Text>
                <Text>{snapshot.contact.email}</Text>
                <Text>{snapshot.contact.phone}</Text>
              </>
            )}
          </View>
        </View>

        {/* Lines */}
        <View style={styles.linesTable}>
          <View style={styles.linesHeader}>
            <Text style={styles.colNo}>Lp</Text>
            <Text style={styles.colDesc}>Opis pozycji</Text>
            <Text style={styles.colQty}>Ilość</Text>
            <Text style={styles.colUnit}>J.M.</Text>
            <Text style={styles.colPrice}>Cena j. netto</Text>
            <Text style={styles.colTotal}>Wartość netto</Text>
          </View>
          {snapshot.lines.map((line) => (
            <View key={line.no} style={styles.linesRow} wrap={false}>
              <Text style={styles.colNo}>{line.no}</Text>
              <View style={styles.colDesc}>
                <Text>{line.description}</Text>
                {line.sku && <Text style={{ fontSize: 7, color: '#666' }}>SKU: {line.sku}</Text>}
                {line.discount && (
                  <Text style={{ fontSize: 7, color: '#dc2626' }}>
                    Rabat: {line.discount.type === 'percent' ? `${line.discount.value}%` : formatPLN(line.discount.value, snapshot.currencyCode)}
                  </Text>
                )}
              </View>
              <Text style={styles.colQty}>{line.quantity}</Text>
              <Text style={styles.colUnit}>{line.unit}</Text>
              <Text style={styles.colPrice}>{formatPLN(line.unitNet, snapshot.currencyCode)}</Text>
              <Text style={styles.colTotal}>{formatPLN(line.netTotal, snapshot.currencyCode)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalsTable}>
            <View style={styles.linesHeader}>
              <Text style={{ width: '25%' }}>Stawka VAT</Text>
              <Text style={{ width: '25%', textAlign: 'right' }}>Netto</Text>
              <Text style={{ width: '25%', textAlign: 'right' }}>VAT</Text>
              <Text style={{ width: '25%', textAlign: 'right' }}>Brutto</Text>
            </View>
            {snapshot.totalsByVatRate.map((row) => (
              <View key={row.rateLabel} style={styles.totalsRow}>
                <Text style={{ width: '25%' }}>{row.rateLabel}</Text>
                <Text style={{ width: '25%', textAlign: 'right' }}>{formatPLN(row.netTotal, snapshot.currencyCode)}</Text>
                <Text style={{ width: '25%', textAlign: 'right' }}>{formatPLN(row.vatTotal, snapshot.currencyCode)}</Text>
                <Text style={{ width: '25%', textAlign: 'right' }}>{formatPLN(row.grossTotal, snapshot.currencyCode)}</Text>
              </View>
            ))}
            <View style={styles.totalsRowFinal}>
              <Text style={{ width: '25%' }}>Razem</Text>
              <Text style={{ width: '25%', textAlign: 'right' }}>{formatPLN(snapshot.grandTotal.net, snapshot.currencyCode)}</Text>
              <Text style={{ width: '25%', textAlign: 'right' }}>{formatPLN(snapshot.grandTotal.vat, snapshot.currencyCode)}</Text>
              <Text style={{ width: '25%', textAlign: 'right' }}>{formatPLN(snapshot.grandTotal.gross, snapshot.currencyCode)}</Text>
            </View>
          </View>
        </View>

        {/* Terms */}
        {(snapshot.paymentTerms || snapshot.bankAccountIban || snapshot.notes) && (
          <View style={styles.termsSection}>
            {snapshot.paymentTerms && <Text>Warunki płatności: {snapshot.paymentTerms}</Text>}
            {snapshot.bankAccountIban && <Text>Numer konta: {snapshot.bankAccountIban}</Text>}
            <Text>Waluta: {snapshot.currencyCode}</Text>
            {snapshot.notes && (
              <>
                <Text style={{ marginTop: 6, fontWeight: 'bold' }}>Uwagi:</Text>
                <Text>{snapshot.notes}</Text>
              </>
            )}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>{snapshot.issuer.name} {snapshot.issuer.krs ? `· KRS ${snapshot.issuer.krs}` : ''}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
```

## Edge cases do testów (Week 5)

| # | Scenariusz | Oczekiwane zachowanie |
|---|---|---|
| E1 | 1 pozycja, 1 stawka VAT (23%) | Single-row totals, single-line table |
| E2 | 20+ pozycji | Page break automatic; nagłówek i stopka na każdej stronie |
| E3 | Bardzo długi opis pozycji | Tekst wrapuje się, wiersz rośnie wertyklanie |
| E4 | Pozycja tekstowa (bez ceny) | Ilość/cena/wartość puste, opis pełnowartościowo |
| E5 | Multi-VAT (23% + 8% + 5% + 0% + zw.) | 5 wierszy w totals + Razem |
| E6 | 100% rabat | Wartość netto = 0, VAT = 0, Brutto = 0 |
| E7 | Rabat % vs kwotowy | Etykieta różna, wartość netto poprawna |
| E8 | Brak NIP customer (B2C) | Pole NIP nie pojawia się w party-block |
| E9 | Brak primary contact | Sekcja "Kontakt" w party-block ukryta |
| E10 | Polskie znaki (ąćęłńóśźż, ĄĆĘŁŃÓŚŹŻ) | Renderują się poprawnie via Roboto |
| E11 | Bardzo duże kwoty (>1 mln PLN) | Format z separatorami `1 234 567,89 zł` |
| E12 | Grosze (0.01 PLN) | Wyświetlanie 2 miejsc po przecinku |
| E13 | EUR currency | `1 234,56 €` zamiast `zł` |
| E14 | Brak `validUntil` | Pole "Termin ważności" ukryte |
| E15 | `vat-zw` exempt rate | Etykieta "zw." zamiast "0%", VAT 0.00 zł |

## API-side: `fetchQuoteSnapshot`

Przed renderowaniem PDF musimy zebrać snapshot wszystkich danych. Helper w `lib/quoteSnapshot.ts`:

```typescript
export async function fetchQuoteSnapshot(
  em: EntityManager,
  quoteId: string,
  scope: { organizationId: string; tenantId: string },
): Promise<QuoteSnapshot | null> {
  // 1. Load SalesQuote with lines + adjustments
  // 2. Load issuer (Organization or settings)
  // 3. Load customer entity + company profile + tax_identities + primary contact + primary address
  // 4. Calculate totals via salesCalculationService
  // 5. Group totals by VAT rate (including is_exempt distinction for "zw.")
  // 6. Resolve currency, payment terms, bank account from billing
  // 7. Format addresses (multi-line)
  // 8. Return shaped QuoteSnapshot
}
```

## Wydajność

- `renderToBuffer` synchroniczne dla 1-page PDF: ~50-200 ms server-side
- `renderToStream` dla streaming download: lepsze dla wielostronicowych dokumentów (>5 stron)
- Caching fontów: `Font.register` wykonuje się raz per process (cold start dorzuca ~100 ms)
- Bundle dodatek do server: ~500 KB lib + 300 KB Roboto fonts (ładowane lazy)

## Estymata implementacji Tygodnia 5

| Zadanie | h |
|---|---|
| Setup `@react-pdf/renderer` deps + font register + lokalizacja Roboto fonts | 2 h |
| `pdf/components/*` (DocumentHeader, PartiesSection, LinesTable, TotalsSection, Footer) | 6 h |
| `pdf/templates/QuotePdfPL.tsx` (komposycja + style) | 2 h |
| `lib/quoteSnapshot.ts` (data fetching + shaping) | 3 h |
| `api/quotes/[id]/pdf/route.ts` + RBAC + audit | 1 h |
| Testy: 15 edge cases (E1-E15 powyżej) | 4 h |
| i18n keys (PL primary, EN/DE/ES jako klucze "Quote/Invoice templates" w post-MVP) | 1 h |
| **Razem** | **~19 h** |

Jest budżet 40 h w Tygodniu 5 — buffer ~21 h na PDF tweaks + sync historycznych ofert + demo prep.

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| W5.1 | Polski znak nie renderuje się (font issue) | High | Test E10 critical-path; fallback na Inter lub Noto Sans |
| W5.2 | Page break wewnątrz tabeli pozycji wycina wiersz | Medium | `<View wrap={false}>` na każdym wierszu; manualny `break` po N pozycjach |
| W5.3 | `Intl.NumberFormat('pl-PL', ...)` zwraca symbol "zł" zamiast "PLN" | Low | Use `currencyDisplay: 'symbol'` (default) — to celowe |
| W5.4 | Bardzo duży snapshot (1000+ pozycji) wolny renderToBuffer (>5 s) | Low | MVP limit do 100 pozycji per oferta; warning UI; later: stream |
| W5.5 | Server-side fetch fontów nie działa (404) | Medium | Embed fonts via `import` zamiast URL; lub `fs.readFileSync` w server context |
| W5.6 | Bundle size powiększa cold start Next.js o ~1s | Low | Lazy-import w API route, nie eager w app boot |

## Decisions ratified

1. **Library:** `@react-pdf/renderer` v4.x (per ADR-8)
2. **Font:** Roboto (Apache 2.0), embedded as static assets
3. **Layout:** A4 portrait, single page MVP, multi-page later
4. **VAT grouping:** rate-by-rate w totals z eksplicytnym wierszem dla `is_exempt` jako "zw."
5. **Currency formatting:** `Intl.NumberFormat('pl-PL', { style: 'currency', currency })` — natywne PL formatowanie
6. **PDF download mode:** `Content-Disposition: attachment` (forced download); osobny endpoint `?inline=1` dla preview later

## Action items

1. ⏳ Czekać na Week 1-4 lądowania
2. Po Tygodniu 4: dodać `@react-pdf/renderer` do package.json + Roboto fonts
3. Pisać per-phase spec `2026-05-03-mvp-s-week-5-quote-pdf.md` z konkretnym planem
4. Implementacja zgodnie z estymatą (~19 h)
