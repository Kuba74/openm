# MVP-S Week 3 Readiness — Quote UI

**Date:** 2026-05-03
**Target window:** 13.05 – 19.05.2026 (Week 3 of May MVP-S)
**Companion to:** [2026-05-03-partner-master-migration.md](../2026-05-03-partner-master-migration.md), [2026-05-03-openm-sales-readiness.md](ANALYSIS-2026-05-03-openm-sales-readiness.md)
**Status:** Audit complete — ready for spec

## TLDR

`/backend/sales/quotes` page is a 7-line wrapper around the shared `SalesDocumentsTable` component (741 lines). The detail page is a 4869-line shared `SalesDocumentDetailPage` with 10+ sections (fields, custom data, tags, notes, addresses, items, shipments, returns, adjustments, payments). The form (`SalesDocumentForm`, 1426 lines) handles kind selector, document number, currency, channel, customer, shipping/invoice address with snapshot+select modes, customer duplicate detection, and inbox pre-fill. Week 3 is **wiring + tweaks**, not building. Estimated **~10 h** (down from ~16 h).

## What's already there

### List page (`/backend/sales/quotes/page.tsx`)

```typescript
"use client"
import SalesDocumentsTable from '../../../components/documents/SalesDocumentsTable'
export default function SalesQuotesPage() {
  return <SalesDocumentsTable kind="quote" />
}
```

Same pattern for orders (`kind="order"`). All logic lives in the shared table.

### `SalesDocumentsTable` columns (7)

| Column | Source | Sortable |
|---|---|---|
| Quote number + status badge | `number` + DictionaryValue(`status`) | Yes |
| Customer (name + email) | `customerName`, `customerEmail` | No |
| Channel | `channelId` mapped to channel options | No |
| Items count | `lineItemCount` | Yes |
| Total (net) | `totalNet` formatted by currency | Yes |
| Total (gross) | `totalGross` formatted by currency | Yes |
| Date | `date` | Yes |

### `SalesDocumentsTable` filters (8)

| Filter | Type |
|---|---|
| Channel | dropdown |
| Date | date range |
| Items min/max | number |
| Total net min/max | number |
| Total gross min/max | number |
| Customer | multi-select with search |
| Tags | multi-select |

### `SalesDocumentsTable` row actions (2)

- **Open** → `/backend/sales/quotes/{id}?kind=quote`
- **Delete** → `handleDelete` with confirmation

### Detail page sections (`[id]/page.tsx`, 4869 lines)

```
DetailFieldsSection           // Top fields (number, currency, channel, customer, dates, status)
CustomDataSection             // Custom fields
TagsSection                   // Tags
NotesSection                  // Comments/notes
SalesDocumentAddressesSection // Shipping + invoice
SalesDocumentItemsSection     // Line items with edit
SalesShipmentsSection         // Shipments tracking
SalesReturnsSection           // Returns
SalesDocumentAdjustmentsSection // Discounts/surcharges
SalesDocumentPaymentsSection  // Payments
SectionCard "Timestamps"      // Created/updated/etc.
```

### `SalesDocumentForm` fields

| Field | Type | Notes |
|---|---|---|
| Document kind | toggle (quote/order) | Custom component |
| Document number | custom | Auto-generated; editable with permission |
| Currency | DictionaryEntrySelect | With inline-create disabled (managed elsewhere) |
| Channel | LookupSelect | With Store icon, search, empty state |
| Customer | LookupSelect with duplicate detection | Saves entityId; loads addresses on change |
| Shipping address | snapshot OR existing select | `useCustomShipping` toggle, AddressEditor for draft |
| Invoice address | (similar to shipping) | Toggle `useCustomInvoice` |

### Customer pre-fill (partial)

- `inboxPreFill?.customerEntityId` — pre-fills customer from inbox flow
- `loadAddresses(customerEntityId)` — auto-loads existing addresses on customer change
- **Not pre-filled:** primary contact, currency from billing, payment terms from billing, sales owner, default validity days

## Coverage matrix — EPIC S3 vs reality

