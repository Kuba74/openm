# Erp-fromee Partner Data Audit

**Date:** 2026-05-03
**Source:** local Postgres `formee` database (live, 1140 Company rows)
**Companion to:** [.ai/specs/2026-05-03-partner-master-migration.md](../2026-05-03-partner-master-migration.md)
**Status:** Complete — feeds Phase 0 → Phase 1 planning

## TLDR

erp-fromee is **dominantly a procurement/supplier system** (82% of partners are SUPPLIER-only, 11% are dual-role, only 6% are CUSTOMER-only). NIP coverage on companies is shockingly low (14%) but high on natural persons (87% — these are JDG). `KlientFirma` table is **misleadingly named** — it stores **4730 construction objects (buildings)**, not customer data. Polish-specific customer data (`statusRelacji`, `typPodmiotu`, `obroty[]`, `zamowienia[]`, `formaPrawna`, `pelnyAdresKRS`) lives in `Company.metadata` JSONB blob, populated for 615 companies (those imported from ERPBOS source). This **inverts a key assumption** in the master spec — Phase 3 (sync inbound) maps `Company.metadata` keys, not `KlientFirma.dane`.

## Master tables — counts

| Table | Rows |
|---|---|
| `Company` | **1140** (1070 ORG + 70 PERSON) |
| `CompanyContact` | 380 (avg 0.33 per company; only 9 marked `isPrimary`) |
| `CompanyAddress` | 405 (across 402 companies) |
| `CompanyBankAccount` | 66 (5.8% coverage; 64 with IBAN, 0 SEPA) |
| `CompanyRole` | 1340 role-rows (multi-role per company) |
| `CompanySourceLink` | 1161 links (1140 companies × ~1.02 sources) |
| `KlientFirma` | **4730** — NOT customers (see "Critical finding") |

## Critical finding — `KlientFirma` is not customers

`KlientFirma.dane` JSONB structure (top 25 keys, all rows = 4730):

| Key | Coverage | Type |
|---|---|---|
| `objNo`, `buildNo`, `buildName`, `street`, `city`, `zipCode`, `district`, `objState`, `salesOrga`, `archived`, `archivedReason`, `latestDrawingDate`, `drawingCount`, `companyId` | 100% | Construction object metadata |
| `typPodmiotu` | 32.5% | Cross-cutting entity type label |
| `erpObjectType*` (Code, Label, ImportedAt, SourceFile) | 25.1% | ERP object classification |
| `client` | 22.9% | Free-text client name (not FK) |
| `buildingVariant`, `buildingCategory` | 7.8% | Construction details |
| `floorsCount`, `hasSlabs` | ~5% | Building specs |

Sample row (`zrodloId = obiekt:001004`):
```json
{
  "objNo": "001004",
  "buildNo": "Test House",
  "buildName": null,
  "street": null,
  "city": null,
  "zipCode": null,
  "salesOrga": "DE",
  "archived": true,
  "archivedReason": "manual",
  "drawingCount": 0,
  "latestDrawingDate": null
}
```

Top `client` values:
- Expobud Domy Sp. z o.o. (240 objects)
- Coloseum Pro Sp. z o.o (78)
- Atrakcyjne Domy Sp. z o.o. (63)
- Abakon BD Sp. z o.o (58)

These are **prefab housing builders**. `KlientFirma` tracks construction projects/buildings, with `client` as a free-text reference to the company commissioning the build.

**Implication for migration:**
- `KlientFirma` does NOT belong in the partners migration — it's a separate domain (construction objects, tied to drawings/production)
- Should migrate to a future `construction_objects` or `projects` module, NOT `customers`
- 0 rows in `KlientFirma` are linked to `CompanySourceLink` (the table is its own root)
- The frontend `src/modules/klienci/klienciTypes.ts` (with `nip`, `regon`, `banki`, `obroty`, etc.) is **misaligned** with this DB shape — it describes a different/deprecated schema

## Where the Polish-specific customer data actually lives

`Company.metadata` JSONB — populated for 615 companies (those with ERPBOS source link):

| Key | Coverage | Notes |
|---|---|---|
| `zamowienia` | 615 (54%) | Order statistics array |
| `obroty` | 615 (54%) | Sales statistics array |
| `legacyKlientFirmaId` | 615 (54%) | Legacy ID from older system |
| `powodBlokady` | 615 (54%) | Block reason (mostly empty for active) |
| `kategoriaKontaktu` | 615 (54%) | Contact category |
| `typPodmiotu` | 615 (54%) | Entity type ("Firma" 545, "Osoba prywatna" 70) |
| `statusRelacji` | 615 (54%) | Relationship status (only 2 set to `klient` — dictionary unused) |
| `formaPrawna`, `formaPrawnaKod` | 591 (52%) | Legal form (sp. z o.o., GmbH, JDG, etc.) |
| `pelnyAdresKRS` | 591 (52%) | Full registered address from KRS |
| `documentSources`, `createdBy` | 454 (40%) | Audit data |
| `salesCustomerMap` | 69 (6%) | Sales channel mapping |

