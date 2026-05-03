# openm `sales` Module — Readiness Audit for May MVP

**Date:** 2026-05-03
**Source:** `packages/core/src/modules/sales/` + `packages/core/src/modules/catalog/` + `packages/core/src/modules/customers/`
**Companion to:** [.ai/specs/2026-05-03-partner-master-migration.md](../2026-05-03-partner-master-migration.md)
**Trigger:** EPIC S1-S9 (Polish sales May MVP) — strategic decision Option C (build in openm, not erp-fromee)

## TLDR

openm `sales` module is **enterprise-grade and ~90% complete** for the May MVP scope. It already has full quote/order/invoice/payment/shipment/return pipeline with 27 entities, 36 API routes, 9 backend pages, calculation/tax services, document numbering generator, public quote tokens, accept/send/convert workflow actions. The **only major gap** is PDF rendering — no PDF library currently in repo. Catalog module is also complete (products, variants, offers, categories, units). May MVP is realistic on 5-week timeline because most work is wiring/configuration, not building.

## What openm `sales` already has

### Entities (27)
```
sales_channels, sales_shipping_methods, sales_delivery_windows
sales_payment_methods, sales_tax_rates
sales_quotes, sales_quote_lines, sales_quote_adjustments        ← OFFERS!
sales_orders, sales_order_lines, sales_order_adjustments
sales_shipments, sales_shipment_items
sales_returns, sales_return_lines
sales_invoices, sales_invoice_lines
sales_credit_memos, sales_credit_memo_lines
sales_payments, sales_payment_allocations
sales_notes, sales_document_addresses
sales_document_tags, sales_document_tag_assignments
sales_settings, sales_document_sequences                         ← NUMBERING!
```

### Backend pages (already implemented)
- `/backend/sales/quotes` — list page
- `/backend/sales/quotes/[id]` — detail page
- `/backend/sales/orders` — list page
- `/backend/sales/orders/[id]` — detail page
- `/backend/sales/documents/[id]` — generic document detail
- `/backend/sales/documents/create` — generic document creator
- `/backend/sales/channels` + create + edit
- `/backend/sales/channels/offers` — channel-scoped offers (catalog pricing)
- `/backend/sales/channels/[channelId]/offers/create|[offerId]/edit`
- `/backend/config/sales` — sales settings page

### API routes (36)
**CRUD endpoints:**
- `quotes`, `quote-lines`, `quote-adjustments`
- `orders`, `order-lines`, `order-adjustments`
- `invoices`, `credit-memos`, `payments`, `payment-allocations`
- `shipments`, `returns`, `notes`, `tags`
- `tax-rates`, `payment-methods`, `shipping-methods`, `delivery-windows`
- `channels`, `document-addresses`, `document-history`, `document-numbers`

**Workflow actions:**
- `quotes/accept` — accept quote
- `quotes/send` — send quote (probably via email)
- `quotes/convert` — convert quote → order (S7.1!)
- `quotes/public/[token]` — public link for customer

**Status dictionaries:**
- `payment-statuses`, `order-statuses`, `order-line-statuses`, `shipment-statuses`
- `adjustment-kinds`, `price-kinds`

**Settings:**
- `settings/document-numbers`, `settings/order-editing`

**Dashboard:**
- `dashboard/widgets/new-orders`, `dashboard/widgets/new-quotes` (S9.1!)

### Services
- `salesCalculationService.ts` (31 lines) — line/document-level calculations
- `taxCalculationService.ts` (141 lines, 79 lines of tests) — VAT calculations
- `salesDocumentNumberGenerator.ts` (199 lines) — configurable numbering with tokens

### Lib
- `calculations.ts`, `dictionaries.ts`, `documentNumberTokens.ts`
- `historyHelpers.ts`, `statusHelpers.ts`, `statusHistory.ts`
- `makeSalesLineRoute.ts`, `makeStatusDictionaryRoute.ts`
- `messageObjectPreviews.ts`, `returnQuantity.ts`, `seeds.ts`
- `providers/`, `frontend/`, `shipments/`

### Currency support
- `currency_code: text` field on EVERY document entity (quotes, orders, invoices, etc.)
- Native multi-currency from day one

## What `catalog` already has

### Entities (10)
```
catalog_product_option_schemas
catalog_products                   ← PRODUCTS
catalog_product_unit_conversions   ← UNITS
catalog_product_categories
catalog_product_category_assignments
catalog_product_tags
catalog_product_tag_assignments
catalog_product_offers              ← PRICING per channel
catalog_product_variants
catalog_product_variant_relations
```

## What `customers` already has

Plus Phase 1 PR #1 (`customer_tax_identities` for NIP/REGON/KRS/VAT-EU/PESEL).

## EPIC S1-S9 → openm Coverage Matrix