| EPIC story | Status |
|---|---|
| **S3.1 Lista ofert** — kolumny: numer, klient, kontakt, status, data, termin ważności, wartość netto, brutto, opiekun | ⚠️ 7/9 mamy. **BRAKUJE:** kontakt (osoba), validUntil, opiekun |
| **S3.1 Filters:** status, klient, opiekun, data | ⚠️ klient + data są. **BRAKUJE:** filter status (sortowane po status w kolumnie ale brak filtra), filter opiekun |
| **S3.1 Search po numerze i kliencie** | ✅ (search header + customer filter) |
| **S3.1 Pusty stan + skeleton + Nowa oferta button** | ✅ |
| **S3.2 Numeracja** | ✅ (Week 2 — wymaga konfiguracji PL formatów) |
| **S3.3 Tworzenie nagłówka** — pre-fill kontakt/adres/warunki/waluta | ⚠️ adres tak. **BRAKUJE:** kontakt, paymentTerms, currency, salesOwner, validityDays |
| **S3.4 Edycja nagłówka** — blokada w ACCEPTED/REJECTED/CANCELLED | ❓ (do weryfikacji w `[id]/page.tsx`) |
| **S3.7 Statusy oferty + przejścia** | ✅ (API endpoints `/quotes/accept`, `/quotes/send`, `/quotes/convert` istnieją) |
| **S3.8 Szczegóły oferty** — wszystkie sekcje | ✅✅ (10+ sekcji już są) |

## Gaps for Week 3

### Gap 1 — Brakujące kolumny w liście (3 h)

Dodać do `SalesDocumentsTable.tsx` columns memo:

```typescript
{
  id: 'validUntil',
  accessorKey: 'validUntil',
  header: t('sales.documents.list.table.validUntil', 'Valid until'),
  cell: ({ row }) => row.original.validUntil
    ? <span className="text-xs">{new Date(row.original.validUntil).toLocaleDateString()}</span>
    : <span className="text-xs text-muted-foreground">—</span>,
},
{
  id: 'salesOwnerName',
  accessorKey: 'salesOwnerName',
  header: t('sales.documents.list.table.salesOwner', 'Sales owner'),
  cell: ({ row }) => (
    <span className="text-sm">{row.original.salesOwnerName ?? '—'}</span>
  ),
  enableSorting: false,
},
{
  id: 'primaryContact',
  accessorKey: 'primaryContactName',
  header: t('sales.documents.list.table.contact', 'Contact'),
  cell: ({ row }) => (
    <span className="text-sm">{row.original.primaryContactName ?? '—'}</span>
  ),
  enableSorting: false,
},
```

