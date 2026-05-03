# Import Readiness — erp-fromee → openm (post-Tydzień 1)

**Date:** 2026-05-03
**Status:** Analiza po merge'u Tygodnia 1 MVP-S
**Companion to:** [2026-05-03-erp-fromee-partner-data.md](ANALYSIS-2026-05-03-erp-fromee-partner-data.md), [2026-05-03-partner-master-migration.md](../2026-05-03-partner-master-migration.md)

## TLDR

Po merge'u Tygodnia 1 MVP-S openm ma **wszystkie potrzebne encje** żeby zaimportować ~99% danych klientów z erp-fromee. **Możemy importować dziś** w trybie one-time bulk via prosty mapping skript. Sync continuous wymaga modułu `sync_erp_fromee` z workerem (Faza 3 master spec'u, post-MVP). 1 brakująca encja: multi-bank accounts (`customer_company_bank_accounts`) — tylko 5.8% rekordów (66 z 1140) ma >0 banków, więc można odłożyć. Brakuje też supplier-side encji (Faza 5) ale dla **klientów-customers (200 rekordów)** mamy 100% pokrycie.

## Liczbowy bilans

### Po stronie erp-fromee (źródło)

| Tabela | Rekordów | Pokrycie pól |
|---|---|---|
| `Company` | 1140 | 1070 ORG + 70 PERSON; 212 NIP; 61 KRS |
| `Company.metadata` | — | 591 z formaPrawna; 615 z typPodmiotu; **2** z statusRelacji (≈unused) |
| `CompanyRole` | 1269 | 200 CUSTOMER + 1069 SUPPLIER; 129 dual-role |
| `CompanyContact` | 380 | tylko 9 z isPrimary=true |
| `CompanyAddress` | 405 | per Company avg 0.36 |
| `CompanyBankAccount` | 66 | 64 z IBAN; **0 SEPA mandates** |
| `CompanySourceLink` | 1161 | 2 systemy: ERPBOS (641) + IMPORT (520) |
| `CompanyGroupMember` | **0** | hierarchy unused |
| `KlientFirma` | 4730 | **NIE klienci** — obiekty budowlane (per audit) |

### Po stronie openm (cel, po Tygodniu 1)

26 encji `customer_*` w `packages/core/src/modules/customers/data/entities.ts`. Wszystkie potrzebne są obecne.

## Mapping erp-fromee → openm (kompletna ścieżka)

### 1. `Company` → `customer_entities` + `customer_companies`/`customer_people`