**Updated mapping for Phase 3:**

```
Company.metadata.formaPrawna       → custom field `legal_form` (Phase 1)
Company.metadata.typPodmiotu       → custom field `entity_type` (Phase 1)
Company.metadata.pelnyAdresKRS     → custom field `full_address_krs` (Phase 1)
Company.metadata.statusRelacji     → customer_entity_roles (Phase 2) — but largely unused
Company.metadata.kategoriaKontaktu → customer_entity_roles (Phase 2)
Company.metadata.powodBlokady      → customer_entities.blocked_reason (Phase 4)
Company.metadata.obroty            → NOT migrated (response enricher to sales module)
Company.metadata.zamowienia        → NOT migrated (response enricher)
Company.metadata.legacyKlientFirmaId → kept in customer_entities.metadata.external_links
Company.metadata.documentSources   → audit_logs (Phase 8)
```

## Role distribution — procurement-heavy

| Roles | Companies | % |
|---|---|---|
| `{SUPPLIER}` | **940** | 82.5% |
| `{CUSTOMER, SUPPLIER}` | 129 | 11.3% |
| `{CUSTOMER}` | 71 | 6.2% |
| (other roles: PROSPECT, LEAD, PARTNER, CARRIER, BANK, INTERNAL) | **0** | 0% |

**Implication:** This system is **predominantly procurement-side**. The CRM aspect is minor (200 customer companies). This suggests **re-prioritizing the master spec phases:**

| Original phase | Original priority | Re-prioritized |
|---|---|---|
| Phase 5 (suppliers module) | 5th | **Should be 2nd** after Phase 1 — it's the dominant use case |
| Phase 6 (procurement RFQ) | 6th | **Should be 3rd** — directly serves 1069 supplier records |
| Phase 4 (UI replacement) | 4th | Can be deferred — `klienci/` frontend handles CRM (~200 companies), not main system |
| Phase 2 (supplier role overlay) | 2nd | Still keep — needed before Phase 5 builds on it |

**Recommendation:** swap order to Phase 1 → 2 → 5 → 3 → 6 → 4 → 7 → 8. Build supplier model BEFORE doing full sync.

## Tax identifier coverage

| | ORGANIZATION (1070) | PERSON (70) |
|---|---|---|
| has `taxId` (NIP) | 151 (14.1%) | 61 (87.1%) |
| has `regon` | 0 | 0 |
| has `krs` | 51 (4.8%) | 10 (14.3%) |
| has `vatEu` | 0 | 0 |
| `isBlocked = true` | 0 | 0 |

**Format analysis (`taxId` field):**
- 10-digit format (PL NIP): 172 (90.5%)
- Country prefix format (e.g. `DE123456789`): 15 (7.9%)
- Other format (likely dirty data): 25 (13.2%)
- **0 NIP duplicates** (clean)

**Country distribution:**
- PL: 1140 (100%)
- Non-PL: 0

**Implications:**
- `regon` and `vatEu` columns are **completely unused** — `regon` data may be in `metadata.regonField` if at all; `vatEu` is the SAME as `taxId` for PL companies
- 70 `PERSON` records with 87% NIP coverage = these are **JDG** (sole proprietors) misclassified as PERSON. In Phase 1, these should be reclassified to `kind=company` + `legal_form=jdg`
- Only 14% of organizations have NIP — either ad-hoc entries (no NIP captured) or test data
- 25 dirty `taxId` values need cleanup before Phase 1's `unique` constraint can be applied
- 0 cross-border partners — Phase 1's multi-country `customer_tax_identities` is over-engineered for this dataset (still useful for future-proofing)

## Bank accounts & SEPA

- 66 bank accounts across 1140 companies (5.8%)
- 64 have IBAN populated (97% of bank accounts)
- **0 SEPA mandates**
- Average 1 account per company that has any (no multi-bank cases)

**Implication:** Phase 4's `customer_company_bank_accounts` (1:N) is over-engineered for current data. Existing `customer_company_billing` (1:1) would suffice for the imported set. **Still build 1:N** because new partners (e.g., from Phase 6 procurement) may have multiple accounts (PLN/EUR/USD).

## Source systems

| System | Links | Companies |
|---|---|---|
| ERPBOS | 641 | 615 |
| IMPORT | 520 | 520 |

**Implication:** Phase 3 sync adapter must handle 2 source systems with different mapping rules. ERPBOS rows are richer (have full Polish metadata); IMPORT rows are basic (just `legalName` + role).

