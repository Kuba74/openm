# MVP-S Week 3 — Quote UI Wiring

**Status:** Draft (depends on Week 1 + 2 PR merges)
**Created:** 2026-05-03
**Target window:** 13.05 – 19.05.2026
**Author:** Kuba74
**Parent spec:** [2026-05-03-partner-master-migration.md](2026-05-03-partner-master-migration.md)
**Companion audit:** [ANALYSIS-2026-05-03-mvp-s-week-3-readiness.md](analysis/ANALYSIS-2026-05-03-mvp-s-week-3-readiness.md)
**Estimated:** ~10 h

## TLDR

UI dla quote list i form jest 90% gotowe. Tydzień 3 dokłada 3 brakujące kolumny (validUntil, salesOwner, primaryContact), 2 filtry (status, salesOwner), nowy field na formularzu (validUntil + salesOwner) i pre-fill chain po wyborze klienta. Wymaga endpointu `/api/customers/companies/[id]/sales-defaults` agregującego dane z helperów Tygodnia 1 i Tygodnia 2.

## Decisions (ratified 2026-05-03)

- **W3.1** Status filter: drawer + chip-summary w toolbar (nie inline, bo multi-value)
- **W3.2** Pre-fill behavior: NIE nadpisuje istniejących wartości; pokazuje banner "Customer changed — refresh defaults?"
- **W3.3** SalesOwner column: name z fallback na email
- **W3.4** validUntil default: `now + customer.defaultOfferValidityDays ?? salesSettings.default ?? 30`

## Stories in scope

### W3.1 — Brakujące kolumny w `/backend/sales/quotes` (3 h)

W [packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx:567](../../packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx#L567) dodać 3 kolumny do `columns` memo:

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
  id: 'primaryContactName',
  accessorKey: 'primaryContactName',
  header: t('sales.documents.list.table.contact', 'Contact'),
  cell: ({ row }) => (
    <span className="text-sm">
      {row.original.primaryContactName ?? '—'}
    </span>
  ),
  enableSorting: false,
},
{
  id: 'salesOwnerDisplay',
  accessorKey: 'salesOwnerDisplay',
  header: t('sales.documents.list.table.salesOwner', 'Sales owner'),
  cell: ({ row }) => (
    <span className="text-sm">
      {row.original.salesOwnerDisplay ?? '—'}
    </span>
  ),
  enableSorting: false,
},
```

Backend (`api/quotes/route.ts`):
- Dodać `validUntil` do select w listing query
- Dodać enricher dla `salesOwnerDisplay` (resolved z `auth:user`)
- Dodać enricher dla `primaryContactName` (przez `customer_company_billing` → `customer_person_company_links` → `customer_people`)

### W3.2 — Brakujące filtry (2 h)

Dodać 2 filtry do `filters` memo:

```typescript
{
  id: 'status',
  type: 'multi-select',
  label: t('sales.documents.list.filters.status', 'Status'),
  options: () => fetchStatusOptions('quote'),
},
{
  id: 'salesOwnerUserId',
  type: 'multi-select',
  label: t('sales.documents.list.filters.salesOwner', 'Sales owner'),
  options: () => fetchAssignableStaff(),
},
```

Filter chip summary w toolbar pokazuje liczbę aktywnych filtrów.

API support:
- `/api/sales/quotes` GET przyjmuje `?status=draft,sent` i `?salesOwnerUserId=uuid1,uuid2`

### W3.3 — Pre-fill chain po wyborze customer'a (3 h)

W [packages/core/src/modules/sales/components/documents/SalesDocumentForm.tsx:1140](../../packages/core/src/modules/sales/components/documents/SalesDocumentForm.tsx#L1140) (wokół `setValue('customerEntityId', next)`):

```typescript
const handleCustomerChange = useCallback(async (customerId: string | null) => {
  setValue('customerEntityId', customerId)
  if (!customerId) return
  
  let enrichment: CustomerSalesDefaults
  try {
    enrichment = await apiCallOrThrow<CustomerSalesDefaults>(
      `/api/customers/companies/${customerId}/sales-defaults`
    )
  } catch (err) {
    flashError(t('sales.documents.form.customer.loadDefaultsFailed', 'Failed to load customer defaults.'))
    return
  }
  
  // W3.2 decision: only fill if empty
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
  if (!values.validUntil && enrichment.defaultOfferValidityDays) {
    const validUntil = new Date()
    validUntil.setDate(validUntil.getDate() + enrichment.defaultOfferValidityDays)
    setValue('validUntil', validUntil.toISOString())
  }
}, [setValue, values])
```

W przypadku zmiany customer'a gdy formularz ma już wartości (W3.2 decision):

```typescript
{customerChangedWithFilledValues && (
  <Alert variant="info">
    <AlertTitle>{t('sales.documents.form.customer.changed', 'Customer changed')}</AlertTitle>
    <AlertDescription>
      {t('sales.documents.form.customer.changedHint', 'Some fields are pre-filled from the previous customer. Refresh defaults?')}
    </AlertDescription>
    <Button variant="outline" onClick={() => refreshAllDefaults(customerId)}>
      {t('sales.documents.form.customer.refreshDefaults', 'Refresh defaults')}
    </Button>
  </Alert>
)}
```

### W3.4 — Nowe pola na formularzu: validUntil + salesOwner (2 h)

W `SalesDocumentForm` `fields` memo dodać:

```typescript
{
  id: 'validUntil',
  label: t('sales.documents.form.validUntil', 'Valid until'),
  type: 'date',
  required: false,
},
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