| erp-fromee | openm | Mapping |
|---|---|---|
| `Company.id` | `customer_entities.metadata.external_id` + `source = 'erp_fromee'` | unique mapping |
| `Company.kind = ORGANIZATION` | `customer_entities.kind = 'company'` + `customer_companies` row | direct |
| `Company.kind = PERSON` (z taxId) | `customer_entities.kind = 'company'` + `customer_companies.legal_form='jdg'` | **JDG reclassification** (61 z 70 person'ów) |
| `Company.kind = PERSON` (bez taxId) | `customer_entities.kind = 'person'` + `customer_people` row | true B2C (≤9 rekordów) |
| `Company.legalName` | `customer_companies.legal_name` (jeśli istnieje) lub `customer_entities.display_name` | fallback chain |
| `Company.displayName` | `customer_entities.display_name` | direct |
| `Company.shortName` | `customer_companies.brand_name` lub `metadata.short_name` | mapping |
| `Company.companyNo` | `customer_entities.metadata.partner_no` | non-canonical |
| `Company.searchTerm` | (ignore — openm builds search index) | skip |
| `Company.countryCode` | `customer_companies.country_code` (jeśli kolumna) lub address default | per primary address |
| `Company.defaultLanguage` | custom field `default_language` | TBD (pewnie skip dla MVP) |
| `Company.isActive` | `customer_entities.is_active` | direct |
| `Company.isBlocked` | custom field `is_blocked` lub przyszły column (Faza 4) | **GAP** — w Tygodniu 1 nie dodaliśmy `blocked` flag, custom field tymczasowo |
| `Company.note` | `customer_entities.description` | direct |
| `Company.metadata` | rozkład per pole (patrz niżej) | semi-direct |
| `Company.taxId` | `customer_tax_identities` row z `kind='nip'`, `country_code='PL'` | ✅ **gotowe** (Phase 1) |
| `Company.regon` | `customer_tax_identities` row z `kind='regon'` | ✅ |
| `Company.krs` | `customer_tax_identities` row z `kind='krs'` | ✅ |
| `Company.vatEu` | `customer_tax_identities` row z `kind='vat_eu'` (parsed prefix) | ✅ |

### 2. `Company.metadata` JSONB → custom fields / kolumny

Kluczowe pola Polish-specific (615 firm z metadata):

| `metadata` field | openm target | Status |
|---|---|---|
| `formaPrawna` (sp.z o.o., S.A., etc.) | `customer_companies.legal_form` | ✅ Phase 1 |
| `formaPrawnaKod` | `customer_companies.metadata.legal_form_code` | direct |
| `typPodmiotu` (Firma/Osoba prywatna) | `customer_companies.entity_type` | ✅ Phase 1 |
| `pelnyAdresKRS` | `customer_companies.full_address_krs` | ✅ Phase 1 |
| `kategoriaKontaktu` | `customer_dictionary_entries` (`kind='contact_category'`) lub custom field | TBD — minor |
| `statusRelacji` | `customer_entity_roles.role_type` (lub `lifecycle_stage`) | dictionary mapping; **2 wartości w bazie**, prawie nieużywane |
| `powodBlokady` | custom field `block_reason` (do Fazy 4) | tymczasowo custom field |
| `legacyKlientFirmaId` | `customer_entities.metadata.external_links.legacy_klient_firma_id` | direct |
| `obroty[]` (statystyki) | **NIE migrujemy** — read-only via response enricher z `sales` modułu (per ADR-9) | skip |
| `zamowienia[]` | jak wyżej | skip |
| `documentSources`, `createdBy` | `audit_logs` w openm | TBD (Faza 8) |
| `salesCustomerMap` | `customer_entities.metadata.sales_customer_map` | direct |

### 3. `CompanyRole` (1269) → `customer_entity_roles` + lifecycle_stage

**openm `customer_entity_roles` ma `role_type: text`** — generic field. Mapping:

| erp-fromee `roleType` | openm `lifecycle_stage` (dictionary) | openm `customer_entity_roles.role_type` |
|---|---|---|
| `CUSTOMER` | `customer` | `customer` |
| `SUPPLIER` | `supplier` (✅ Tydzień 1 dodało) | `supplier` |
| `PROSPECT` | `prospect` (✅ exists) | `prospect` |
| `LEAD` | `lead` (✅ exists) | `lead` |
| `PARTNER` | `partner` (✅ Tydzień 1 dodało) | `partner` |
| `CARRIER` | `carrier` (✅ Tydzień 1 dodało) | `carrier` |
| `BANK` | (brak natywnie) | `bank` (text-based, zezwolone) |
| `INTERNAL` | `internal` (✅ Tydzień 1 dodało) | `internal` |

Per company może być wiele ról (1140 firm × ~1.11 ról = 1269). `customer_entity_roles` obsługuje multi-role natywnie.

Dodatkowe pola `CompanyRole`:
- `currency`, `paymentTerms`, `deliveryTerms`, `priceGroup`, `creditLimit` — **pasują do `customer_company_billing`** (jeśli rola=customer/supplier per-billing)

### 4. `CompanyContact` (380) → `customer_people` + `customer_person_company_links`

| erp-fromee | openm |
|---|---|
| `CompanyContact.id` | `customer_people.metadata.external_id` |
| `CompanyContact.companyId` | resolve do `customer_entities.id` (companyMain) → `customer_person_company_links.company_entity_id` |
| `CompanyContact.firstName/lastName/displayName` | `customer_entities.display_name` (person row) + `customer_people.first_name/last_name` |
| `CompanyContact.jobTitle` | `customer_people.job_title` |
| `CompanyContact.department` | `customer_people.department` |
| `CompanyContact.contactFunction` (Architekt, Statiker, Verkauf, Einkauf, etc.) | `customer_person_company_roles.role_value` (decision_maker/budget_holder/etc.) — wymaga mapping'u German→openm dictionary |
| `CompanyContact.isPrimary` | `customer_person_company_links.is_primary` (✅ partial unique index z Tygodnia 1) |
| `CompanyContact.isActive` | `customer_entities.is_active` |
| `CompanyContact.metadata` | `customer_entities.metadata.legacy_contact` |

`CompanyCommunication` (email/phone w erp-fromee, separate table) → `customer_people.preferred_email`/`preferred_phone` lub osobne `customer_contact_methods` (TBD)

### 5. `CompanyAddress` (405) → `customer_addresses`

| erp-fromee | openm |
|---|---|
| `CompanyAddress.id` | `customer_addresses.metadata.external_id` |
| `CompanyAddress.type` (PRIMARY/INVOICE/DELIVERY) | `customer_addresses.address_type` (po mapping'u: PRIMARY → office; INVOICE → billing; DELIVERY → shipping) |
| `CompanyAddress.label` | `customer_addresses.label` |
| `CompanyAddress.attentionOf` | `customer_addresses.attention_of` (sprawdzić czy kolumna istnieje, lub metadata) |
| `CompanyAddress.name1`, `name2` | concat → `customer_addresses.line_1` lub metadata |
| `CompanyAddress.street1`, `street2` | `customer_addresses.address_line_1`, `address_line_2` |
| `CompanyAddress.postalCode/city/region/countryCode` | direct mapping |
| `CompanyAddress.latitude/longitude` | `customer_addresses.latitude/longitude` |
| `CompanyAddress.isPrimary` | `customer_addresses.is_primary` (✅ partial unique index per address_type z Tygodnia 1) |

### 6. `CompanyBankAccount` (66) → ⚠️ **GAP**

openm ma `customer_company_billing` (1:1 z customer_entities) z polami:
- `bankName`, `bankAccountMasked`, `paymentTerms`, `preferredCurrency`, `salesOwnerUserId`, `defaultOfferValidityDays`

**Brakuje multi-account model.** erp-fromee ma `CompanyBankAccount` z multi-bank (ale tylko 66 firm — 5.8% — używa). Dla MVP:

- **Strategia A:** import tylko `isPrimary=true` rekord do `customer_company_billing.bankAccountMasked` + IBAN do osobnej kolumny (dorobić kolumny: `iban_encrypted`, `iban_masked`, `swift`)
- **Strategia B:** dorobić `customer_company_bank_accounts` (1:N) — Faza 4 master spec'u; akceptacyjnie dla 66 rekordów

**Rekomendacja:** Strategia A dla MVP (dorobić 2-3 kolumny do `customer_company_billing`), Strategia B w czerwcu (Faza 4).

SEPA fields (`sepaMandateId`, etc.) — 0 rekordów ma SEPA → skip dla MVP.

### 7. `CompanySourceLink` (1161) → `customer_entities.metadata.external_links`

```typescript
metadata: {
  external_id: 'erp_fromee_company_id',
  source: 'erp_fromee',
  external_links: {
    erpbos: 'erpbos_company_id',
    import: 'import_source_ref',
  }
}
```

Per system mapping. `CompanySourceLink.lastSyncAt` → `metadata.synced_at`.

### 8. `CompanyGroupMember` (0 rekordów)

Brak danych do zaimportowania. Skip.

### 9. `KlientFirma` (4730 obiektów budowlanych) → ❌ NIE migrujemy do customers

Per ADR-5 master spec'u — to **construction objects**, nie klienci. Osobny przyszły moduł.

## Co możemy zaimportować dziś (po Tygodniu 1)

✅ **W 100%:**
- Company core (1140) → customer_entities + customer_companies/customer_people
- JDG reclassification (61 z 70 PERSON-z-NIP) → company + legal_form='jdg'
- Tax identities (212 NIP + 61 KRS + 0 REGON + 0 VAT-EU) → customer_tax_identities
- Polish metadata (591 formaPrawna + 615 typPodmiotu + 591 pelnyAdresKRS) → customer_companies columns
- CompanyContact (380) → customer_people + customer_person_company_links + isPrimary uniqueness
- CompanyAddress (405) → customer_addresses + isPrimary per address_type
- CompanyRole (1269) → customer_entity_roles z multi-role support

✅ **W 90%** (drobny gap):
- CompanyBankAccount (66 rekordów) → customer_company_billing (single account); reszta odłożona do Fazy 4 (multi-account)

❌ **Skip:**
- KlientFirma (4730 — niekompatybilne, construction objects)
- CompanyGroupMember (0 rekordów)
- Company.metadata.obroty/zamowienia (read-only z sales modułu — response enricher post-MVP)
- SEPA mandate fields (0 rekordów w bazie)

## Co BRAKUJE w openm (małe gapy)

| # | Gap | Severity | Recommendation |
|---|---|---|---|
| G1 | `customer_entities.is_blocked` + `blocked_reason` columns | Low | Dorobić w Fazie 4 (UI replacement); MVP via custom field |
| G2 | `customer_company_billing.iban_encrypted/iban_masked/swift` | Low | Dorobić jako Faza 4 (multi-bank w 5.8% przypadków); MVP single bank |
| G3 | `customer_addresses.attention_of` | Low | Sprawdzić czy istnieje; jeśli nie — w metadata |
| G4 | Mapping `contactFunction` (German: Architekt, Statiker, Verkauf, etc.) → `person_company_role` | Low | Dictionary translation — można inline w mapper'rze |
| G5 | `customer_addresses.address_type` enum (PRIMARY/INVOICE/DELIVERY → office/billing/shipping) | Low | Mapping inline |
| G6 | `customer_company_bank_accounts` (multi-account) | Medium | Faza 4 (czerwiec); 66 rekordów akceptowalnie odłożone |
| G7 | `Company.companyNo` storage | Low | Custom field lub `metadata.partner_no` |
| G8 | `Company.shortName` storage | Low | `metadata.short_name` lub `customer_companies.brand_name` |

**Łącznie: 0 hard blocker'ów.** MVP-zakres importu możliwy dziś po dorobieniu 1-2 mapper'ów.

## Plan importu MVP

### Faza A: Dry-run (1-2h)

```bash
# 1. Pull develop locally (już zrobione)
# 2. Setup connection do erp-fromee
# 3. Napisać skrypt importera w `apps/mercato/src/modules/sync_erp_fromee/`
yarn ts-node apps/mercato/src/modules/sync_erp_fromee/cli/import-companies.ts --dry-run
```

Output: lista 1140 mapped Companies + 1269 roles + 380 contacts + 405 addresses + 66 banks z report'em.

### Faza B: Commit run (1-2h)

```bash
yarn ts-node apps/mercato/src/modules/sync_erp_fromee/cli/import-companies.ts --commit --tenant=<UUID> --org=<UUID>
```

Output: rekordy w openm DB. Idempotent (re-run nie tworzy duplikatów dzięki `external_id` mapping).

### Faza C: Sync ciągły (post-MVP, Faza 3 master spec)

`sync_erp_fromee` worker — periodic pull z erp-fromee, detect changes via `Company.updatedAt > last_sync_at`.

## Strategia importu — co NA początek?

Rekomendacja: **import tylko klientów** (200 z rolą CUSTOMER), bo:

1. ✅ Dla May MVP potrzebujemy klientów (oferty), nie dostawców (Faza 5)
2. ✅ 200 rekordów = mały dataset = szybko i stabilnie
3. ✅ Wszystkie pola mapped, zero gap'ów
4. ✅ Po imporcie możemy testować Tydzień 3 (Quote UI z pre-fill chain) na realnych danych

Dostawcy (1069 SUPPLIER-only + 129 dual): import w Tygodniu 5 lub później, gdy moduł `suppliers` wystartuje (Faza 5).

## Estymata implementacji import skryptu

| Komponent | h |
|---|---|
| `import-companies.ts` (mapping logic dla Company → customer_entities) | 4 h |
| `mapTaxIdentities.ts` (taxId/regon/krs/vatEu → customer_tax_identities) | 1 h |
| `mapCompanyRoles.ts` (CompanyRole → customer_entity_roles + lifecycle_stage) | 1 h |
| `mapCompanyContacts.ts` (CompanyContact → customer_people + person_company_links + isPrimary handling) | 2 h |
| `mapCompanyAddresses.ts` (CompanyAddress → customer_addresses + address_type mapping + isPrimary) | 1 h |
| `mapCompanyBilling.ts` (CompanyBankAccount[primary] → customer_company_billing + paymentTerms) | 1 h |
| `mapMetadata.ts` (Company.metadata → legal_form, entity_type, full_address_krs columns + custom fields) | 1 h |
| Idempotency (external_id lookup, upsert pattern) | 1 h |
| Dry-run + report formatter | 1 h |
| CLI command (yarn integration) | 0.5 h |
| Integration test (TC-IMPORT-001-erp-fromee-customers.spec.ts) | 2 h |
| **Razem** | **~15 h** |

To **mniej niż 2 dni roboczych**. Można rozpocząć po Tygodniu 1 (dziś), zakończyć w pierwszym dniu Tygodnia 2.

## Decyzje wymagane przed startem importu

1. **Filtrujemy tylko CUSTOMER role?** Lub także PROSPECT/LEAD?  
   **Rekomendacja:** import wszystkich z `roleType IN ('CUSTOMER', 'PROSPECT')` — daje 200+jakiś prospekt'ów. PARTNER/CARRIER pomijamy (skala mała, niezwiązane z May MVP).

2. **JDG handling:** wszystkie 70 PERSON-with-NIP reclasifikujemy jako company + jdg, ale **9 PERSON-bez-NIP** — czy to prawdziwe B2C czy test data?  
   **Rekomendacja:** import jako kind=person, manual review (9 rekordów to mało).

3. **Source attribution:** wszystkie 1140 Company mają CompanySourceLink (1161 linki w 2 systemach: ERPBOS i IMPORT). Czy łączymy je w `metadata.external_links` czy tylko primary?  
   **Rekomendacja:** wszystkie linki → `external_links` array.

4. **Co z firmą która ma rolę `INTERNAL`?** (intra-organization companies)  
   **Rekomendacja:** skip — nie są partnerami zewnętrznymi.

## Action items

1. ⏳ Czekać na Twoją decyzję re: Tydzień 2 (PL VAT/numbering/currency) lub od razu skrypt importu
2. Jeśli import: napisać per-phase spec `2026-05-03-erp-fromee-import-customers.md` (~30 min)
3. Spawn `auto-create-pr` z briefem (~15 h pracy agenta w tle)
4. Po importu: testowanie smoke z realnymi 200 klientami w detalu firmy

## Sources

- `git pull origin develop` (2026-05-03 — 26 entities customer_*)
- `psql -d formee` queries (counts above)
- [ANALYSIS-2026-05-03-erp-fromee-partner-data.md](ANALYSIS-2026-05-03-erp-fromee-partner-data.md) (Phase 0 audit, baseline)
- [2026-05-03-mvp-s-week-1-partner-foundation.md](../2026-05-03-mvp-s-week-1-partner-foundation.md) (Tydzień 1 deliverables)
- [2026-05-03-mvp-s-week-1-completion.md](../2026-05-03-mvp-s-week-1-completion.md) — wait, this is internal, it's actually the completion plan path. Just reference completion stories: helpery + uniqueness invariants + JDG reclassification