| EPIC story | openm coverage | Gap |
|---|---|---|
| **S1.1** Firma jako klient sprzedażowy | `customer_entity_roles` (role_type='customer'), `is_active` | UI: badge "Klient", filter w selectorze |
| **S1.2** Firma jako prospekt | `lifecycle_stage='prospect'` (defaults seed) lub `customer_entity_roles` | dodać 'prospect' do stage defaults; UI badge |
| **S1.3** Properties klienta | `customer_company_billing` (paymentTerms, preferredCurrency) | dodać `salesOwnerId`, `defaultOfferValidityDays` (custom field lub kolumna) |
| **S1.4** Główny kontakt | `customer_people` + `customer_person_company_links.is_primary` | partial unique index na is_primary; helper |
| **S1.5** Główny adres | `customer_addresses.is_primary` per `address_type` | partial unique index per (entity_id, address_type); helper |
| **S2.1** Katalog produktów | `catalog.catalog_products` + `catalog_product_variants` | seed PL produktów; CrudForm w /backend/catalog |
| **S2.2** Jednostki miary | `catalog.catalog_product_unit_conversions` | seed PL units (szt., kpl., m, mb, m², m³, kg, t, h) |
| **S2.3** Stawki VAT | `sales.sales_tax_rates` | seed PL: 23%/8%/5%/0%/zw |
| **S3.1** Lista ofert | `/backend/sales/quotes/page.tsx` + API `/api/sales/quotes` | weryfikacja kolumn: numer, klient, kontakt, status, data, validUntil, valueNet, owner |
| **S3.2** Numeracja ofert | `salesDocumentNumberGenerator.ts` + `sales_document_sequences` | konfiguracja: format `OF/{YYYY}/{NNNN}` |
| **S3.3** Tworzenie nagłówka oferty | `/backend/sales/quotes/[id]/page.tsx` + `/api/sales/quotes` (POST) | weryfikacja: pre-fill kontakt/adres po wyborze klienta |
| **S3.4** Edycja nagłówka oferty | jak wyżej | weryfikacja blokady edycji per status |
| **S3.5** Pozycje oferty | `sales_quote_lines` + `/api/sales/quote-lines` | weryfikacja: selector produktu z catalog, manual line, text-only |
| **S3.6** Obliczenia oferty | `salesCalculationService.ts` + `taxCalculationService.ts` (z testami) | weryfikacja: rabat % i kwotowy |
| **S3.7** Statusy oferty | quote.status field + przejścia | weryfikacja enum: draft/sent/accepted/rejected/cancelled |
| **S3.8** Szczegóły oferty | `/backend/sales/quotes/[id]/page.tsx` | weryfikacja layoutu |
| **S4.1** PDF oferty | **BRAK** — gap krytyczny | dodać generator PDF (puppeteer/jsPDF/@react-pdf) |
| **S4.2** Podgląd oferty | `/api/sales/quotes/public/[token]` (publiczny link!) | weryfikacja czy renderuje się jak PDF |
| **S5.1** Zapytania ofertowe | brak natywnie | użyć `customer_interactions` z typem 'inquiry' lub osobny moduł — **post-MVP** |
| **S5.2** Załączniki | `attachments` module | wystarczy podpięcie — **post-MVP** |
| **S6.1** Lead | `customer_entity_roles` + `lifecycle_stage='lead'` | seed + UI — **post-MVP** |
| **S6.2** Szansa sprzedażowa | **`customer_deals`** (już z pipeline_stages, deal_stage_transitions, win/lose tracking) | weryfikacja UI — **post-MVP** |
| **S7.1** Konwersja oferty → zamówienia | **`/api/sales/quotes/convert`** (już jest!) | weryfikacja workflow |
| **S7.2** Lista zamówień | `/backend/sales/orders` + `/[id]` (już są) | weryfikacja kolumn |
| **S8.1** Aktywności | `customer_activities` + `customer_interactions` (canonical model) | UI timeline — **post-MVP** |
| **S8.2** Follow-up | brak natywnie | użyć `customer_todo_links` — **post-MVP** |
| **S9.1** Dashboard | `/api/sales/dashboard/widgets/new-orders` + `new-quotes` | dodać widgets: top customers, expiring offers — **post-MVP** |

## Gap Analysis — co naprawdę dorobimy w 5 tygodni

### Krytyczne (must-have dla MVP)

1. **PDF rendering quote (S4.1)** — największy gap. Wymagane:
   - Wybór biblioteki: `@react-pdf/renderer` (React-native, łatwa) vs `puppeteer` (HTML→PDF, pełna kontrola CSS)
   - Rekomendacja: **`@react-pdf/renderer`** — działa na serverze Next.js bez headless browser, mniej zależności
   - Template z PL prawem fakturowym (wystawca, klient, NIP, pozycje, sumy, warunki)
   - Estymata: ~16 h
2. **PL configuration (S2.3, S3.2)** — seed:
   - VAT rates: 23%/8%/5%/0%/zw (1 h)
   - Document number sequence `OF/{YYYY}/{NNNN}` (2 h)
   - Default currency PLN (1 h)
3. **Wiring customer → quote (S1.4, S1.5, S3.3)** — pre-fill formularza:
   - Po wyborze klienta na quote: auto-load primary contact + default address + paymentTerms
   - Estymata: ~8 h