Backend changes needed:
- Quote API response must include `validUntil` (already on entity)
- Add `salesOwnerName` resolved from `salesOwnerUserId` (depends on Week 1 PR's `customer_company_billing.sales_owner_user_id`)
- Add `primaryContactName` resolved via `getPrimaryContact()` helper (Week 1)

**Dependencies:** PR #3 (Week 1 completion) merge.

### Gap 2 — Brakujące filtry (2 h)

Status filter:

```typescript
{
  id: 'status',
  type: 'multi-select',
  label: t('sales.documents.list.filters.status', 'Status'),
  options: () => fetchStatusOptions('quote'),
},
```

Sales owner filter:

```typescript
{
  id: 'salesOwnerUserId',
  type: 'multi-select',
  label: t('sales.documents.list.filters.salesOwner', 'Sales owner'),
  options: () => fetchAssignableStaff(),
},
```

API support:
- `/api/sales/quotes` GET should accept `?status=draft,sent,accepted` and `?salesOwnerUserId=uuid1,uuid2`

### Gap 3 — Customer pre-fill chain (3 h)

W `SalesDocumentForm.tsx` rozszerzyć logikę zmiany klienta. Po wyborze `customerEntityId`:

```typescript
const handleCustomerChange = useCallback(async (customerId: string | null) => {
  setValue('customerEntityId', customerId)
  if (!customerId) return
  
  const enrichment = await apiCallOrThrow<{
    primaryContactId: string | null
    primaryContactName: string | null
    primaryEmail: string | null
    primaryPhone: string | null
    defaultShippingAddressId: string | null
    defaultBillingAddressId: string | null
    preferredCurrency: string | null
    paymentTerms: string | null
    salesOwnerUserId: string | null
    defaultOfferValidityDays: number
  }>(`/api/customers/companies/${customerId}/sales-defaults`)
  
  // Auto-fill if user hasn't set yet
  if (!values.contactName && enrichment.primaryContactName) {
    setValue('contactName', enrichment.primaryContactName)
    setValue('contactEmail', enrichment.primaryEmail)
    setValue('contactPhone', enrichment.primaryPhone)
  }
  if (!values.shippingAddressId && enrichment.defaultShippingAddressId) {
    setValue('shippingAddressId', enrichment.defaultShippingAddressId)
  }
  if (!values.invoiceAddressId && enrichment.defaultBillingAddressId) {
    setValue('invoiceAddressId', enrichment.defaultBillingAddressId)
  }
  if (!values.currencyCode && enrichment.preferredCurrency) {
    setValue('currencyCode', enrichment.preferredCurrency)
  }
  if (!values.paymentTerms && enrichment.paymentTerms) {
    setValue('paymentTerms', enrichment.paymentTerms)
  }
  if (!values.salesOwnerUserId && enrichment.salesOwnerUserId) {
    setValue('salesOwnerUserId', enrichment.salesOwnerUserId)
  }
  if (!values.validUntil) {
    const validUntil = new Date()
    validUntil.setDate(validUntil.getDate() + enrichment.defaultOfferValidityDays)
    setValue('validUntil', validUntil.toISOString())
  }
}, [setValue, values])
```

New API endpoint `/api/customers/companies/[id]/sales-defaults` returns aggregated pre-fill payload (uses Week 1 helpers).

### Gap 4 — `validUntil` field on form (1 h)

Add to `SalesDocumentForm` field list:

```typescript
{
  id: 'validUntil',
  label: t('sales.documents.form.validUntil', 'Valid until'),
  type: 'date',
  required: false,
  // pre-filled from customer billing's defaultOfferValidityDays
},
```

### Gap 5 — Sales owner field on form (1 h)

```typescript
{
  id: 'salesOwnerUserId',
  label: t('sales.documents.form.salesOwner', 'Sales owner'),
  type: 'custom',
  component: ({ value, setValue }) => (
    <AssignableStaffSelect
      value={typeof value === 'string' ? value : null}
      onChange={(next) => setValue(next)}
      placeholder={t('sales.documents.form.salesOwner.placeholder', 'Assign sales owner')}
    />
  ),
},
```

(`AssignableStaffSelect` component should exist in customers or staff module — verify.)

### Gap 6 — Status edit lock per workflow (verification needed, 0-2 h)

Verify in `[id]/page.tsx` (line ~4791 and around):
- When `status === 'accepted' | 'rejected' | 'cancelled'`, edit button disabled
- DetailFieldsSection respects readonly state

If not implemented, add `editable` flag to all section components based on status enum.

## Re-estimate vs original EPIC plan

| Story | Original EPIC | After audit |
|---|---|---|
| S3.1 Lista ofert | 16 h | 5 h (3 nowe kolumny + 2 nowe filtry + i18n) |
| S3.2 Numeracja | (Week 2) | (Week 2) |
| S3.3 Tworzenie nagłówka + pre-fill | 12 h | 4 h (handleCustomerChange + nowy API endpoint) |
| S3.4 Edycja nagłówka | 6 h | 0-2 h (verification, możliwe że już jest) |
| S3.8 Szczegóły oferty (layout) | 6 h | 0 h (już są) |
| **Razem Tydzień 3** | **40 h** | **~10 h** |

**Slack: ~30 h** w Tygodniu 3. Use for:
- Polski layout customizacja (jeśli klient chce inny układ pól)
- Status filter UI polish
- Bonus: bulk-actions na liście (np. mass-status-change)
- Bufor

## Dependencies

- **PR #1 (Phase 1)** — wymagane dla `customer_tax_identities`
- **PR #3 / Week 1 completion PR (Agent #4)** — wymagane dla:
  - `getPrimaryContact()` helper
  - `getDefaultOfferAddress()` helper
  - `customer_company_billing.salesOwnerUserId` + `defaultOfferValidityDays`
  - `getSalesCustomers()` helper (dla customer filter scope)

Bez tych zmian Week 3 nie ma czego pre-fill'ować.

## Pre-implementation checks (przed startem Week 3)

```bash
# Sprawdź że Week 1 completion ma wszystkie potrzebne helpery
ls packages/core/src/modules/customers/lib/{salesCustomers,companyBilling,primaryContact,primaryAddress}.ts

# Sprawdź czy istnieje API klient defaults
ls packages/core/src/modules/customers/api/companies/[id]/sales-defaults/route.ts || echo "NOT FOUND — to be created"

# Sprawdź czy AssignableStaffSelect istnieje
grep -rl "AssignableStaffSelect" packages/core/src/modules/customers packages/core/src/modules/staff packages/ui/src
```

## Backward compatibility

Wszystkie zmiany **additive**:
- Nowe kolumny tabeli (zmiana payload API — additive, BC-safe)
- Nowy filtr (additive)
- Nowy field na formularzu (optional, default empty)
- Nowy API endpoint (`/api/customers/companies/[id]/sales-defaults` — nowy, no rename)

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| W3.1 | `AssignableStaffSelect` nie istnieje, trzeba zbudować | Low | Sprawdzić w pre-checks; podpiąć do `/api/staff/assignable-users` lub `/api/auth/users` |
| W3.2 | API quotes nie zwraca `validUntil` w listing payload | Low | 1-line dodanie do `api/quotes/route.ts` query select |
| W3.3 | Pre-fill nadpisuje user'a edycje przy switching customer w trakcie | Medium | Lookup chain `if (!values.X) setValue(...)` — pre-fill TYLKO gdy puste |
| W3.4 | `salesOwnerName` resolution wymaga JOIN z `auth.users` (cross-module) | Low | Per AGENTS.md "no direct ORM relationships between modules" — użyć response enricher z `auth` modułu |

## Pre-phase queries (post-PR-#1-#3-merge)

```sql
-- Sprawdź coverage validUntil na quotes
SELECT count(*) FILTER (WHERE valid_until IS NOT NULL) AS with_validity,
       count(*) AS total
FROM sales_quotes WHERE deleted_at IS NULL;

-- Sprawdź coverage salesOwner po Week 1
SELECT count(*) FILTER (WHERE sales_owner_user_id IS NOT NULL) AS with_owner,
       count(*) AS total
FROM customer_company_billing WHERE deleted_at IS NULL;
```

## Files to touch (Week 3 implementation)

| Path | Action |
|---|---|
| `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx` | + 3 columns, + 2 filters |
| `packages/core/src/modules/sales/components/documents/SalesDocumentForm.tsx` | + validUntil field, + salesOwner field, + handleCustomerChange pre-fill chain |
| `packages/core/src/modules/sales/api/quotes/route.ts` | + select validUntil, salesOwnerUserId, primaryContactId in list response |
| `packages/core/src/modules/sales/data/enrichers.ts` | + enricher resolving salesOwnerName from auth:user (response enricher pattern) |
| `packages/core/src/modules/customers/api/companies/[id]/sales-defaults/route.ts` | NEW (aggregated pre-fill payload) |
| `packages/core/src/modules/sales/i18n/{en,pl,de,es}.json` | + labels (validUntil, salesOwner, contact column, status filter) |
| `packages/core/src/modules/sales/components/__tests__/SalesDocumentsTable.test.tsx` | + tests for new columns/filters |
| `packages/core/src/modules/sales/__integration__/TC-MVP-S-W3-quote-prefill.spec.ts` | NEW |

## Decision points

1. **Status filter location** — w toolbar czy w drawer? Aktualnie status jest w kolumnie (sort). Rekomenduję: drawer + chip w toolbar (wiele wartości).
2. **Pre-fill behavior on customer change mid-edit** — czy przy zmianie customer'a NADPISYWAĆ istniejące wartości? Rekomenduję: NIE (`if (!values.X) setValue(...)`), ale pokazać banner "Customer changed — refresh defaults?" z buttonem.
3. **Sales owner column** — pokazywać display name czy email? Rekomenduję: name z fallback na email (per `auth:user`).
4. **`validUntil` default** — current date + customer's defaultOfferValidityDays. Jeśli klient nie ma billing → SalesSettings default → 30 dni hardcoded.

## Action items

1. ⏳ Czekać na PR #3 / Week 1 completion merge
2. Po merge: uruchomić pre-implementation checks
3. Pisać per-phase spec `2026-05-03-mvp-s-week-3-quote-ui.md` z konkretnym diffem
4. Decyzje 1-4 powyżej

## Sources

- `packages/core/src/modules/sales/backend/sales/quotes/page.tsx` (7 linii — wrapper)
- `packages/core/src/modules/sales/backend/sales/quotes/[id]/page.tsx` (7 linii — wrapper)
- `packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx` (4869 linii — shared detail)
- `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx` (741 linii — list)
- `packages/core/src/modules/sales/components/documents/SalesDocumentForm.tsx` (1426 linii — form)
- `packages/core/src/modules/sales/components/documents/{Items,Addresses,Adjustments,Payments,Shipments,Returns}Section.tsx` (sekcje detali)