## Updated risk register entries

Adding to master spec risk register:

| # | Phase | Risk | Severity | Mitigation |
|---|---|---|---|---|
| R14 | 0 → 1 | 70 PERSON records with NIP need reclassification to JDG | Low | Phase 1 migration: `UPDATE Company SET kind='ORGANIZATION', metadata = jsonb_set(metadata, '{legalForm}', '"jdg"') WHERE kind='PERSON' AND \"taxId\" IS NOT NULL` |
| R15 | 1 | 25 dirty taxId values block unique constraint | Medium | Pre-migration cleanup script: list → manual review → fix or null out |
| R16 | 3 | KlientFirma is mis-named, not customers | High | Re-scope — KlientFirma migrates separately to future construction_objects module, NOT customers |
| R17 | 5 | Supplier-heavy data shape (940 supplier-only) means Phase 5 must precede Phase 4 | Medium | Re-prioritize phases per recommendation above |
| R18 | 1 | regon/vatEu columns completely empty — schema indicates expectation but reality differs | Low | Phase 1 still builds full tax-identity model (future-proofing); do not skip |
| R19 | 4 | 5.8% bank-account coverage means Phase 4's multi-bank model is initially overkill | Low | Build the model anyway — small cost, future-proofs procurement currency multi-banking |

## Decisions ratified

Per master spec's Phase 0 gate:

1. **Strangler approved** — confirmed by data shape (1140 partners is enough scale to justify, but small enough that phased delivery is faster than in-place refactor of 8272-line schema)
2. **Sync direction:** Phase 3 = pull (erp-fromee → openm) initial bulk + continuous; Phase 7 = push (openm → erp-fromee) after cutover. ADR confirmed.
3. **Canonical IDs:**
   - openm `customer_entities.id` (UUID) = master
   - erp-fromee `Company.id` (cuid) mapped via `customer_entities.metadata.external_id` + `source = 'erp_fromee'`
   - `legacyKlientFirmaId` retained in `customer_entities.metadata.external_links.legacy_klient_firma_id` for audit traceability
4. **Phase re-prioritization:** **adopt new order** Phase 1 → 2 → **5** → **3** → **6** → 4 → 7 → 8 (build supplier model on empty system, then sync, then procurement, then customer UI, then cutover, then hardening)
5. **`KlientFirma` scope removed** — does NOT migrate to customers module. Future spec (separate) will design migration to construction-objects domain.
6. **JDG reclassification** — 70 PERSON-with-NIP rows reclassified during Phase 1 migration

## Action items for spec update

1. Update master spec Section "Phases" — swap order per re-prioritization
2. Update master spec Section "Phase 3" — drop `KlientFirma.dane` mapping table, keep only `Company.metadata` mapping
3. Update master spec Section "Risks" — append R14–R19 to register
4. Add ADR section to master spec covering decisions 1–6 above

## Source queries (reproducible)

All queries run on local `formee` Postgres 18.3 database, 2026-05-03.

```sql
-- Counts by kind + tax-ID coverage
SELECT kind, count(*),
       count(*) FILTER (WHERE "taxId" IS NOT NULL AND "taxId" != '') AS has_taxid,
       count(*) FILTER (WHERE regon IS NOT NULL AND regon != '') AS has_regon,
       count(*) FILTER (WHERE krs IS NOT NULL AND krs != '') AS has_krs,
       count(*) FILTER (WHERE "vatEu" IS NOT NULL AND "vatEu" != '') AS has_vatEu
FROM "Company" GROUP BY kind;

-- Role combinations
WITH role_per_company AS (
  SELECT "companyId", array_agg(DISTINCT "roleType"::text) AS roles
  FROM "CompanyRole" GROUP BY "companyId"
)
SELECT roles, count(*) FROM role_per_company GROUP BY roles ORDER BY count(*) DESC;

-- KlientFirma key frequencies
SELECT jsonb_object_keys(dane) AS key, count(*),
       ROUND(100.0 * count(*) / (SELECT count(*) FROM "KlientFirma"), 1) AS pct
FROM "KlientFirma" WHERE dane IS NOT NULL
GROUP BY jsonb_object_keys(dane)
ORDER BY count(*) DESC LIMIT 25;

-- Company metadata key frequencies
SELECT jsonb_object_keys(metadata) AS key, count(*)
FROM "Company"
WHERE metadata IS NOT NULL AND metadata != '{}'::jsonb
GROUP BY jsonb_object_keys(metadata)
ORDER BY count(*) DESC LIMIT 15;

-- NIP duplicates
SELECT "taxId", count(*), array_agg("legalName")
FROM "Company" WHERE "taxId" IS NOT NULL AND "taxId" != ''
GROUP BY "taxId" HAVING count(*) > 1;
```