4. **JDG migration (Phase 1 PR #1 + reclass)**:
   - 70 PERSON-with-NIP → reclass do company + legal_form=jdg
   - Estymata: ~4 h
5. **Sync historycznych ofert (Phase 3 MVP-zakres)**:
   - 8100 SalesOffers (erp-fromee) → sales_quotes (openm)
   - Mapowanie statusów, klient (przez external_id z Phase 3 inbound), pozycje (jeśli SalesOfferLine ma więcej niż 1 record — w tej chwili tylko 1)
   - Demo na realnych danych
   - Estymata: ~16 h

### Średnie (nice-to-have, dorobić jeśli starczy czasu)

- Dashboard widgets: top customers, expiring offers (S9.1) — ~6 h
- Quote preview (S4.2) — może wystarczy public link `/api/sales/quotes/public/[token]` — ~2 h
- Polish UI labels (translations) — **odsunięte do post-MVP**

### Post-MVP (czerwiec)

- S5 Inquiries (zapytania ofertowe)
- S6 Leads/Opportunities (już mamy `customer_deals` — tylko UI)
- S8 Activities/follow-ups
- S9 Pełny dashboard
- Translation full Polish UI (decyzja: post-MVP)

## Re-estymata May MVP (vs. oryginalny EPIC plan)

| | Oryginalny EPIC plan | Po audycie openm |
|---|---|---|
| Tydzień 1 — partner foundation | 40 h (S1.1-S1.5) | **20 h** (Phase 1 PR + 2 partial unique indexes + helpers) |
| Tydzień 2 — catalog | 40 h (S2.1-S2.3 całe) | **8 h** (PL seeds: VAT, units, currency, document numbers) |
| Tydzień 3 — szkielet oferty | 40 h (S3.1-S3.4, S3.8) | **16 h** (audyt UI + customer→quote wiring + ewentualne poprawki) |
| Tydzień 4 — pozycje + kalkulacja | 40 h (S3.5-S3.7) | **12 h** (głównie audyt — kalkulacje już z testami) |
| Tydzień 5 — PDF + demo | 40 h (S4 + demo) | **40 h** (PDF jest jedynym dużym buildem — pełen tydzień) |
| **RAZEM** | **200 h** | **~96 h** |

Daje **~100 h luzu** w 5 tygodniach na:
- Sync historycznych SalesOffers (~16 h)
- Polish/refactor po audycie (~24 h)
- S6/S8 częściowo (deals UI, activities UI)
- Bufor na nieoczekiwane

## Risk register — May MVP

| # | Ryzyko | Severity | Mitigation |
|---|---|---|---|
| M1 | Audyt UI pokaże rozjazd między schemą a UI (entity istnieje, ale CrudForm nie ma wszystkich pól) | Medium | Tydzień 1 — manualne sprawdzenie każdej strony, lista poprawek |
| M2 | PDF library choice → blocker | Low | Decyzja w Tygodniu 1, prototyp w Tygodniu 2 |
| M3 | 8100 historycznych ofert nie zmieści się w sync — różne statusy, custom pola w `metadata` | Medium | Sync MVP-zakres: tylko aktywne (status != cancelled), top 500 wartościowo |
| M4 | Polskie pola (`legalForm`, `pelnyAdresKRS`) nie podpinają się automatycznie do quote | Low | Custom field rendering w PDF — Phase 1 PR #1 ma już infrastrukturę |
| M5 | Sales tax rates w PL mają niuanse (zw vs 0% vs np. usługi medyczne) | Low | Konsultacja z księgową przed seedem |
| M6 | Demo wymaga realnych klientów ale Phase 3 sync dopiero w Tygodniu 5 | High | Demo na 10-20 zaimportowanych firmach, nie pełen import |

## Decisions ratified (post-audit)

1. **Strategy:** May MVP w **openm** (Option C) — confirmed by user 2026-05-03
2. **Translations:** odsunięte do **post-MVP** (Option C — confirmed)
3. **PDF library:** **@react-pdf/renderer** (zalecenie — wymaga finalnej zgody użytkownika)
4. **Sync historycznych SalesOffers:** **MVP-zakres** (top 500 active offers; pełen sync post-MVP)
5. **EPIC stories nie w MVP:** S5 (Inquiries), S6 (Leads/Opportunities — choć foundation jest), S8 (Activities), S9 (pełen dashboard)
6. **Phase 1 PR #1:** **Merge po lokalnej walidacji** — fundament Tygodnia 1

## Action items

1. ✅ Audit done — this document
2. ⏳ User: lokalna walidacja PR #1 (`yarn build:packages && yarn test`)
3. ⏳ User: review master spec re-prioritization (Phase order: 1 → MVP-S → 2 → 5 → 3 → 6 → 7 → 8)
4. ⏳ Update master spec [.ai/specs/2026-05-03-partner-master-migration.md](../2026-05-03-partner-master-migration.md):
   - Insert new "MVP-S" phase between Phase 1 and Phase 2
   - Phase 4 (UI replacement) → "absorbed into MVP-S"
   - Add link to this audit in "Phase 0 audit reports"
5. ⏳ Decision: PDF library choice (recommend @react-pdf/renderer)
6. ⏳ Per-phase spec for MVP-S Tydzień 2 (PL configuration seeds) — może być w samym spec'u jeśli krótki