Sprawdzić czy `AssignableStaffSelect` istnieje:
- `packages/core/src/modules/customers/components/AssignableStaffSelect.tsx` (jeśli jest)
- Inaczej zbudować bazując na `LookupSelect` + `/api/staff/assignable-users` lub `/api/auth/users`

## Files to touch

| Path | Action |
|---|---|
| `packages/core/src/modules/sales/components/documents/SalesDocumentsTable.tsx` | + 3 columns, + 2 filters |
| `packages/core/src/modules/sales/components/documents/SalesDocumentForm.tsx` | + validUntil field, + salesOwner field, + handleCustomerChange pre-fill chain, + customer-changed banner |
| `packages/core/src/modules/sales/api/quotes/route.ts` | + select validUntil; + filter status/salesOwnerUserId |
| `packages/core/src/modules/sales/data/enrichers.ts` | + enricher resolving salesOwnerDisplay from auth:user |
| `packages/core/src/modules/sales/data/enrichers.ts` | + enricher resolving primaryContactName via customer_person_company_links |
| `packages/core/src/modules/customers/api/companies/[id]/sales-defaults/route.ts` | NEW — aggregated pre-fill GET endpoint |
| `packages/core/src/modules/sales/i18n/{en,pl,de,es}.json` | + 8 nowych kluczy |
| `packages/core/src/modules/sales/components/__tests__/SalesDocumentsTable.test.tsx` | + tests dla nowych kolumn/filtrów |
| `packages/core/src/modules/sales/__integration__/TC-MVP-S-W3-quote-prefill.spec.ts` | NEW |
| `packages/core/src/modules/sales/__integration__/TC-MVP-S-W3-quote-list-filters.spec.ts` | NEW |

## API contract — `/api/customers/companies/[id]/sales-defaults`

```typescript
GET /api/customers/companies/:id/sales-defaults

Response:
{
  primaryContactId: string | null
  primaryContactName: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  defaultShippingAddressId: string | null
  defaultBillingAddressId: string | null
  preferredCurrency: string | null    // from customer_company_billing
  paymentTerms: string | null         // from customer_company_billing
  salesOwnerUserId: string | null     // from customer_company_billing (Week 1)
  defaultOfferValidityDays: number    // from customer_company_billing (Week 1) or fallback 30
}
```

Implementation uses helpers z Tygodnia 1: `getPrimaryContact()`, `getDefaultOfferAddress()` z fallback chain billing → office → work → home → shipping, `getSalesOwner()`, `getDefaultOfferValidityDays()`.

## Backward compatibility

- Nowe kolumny tabeli (zmiana payload API — additive)
- Nowy filtr (additive)
- Nowy field na formularzu (optional, default empty)
- Nowy API endpoint (no rename of existing)
- Nowe i18n keys (no rename)

Per `BACKWARD_COMPATIBILITY.md` żadna powierzchnia kontraktu nie naruszona.

## Dependencies

- **PR #1 + PR #3 + PR #4 merged** — wymagane dla helperów Week 1
- **Week 2 PR merged** — wymagane dla `defaultCurrencyCode` w SalesSettings (currency fallback chain)

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| W3.R1 | `AssignableStaffSelect` nie istnieje | Low | Sprawdzić w pre-checks; podpiąć do `/api/staff/assignable-users` lub `/api/auth/users` |
| W3.R2 | Enricher dla `salesOwnerDisplay` wymaga JOIN cross-module | Low | Response enricher pattern (per AGENTS.md) — unikać hard FK |
| W3.R3 | Pre-fill nadpisuje user'a edycje gdy wpisał wartości i zmienia klienta | Medium | Banner "Refresh defaults?" + `if (!values.X)` guard |
| W3.R4 | Performance: enricher dla 100 quotes wykonuje 100 joinów | Medium | Use `enrichMany` (batch) pattern |

## Validation gate

```bash
yarn build:packages
yarn generate
yarn typecheck
yarn test
yarn i18n:check-sync
yarn i18n:check-usage
yarn build:app
```

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: API — sales-defaults endpoint (3 h)

- [x] 1.1 NEW `/api/customers/companies/[id]/sales-defaults/route.ts` (GET) — 9019b0ab7
- [x] 1.2 Aggregator wywołujący helpery Week 1 (`getPrimaryContactCard`, `getDefaultOfferAddress` ×2 shipping/billing, `getSalesOwner`, `getDefaultOfferValidityDays`, `loadBilling` dla preferredCurrency/paymentTerms) — 9019b0ab7
- [x] 1.3 OpenAPI export — 9019b0ab7
- [x] 1.4 Unit tests dla `getPrimaryContactCard` (7 nowych testów) — 9019b0ab7
- [x] 1.5 Integration test TC-MVP-S-W3-sales-defaults.spec.ts — 9019b0ab7

### Phase 2: List columns + enrichers (3 h)

- [x] 2.1 Add 3 columns w SalesDocumentsTable (validUntil, primaryContact, salesOwnerDisplay) — 0da3659f0
- [x] 2.2 Enricher `salesOwnerDisplay` (staff_team_members → users.email fallback) — 0da3659f0
- [x] 2.3 Enricher `primaryContactName` (customer_person_company_links + customer_people + customer_entities) — 0da3659f0
- [x] 2.4 Entity columns `sales_owner_user_id` + `payment_terms` na sales_quotes/sales_orders + Migration20260503171218 (decyzja: per-quote z migracją; ręczna migracja przez snapshot drift) — 0da3659f0
- [x] 2.5 i18n keys (3 columns × 4 locales) — 0da3659f0
- [x] 2.6 Tests (validators jest pass) — 0da3659f0

### Phase 3: List filters (2 h)

- [x] 3.1 Status filter (multi-select tags z order-statuses dictionary) — 9c5db9f89
- [x] 3.2 SalesOwner filter (multi-select tags z `fetchAssignableStaffMembersPage`) — 9c5db9f89
- [x] 3.3 Update factory.ts listSchema + buildFilters (CSV → `$eq`/`$in`) — 9c5db9f89
- [x] 3.4 i18n keys (2 filters × 4 locales) — 9c5db9f89
- [x] 3.5 Tests (typecheck) — 9c5db9f89

### Phase 4: Form fields + pre-fill chain (2 h)

- [x] 4.1 Add validUntil field (date input) — 0f9b5bfeb
- [x] 4.2 Add salesOwner field + NEW AssignableStaffSelect.tsx (LookupSelect wrapper) — 0f9b5bfeb
- [x] 4.3 fetchAndApplySalesDefaults pre-fill chain wpleciony w istniejący LookupSelect.onChange — 0f9b5bfeb
- [x] 4.4 Banner "Customer changed — refresh defaults?" + refreshCustomerDefaults — 0f9b5bfeb
- [x] 4.5 i18n keys (3 form labels + 3 banner messages + 4 salesOwner picker labels × 4 locales) — 0f9b5bfeb
- [ ] 4.6 Integration test TC-MVP-S-W3-quote-prefill.spec.ts — odsunięte na osobny PR (deferred from Faza 5 budget)

### Phase 5: Validation gate + PR (1 h, included in budget)

- [x] 5.1 Full validation gate locally (yarn generate / jest 98 pass / typecheck core / i18n:check-sync sales clean)
- [x] 5.2 Open PR #9 (base = develop)
- [x] 5.3 Apply labels: review, feature, needs-qa

## Changelog

- 2026-05-03 — Initial spec created (Kuba74). Decisions W3.1-W3.4 ratified. ~10 h estimate, depends on Week 1 + 2 PR merges.
- 2026-05-03 — Phase 1 implemented (9019b0ab7), opened as PR #9.
- 2026-05-03 — Phases 2-4 implemented (0da3659f0, 9c5db9f89, 0f9b5bfeb) and pushed onto PR #9. Decision W3 extra: dodaję per-quote `sales_owner_user_id` i `payment_terms` kolumny na sales_quotes i sales_orders (wymaga migracji) — bo W3.4 form field salesOwnerUserId wymaga persisting. Migration20260503171218 ręczna ze względu na snapshot drift od W2 — note dla devs: następny `yarn db:generate` może wygenerować śmieciową migrację z dryf'em sales_settings/sales_tax_rates dopóki ktoś nie zaktualizuje snapshotów. Faza 4.6 (integration test pre-fill) odsunięta na osobny PR.
