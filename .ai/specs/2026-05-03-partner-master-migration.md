# Partner Master Migration — strangler from erp-fromee to openm

**Status:** Draft (Phase 1 in PR review — [PR #1](https://github.com/Kuba74/openm/pull/1))
**Created:** 2026-05-03
**Author:** Kuba74
**Scope:** OSS (`packages/core/src/modules/customers`, `sales`, `catalog`) + new modules (`suppliers`, `procurement`, `sync_erp_fromee`)
**Estimated total:** ~726 h ≈ 18 weeks (with May MVP-S inserted; phased delivery, exits possible after MVP-S)
**Companion analyses:**
- [ANALYSIS-2026-05-03-erp-fromee-partner-data.md](analysis/ANALYSIS-2026-05-03-erp-fromee-partner-data.md) — Phase 0 audit
- [ANALYSIS-2026-05-03-openm-sales-readiness.md](analysis/ANALYSIS-2026-05-03-openm-sales-readiness.md) — May MVP readiness audit

## TLDR

Strangler migration: openm becomes canonical partner master (CRM + suppliers), erp-fromee becomes read-replica for partners while remaining system of record for production/finance. Nine phases (0–8) deliver: clean tax-identity model with PL specifics (NIP/REGON/KRS/JDG/B2C), supplier-as-role overlay, full inbound sync from erp-fromee, multi-bank/GDPR/UI replacement, dedicated `suppliers` module, RFQ/framework-agreement procurement workflow, production cutover with `KlientFirma` elimination, and GDPR/audit/performance hardening.

## Overview

erp-fromee carries a monolithic 8272-line Prisma schema (307 models, 96 migrations) where `Company` (with `kind: ORGANIZATION | PERSON`) handles both companies and natural persons, and `KlientFirma` is a parallel JSONB-blob staging table. openm has a modular customers module but lacks: tax-identity normalization, sole-proprietor (JDG) support natively, full B2C handling, supplier role primitives beyond a generic role-type column, and any procurement workflow.

This spec lays out a multi-phase strategy where new partner data (CRM, supplier master, procurement) flows through openm's modular system while erp-fromee retains production/finance/inventory ownership. Each phase is independently shippable and exits the migration safely if scope shrinks.

## Problem Statement

### Current state — erp-fromee

- **Single `Company` table** holds organizations and persons via `kind` discriminator. NIP/REGON/KRS/VAT-EU are 4 nullable columns on the same row — no validation, no uniqueness constraint, no JDG distinction.
- **`KlientFirma`** is a sync staging table with `dane: Json` containing the rich Polish-specific schema (`firmaNr`, `nip`, `regon`, `banki[]`, `finanse`, `obroty[]`, `cennik[]`, etc.). It duplicates and conflicts with normalized `Company*` tables.
- **`CompanyRole`** assigns role types (CUSTOMER, SUPPLIER, PROSPECT, LEAD, PARTNER, CARRIER, BANK, INTERNAL) — multi-role per company is supported but UI/services are scattered (`dostawcyService.js`, `firmyMutationService.js`, `klienciSyncService.js`).
- **8272-line `schema.prisma`** in one file — every PR conflicts.
- **`metadata: Json`** on every model — frequent keys never promoted to columns, no indexes possible.
- **No GDPR** for PII fields like PESEL or bank IBAN.

### Current state — openm

- `customer_entities.kind` is `'person' | 'company'` only. No `sole_proprietor` for JDG.
- Tax identifiers don't exist as a model — would have to be 4 nullable columns or custom fields.
- `customer_entity_roles` table is generic (`role_type: text`) but not surfaced in UI; no supplier-specific workflow.
- No procurement domain (RFQ, framework agreements, supplier evaluation, certificates, supplier-side price lists).

### Why strangler, not in-place refactor

| | In-place refactor erp-fromee | Strangler to openm |
|---|---|---|
| Time to first value | 2–3 months | 2 weeks |
| Regression risk in production/finance | High | None |
| B2C / JDG / B2B modeling | Requires 6+ migrations | Natively in openm by Phase 1 |
| GDPR / encryption | To be implemented | Already in openm (`encryption.ts`, `findWithDecryption`) |
| Multi-tenant scoping | Absent | Native |
| Audit log, undo/redo, mutation lifecycle | To be implemented | Already in openm (Phase M) |

### Out of scope

- Production scheduling, MRP, inventory — stays in erp-fromee
- Accounting (journal, open items, payments, JPK_V7, KSeF) — stays in erp-fromee
- Drawings, BOM, manufacturing routing — stays in erp-fromee
- erp-fromee schema split — out of this spec; if pursued, separate spec required

## Proposed Solution

openm gains a complete partner master with three role surfaces — Customer (existing CRM), Supplier (new module), and generic roles via `customer_entity_roles` (Carrier, Bank, Internal, Partner). Tax identifiers normalize into `customer_tax_identities`. Bidirectional sync with erp-fromee is one-way pull initially (Phase 3), evolving to push-only after cutover (Phase 7). Procurement workflow (RFQ, framework agreements) lives in a new `procurement` module that strangles erp-fromee's `purchaseRfq*Service`.

### Strategy overview

```
                ┌──────────────────────────┐
                │  openm — partner master  │
                │  customers (CRM)         │
                │  suppliers (new)         │
                │  procurement (new)       │
                │  sync_erp_fromee (new)   │
                └────────────┬─────────────┘
                             │
                  Phase 3: pull (read-only on openm side)
                  Phase 7: push (read-only on erp-fromee side)
                             │
                             ▼
                ┌──────────────────────────┐
                │  erp-fromee              │
                │  Production / Finance /  │
                │  Inventory / Drawings    │
                └──────────────────────────┘
```

### Decision points (gates)

- **After Phase 0:** confirm strategy (strangler vs in-place)
- **After Phase 2:** confirm scope (does role overlay suffice, or do we need full Phase 5?)
- **After Phase 3:** confirm direction (bidirectional sync vs cutover toward Phase 7)
- **After Phase 5:** confirm procurement scope (Phase 6 or stop at supplier masterdata)

## Architecture

### Module landscape after Phase 8

| Module | Path | Responsibility |
|---|---|---|
| `customers` | `packages/core/src/modules/customers` | Partner core (CRM, person/company/JDG), tax identities, bank accounts, entity roles, multi-VAT, hierarchy |
| `suppliers` | `apps/mercato/src/modules/suppliers` (or `packages/core` if core-grade) | Supplier profile (1:1 with customer_entity), evaluations, certificates, supplier-side price lists, supplier item mapping, delivery regions |
| `procurement` | `apps/mercato/src/modules/procurement` | RFQ, framework agreements, purchase orders (if not delegated to erp-fromee), evaluation triggers |
| `sync_erp_fromee` | `apps/mercato/src/modules/sync_erp_fromee` | Bidirectional sync adapter + workers + mappers |

### Cross-cutting

- **DI:** all services through Awilix; sync adapters injectable for testing
- **Events:** `customers.entity.*`, `suppliers.evaluation.*`, `procurement.rfq.*` — declared with `createModuleEvents`
- **Workflows:** RFQ lifecycle uses `workflows` module (visual editor, step-based)
- **Audit:** every command via Command Pattern (Phase M), `audit_logs` records all writes
- **GDPR:** `customer_tax_identities` with `kind=PESEL` encrypted at rest; bank IBAN encrypted with `iban_masked` for display
- **Search:** vector + fulltext + token across customers + suppliers, AI tools for `find-best-supplier`

## Phases

### Phase 0 — Discovery & decisions (16 h)

**Goal:** numbers before code, strategy ratified.

**Deliverables:**
- Audit report `.ai/specs/analysis/ANALYSIS-2026-05-03-erp-fromee-partner-data.md`:
  - Counts: `Company` with `kind=ORGANIZATION` vs `PERSON`
  - Distribution: `taxId/regon/krs/vatEu` populated %
  - Multi-role counts: companies that are simultaneously CUSTOMER + SUPPLIER
  - NIP duplicate detection
  - Top 20 keys in `Company.metadata: Json`
  - `KlientFirma` ↔ `Company` overlap (orphans, full coverage)
  - Counts: openm tenants, partners per tenant, current `customer_entity_roles` usage
- ADR: strangler approved
- ADR: sync direction (one-way pull initially, push after cutover)
- Canonical IDs decided: openm UUID = master, erp-fromee cuid mapped via `customer_entities.metadata.external_id` + `source = 'erp_fromee'`

**Acceptance:**
- Spec sections updated with real numbers (no placeholders)
- Canonical ID mapping decided
- Stakeholder sign-off

**Dependencies:** —
**Risk:** Low. Possible outcome: <50 partners → switch to in-place refactor (separate spec).

### Phase 1 — Partner core (TaxIdentity, kind, PL specifics) (40 h)

**Goal:** clean partner model with normalized tax identifiers and PL-specific support (JDG, B2C, B2B).

**Data model changes:**

```typescript
@Entity({ tableName: 'customer_tax_identities' })
export class CustomerTaxIdentity {
  id: string                              // uuid
  organizationId: string
  tenantId: string
  entityId: string                        // FK customer_entities.id
  countryCode: string                     // 'PL' | 'DE' | ...
  kind: 'NIP' | 'REGON' | 'KRS' | 'VAT_EU' | 'PESEL' | 'TIN'
  value: string
  validFrom: Date | null
  validTo: Date | null
  isPrimary: boolean
  createdAt, updatedAt, deletedAt
}
```

**Indexes:**
- `unique(country_code, kind, value) where deleted_at is null` — global dedup per (country, kind)
- `index(entity_id, kind)` — lookup all NIPs for a partner
- `index(organization_id, tenant_id)`

**Schema additions:**
- `customer_companies.legal_form: text` (FK to dictionary `legal_form`: `sp_z_oo`, `s_a`, `gmbh`, `jdg`, `s_c`, `fundacja`, `stowarzyszenie`, …)
- `customer_companies.entity_type: text` (FK to dictionary `entity_type`: `manufacturer`, `distributor`, `wholesaler`, `retailer`, `end_customer`, …)
- `customer_companies.full_address_krs: text` (registration address from KRS)

**Note on JDG:** JDG = `customer_entities.kind = 'company'` + `customer_companies.legal_form = 'jdg'`. Rationale: JDG issues B2B invoices and has NIP — UX-wise belongs in companies tab. Decision recorded as ADR.

**Validators (zod, in `data/validators.ts`):**
- `nipSchema` — 10 digits, checksum (modulo 11)
- `regonSchema` — 9 or 14 digits, checksum
- `krsSchema` — 10 digits
- `peselSchema` — 11 digits, checksum + birthdate validation
- `vatEuSchema` — country prefix + national format

**Custom fields (declared in `customers/customFieldDefaults.ts`):**
- `cf.text('full_address_krs', { label: 'Adres rejestrowy KRS' })`
- `cf.text('legal_form', ...)` — dictionary-backed
- `cf.text('entity_type', ...)` — dictionary-backed

**API contracts:**
```
GET    /api/customers/companies/:id/tax-identities       → list
POST   /api/customers/companies/:id/tax-identities       → create
PATCH  /api/customers/companies/:id/tax-identities/:tid  → update
DELETE /api/customers/companies/:id/tax-identities/:tid  → soft-delete
```
All routes follow CRUD factory + indexer pattern (`indexer: { entityType: 'customers:tax_identity' }`).

**Commands:** `customers/commands/taxIdentities.ts` — create/update/delete with undo + custom field snapshot capture.

**UI:** new section in company detail (`backend/customers/companies/[id]/page.tsx` widget injection point `crud-form:customers.company:fields`):
- List of tax identities with country flag, kind chip, value, validity
- "Add tax identity" inline form with country picker → kind picker → value input (auto-formatted NIP `123-456-78-90`)
- Inline + server validation (409 Conflict with friendly error on duplicate)

**Migrations:** 1 file (`MigrationYYYYMMDDhhmmss.ts`)

**Acceptance:**
- 3 NIPs on one company (PL/DE/FR) — works
- Duplicate NIP in PL → 409 Conflict
- JDG companies show with `legal_form=jdg`, distinguishable in list filter
- B2C person — no tax identity required (PESEL optional, encrypted)
- `yarn lint && yarn test && yarn db:migrate` passes
- Integration test in `__integration__/`: TC-PARTNER-001-tax-identities

**Dependencies:** Phase 0
**Risk:** Low. Additive-only. BC-safe (no removed columns/tables).

### Phase 2 — Supplier role overlay (24 h)

**Goal:** mark partner as supplier and provide filtered list without building a full module.

**Changes:**

In `customers/cli.ts`, extend `ENTITY_LIFECYCLE_STAGE_DEFAULTS`:
```typescript
{ value: 'supplier', label: 'Supplier', color: '#0ea5e9', icon: 'lucide:truck' },
{ value: 'partner', label: 'Partner', color: '#8b5cf6', icon: 'lucide:handshake' },
{ value: 'internal', label: 'Internal', color: '#64748b', icon: 'lucide:building' },
{ value: 'carrier', label: 'Carrier', color: '#f97316', icon: 'lucide:truck' },
```

Reuse `customer_entity_roles` (already exists in openm, generic `role_type: text`):
- Helpers `customers/lib/entityRoleHelpers.ts`: `markEntityAsSupplier`, `unmarkEntityAsSupplier`, `getEntityRoles`
- Commands `customers/commands/entityRoles.ts`: typed wrappers with undo support

**UI:**
- New page `/backend/customers/suppliers` — same DataTable as `/backend/customers/companies` with default filter `entity_role=supplier`
- Toggle widget in company detail: chips for Customer / Supplier / Partner / Carrier — clicking adds/removes role
- Sidebar entry "Suppliers" under "Customers" group

**RBAC:** new features in `customers/acl.ts`:
- `customers.suppliers.view`
- `customers.suppliers.manage`
- Added to `setup.ts` `defaultRoleFeatures` for admin/manager roles

**Search:** filter by `roles[]` in DataTable + search.ts source builder

**Translations:** PL + EN keys for new UI labels

**Acceptance:**
- Same company can be Customer + Supplier; appears on both lists
- `/backend/customers/suppliers` shows only entities with `customer_entity_role.role_type='supplier'`
- Toggle widget round-trips correctly with undo support
- Integration test: TC-PARTNER-002-supplier-role-overlay

**Migrations:** 0 (reuses existing tables)

**Dependencies:** Phase 1
**Risk:** Low. Mostly UI + dictionary entries.

### Phase 3 — Sync inbound (erp-fromee → openm) (80 h)

**Goal:** one-time bulk import + continuous pull sync.

**New module:** `apps/mercato/src/modules/sync_erp_fromee/`

**Adapter:**
```
adapters/erpFromeeAdapter.ts          // PG/Prisma client to erp-fromee dev.db or prod
mappings/companyToPartner.ts          // Company → customer_entities + customer_companies + customer_tax_identities
mappings/companyContactToPerson.ts    // CompanyContact → customer_people + customer_person_company_links
mappings/companyAddressToAddress.ts   // CompanyAddress → customer_addresses
mappings/companyBankAccountToBilling.ts  // CompanyBankAccount → customer_company_billing + customer_company_bank_accounts (multi)
mappings/companyRoleToEntityRole.ts   // CompanyRole → customer_entity_roles
mappings/klientFirmaToCustomFields.ts // KlientFirma.dane → custom fields
```

**External ID strategy:**
- `customer_entities.metadata.external_id = Company.id`
- `customer_entities.source = 'erp_fromee'`
- Mapping table reused: `customer_entities.metadata.external_links: { erp_fromee_company_id, erp_fromee_klient_firma_id }`

**CLI:**
```
yarn mercato sync-erp-fromee import --dry-run
yarn mercato sync-erp-fromee import --commit
yarn mercato sync-erp-fromee import --since=2026-01-01
yarn mercato sync-erp-fromee verify              # cross-checks counts and hashes
```

Idempotent: re-run updates, never duplicates. Reports `created/updated/skipped/errors` per entity type.

**Continuous sync (Phase 3 = pull only):**
- Worker `workers/sync-erp-fromee-poll.ts` — queue-based, 5-min interval default (configurable)
- Detects changes via `Company.updatedAt > last_sync_at`
- Conflict resolution: openm wins for master fields (legalName, taxId), erp-fromee wins for derived stats (sales summary)

**KlientFirma.dane mapping (one-time merge during initial import):**
| `KlientFirma.dane` field | openm target |
|---|---|
| `nip`, `regon`, `krs` | `customer_tax_identities` (kind=NIP/REGON/KRS, country=PL) |
| `vatIds[]` | `customer_tax_identities` (kind=VAT_EU, country from prefix) |
| `formaPrawna`, `typPodmiotu`, `pelnyAdresKRS` | custom fields (Phase 1) |
| `banki[]` (>1 account) | `customer_company_bank_accounts` (Phase 4) — staged for now |
| `finanse` (paymentTerms, creditLimit, etc.) | `customer_company_billing` extensions (Phase 4) |
| `kontakty[]` | `customer_people` + `customer_person_company_links` |
| `adresy[]` | `customer_addresses` |
| `zablokowany`, `powodBlokady` | columns on `customer_entities` (Phase 4) |
| `obroty[]`, `zamowienia[]` | NOT migrated — read-only via response enricher querying erp-fromee `sales` |
| `certyfikaty[]`, `cennik[]`, `katalogArtykulow[]`, `regionyDostaw[]`, `konkurencja[]`, `upominki[]`, `mailingi[]` | deferred to Phase 5 (suppliers module) |

**Audit:**
- `audit_logs` event `customers.sync.imported` per partner
- `customer_entities.metadata.last_sync_at` + `sync_hash` (sha256 of source row)

**Acceptance:**
- Full import of erp-fromee against backup `postgres-backup/formee_2026-04-10.sql`: X partners, Y contacts, Z addresses imported with 0 errors
- Second run = idempotent (0 changes when source unchanged)
- Conflict detection: edits in both systems → log + manual review queue (entity in `customer_entities.metadata.sync_conflict = true`)
- New NIP added in erp-fromee → next sync creates `customer_tax_identity`
- KlientFirma fields merged to custom fields where applicable
- Integration test: TC-PARTNER-003-sync-import-idempotent (uses backup SQL fixture)

**Dependencies:** Phase 1, 2
**Risk:** Medium. Field-mapping is tedious; risk of data loss. Mitigations: `--dry-run` mandatory in code review, integration test with full backup fixture, manual QA on first 100 partners.

### Phase 4 — Multi-bank, GDPR, UI replacement (80 h)

**Goal:** close partner model (multi-bank, multi-VAT, blocks, GDPR), replace `klienci/` frontend in erp-fromee with openm UI.

**Data model:**

```typescript
@Entity({ tableName: 'customer_company_bank_accounts' })
export class CustomerCompanyBankAccount {
  id, organizationId, tenantId
  entityId            // FK customer_entities
  label?              // 'Domestic', 'EU', 'USD treasury'
  bankName?
  bankNumber?
  accountNumber?
  iban                // encrypted
  ibanMasked          // 'PL** **** **** **** **** **** 1234' for display
  swift?
  currency?           // 'PLN', 'EUR', ...
  countryCode?
  isPrimary
  isActive
  // SEPA inline (1:1 with IBAN)
  sepaMandateId?
  sepaMandateDate?
  sepaMandateType?    // ONE_OFF | RECURRENT
  sepaMandateStatus?  // DRAFT | ACTIVE | REVOKED | EXPIRED
  note?
  createdAt, updatedAt, deletedAt
}
```

**Field additions:**
- `customer_entities.is_blocked: boolean default false`
- `customer_entities.blocked_reason: text`
- `customer_entities.blocked_at: timestamptz`
- `customer_entities.blocked_by_user_id: uuid`
- `customer_companies.customer_since: date`
- `customer_companies.parent_company_id: uuid` (FK self-ref to `customer_entities` where kind=company) — hierarchy
- `customer_company_billing.credit_limit: decimal(14,2)`
- `customer_company_billing.credit_used: decimal(14,2)`
- `customer_company_billing.credit_currency: text`

**Encryption:**
- `customer_tax_identities.value where kind=PESEL` → encrypted via `TenantDataEncryptionService`
- `customer_company_bank_accounts.iban` → encrypted; `iban_masked` is non-encrypted display column
- Map declared in `customers/encryption.ts`

**UI replacement (erp-fromee `klienci/` → openm):**
- `KlienciPage.tsx` (2103 lines) → replaced by openm CrudForm with PL layout
- Custom CrudForm layout via `widgets/components.ts` `componentOverrides`:
  - Tabs: Dane podstawowe, Identyfikatory podatkowe, Konta bankowe, Finanse, Adresy, Kontakty, Hierarchia, Notatki
- `KlienciReports.tsx` → dashboard widget in openm
- `KlienciValidationPanel.tsx` → integration with `business_rules` module
- erp-fromee `/erp-fromee/klienci/*` redirects to `https://openm/{orgSlug}/backend/customers/companies/*`
- After 2 weeks of stable redirects: delete `src/modules/klienci/` from erp-fromee

**Acceptance:**
- Multi-bank: one partner has 3 accounts (PL, EU, USD), default primary is picked by invoice generation
- GDPR: PESEL stored encrypted, lookup via `findWithDecryption`
- Blocked partner: `SalesOrder.create` in erp-fromee against blocked partner → rejected synchronously (via webhook + cached `customer_entity_roles`)
- erp-fromee `klienci/` redirects work; old components deleted
- TC-PARTNER-004-multi-bank, TC-PARTNER-005-gdpr-pesel, TC-PARTNER-006-block-partner

**Migrations:** 2–3 files

**Dependencies:** Phase 3
**Risk:** Medium. UI override + GDPR encryption. Mitigation: feature flag `pl_customers_ui` (default off, flip per tenant), beta on 1 tenant for 1 week.

### Phase 5 — `suppliers` module (120 h)

**Goal:** dedicated supplier module with profile, certificates, evaluations, supplier-side price lists.

**New module:** `apps/mercato/src/modules/suppliers/` (decision pending in Phase 0: `apps/` if not core-grade, `packages/core/` if core-grade)

**Entities:**

```typescript
@Entity({ tableName: 'supplier_profiles' })          // 1:1 with customer_entities
class SupplierProfile {
  id, organizationId, tenantId
  entityId                                            // FK customer_entities (unique)
  defaultPaymentTerms?: string
  defaultDeliveryDays?: number
  defaultCurrency?: string
  ratingAvg?: number                                  // computed from evaluations
  lastEvaluationAt?: Date
  isPreferred: boolean
  isBlocked: boolean
  blockedReason?: string
  tier?: 'tier_1' | 'tier_2' | 'tier_3'
  notes?: string
  createdAt, updatedAt, deletedAt
}

@Entity({ tableName: 'supplier_certificates' })
class SupplierCertificate {
  id, organizationId, tenantId
  supplierId                                          // FK supplier_profiles
  kind                                                // dictionary: ISO_9001, REACH, SEDEX, FSC, RoHS, ...
  issuer?: string
  validFrom?: Date
  validTo?: Date
  attachmentId?: string                               // FK attachments
  status: 'active' | 'expired' | 'revoked'
  remark?: string
  createdAt, updatedAt, deletedAt
}

@Entity({ tableName: 'supplier_evaluations' })
class SupplierEvaluation {
  id, organizationId, tenantId
  supplierId
  periodStart, periodEnd
  qualityScore?: number                               // 0..100
  deliveryScore?: number
  priceScore?: number
  communicationScore?: number
  averageScore?: number                               // computed
  scheduleDeviationDays?: number                      // avg, negative=early
  ordersEvaluated: number
  notes?: string
  status: 'draft' | 'active' | 'locked'
  createdByUserId?: string
  createdAt, updatedAt, deletedAt
}

@Entity({ tableName: 'supplier_price_lists' })
class SupplierPriceList {
  id, organizationId, tenantId
  supplierId
  name: string
  validFrom?, validTo?
  currency?: string
  priority: number                                    // higher wins
  isActive: boolean
  createdAt, updatedAt, deletedAt
}

@Entity({ tableName: 'supplier_price_list_items' })
class SupplierPriceListItem {
  id
  priceListId
  itemNo: string                                      // FK catalog or external SKU
  itemDesc?: string
  unit?: string
  unitPrice: number
  minQty?: number
  leadTimeDays?: number
  validFrom?, validTo?
  createdAt, updatedAt
}

@Entity({ tableName: 'supplier_items' })              // mapping product → supplier SKU
class SupplierItem {
  id, organizationId, tenantId
  supplierId
  ourProductId?: string                               // FK catalog.products
  supplierItemNo: string
  supplierItemDesc?: string
  supplierPlant?: string
  isPrimary: boolean
  createdAt, updatedAt, deletedAt
}

@Entity({ tableName: 'supplier_delivery_regions' })
class SupplierDeliveryRegion {
  id, organizationId, tenantId
  supplierId
  name: string
  postalCodes: string[]                               // jsonb array
  surcharge?: number
  leadTimeDaysOffset?: number
  createdAt, updatedAt, deletedAt
}

@Entity({ tableName: 'supplier_competitors' })       // CRM-side competitor intel per supplier
class SupplierCompetitor {
  id, organizationId, tenantId
  supplierId
  competitorName: string
  area?: string
  notes?: string
  createdAt, updatedAt, deletedAt
}
```

**API contracts:**
- Standard CRUD per entity via `makeCrudRoute` with indexer
- Custom endpoints:
  - `POST /api/suppliers/[id]/evaluations` — create evaluation, recompute `rating_avg`
  - `GET /api/suppliers/[id]/scorecard` — aggregate latest N evaluations
  - `GET /api/suppliers/find-best?item_no=X&qty=Y&country=PL` — pick best supplier (price + rating + region + lead time)

**UI pages:**
- `/backend/suppliers/` — DataTable (filters: preferred, tier, country, certificates valid)
- `/backend/suppliers/[id]` — detail with tabs: Profile, Certificates, Evaluations, Price List, Items, Delivery, Competitors
- `/backend/suppliers/evaluations` — evaluations list, new evaluation wizard
- Widget injection in `customer_companies` detail (when role=supplier): banner "Open supplier profile →"

**Events:**
- `suppliers.evaluation.created`, `suppliers.evaluation.locked`
- `suppliers.certificate.expiring` (subscriber: notify procurement role 30 days before expiry)
- `suppliers.certificate.expired`
- `suppliers.profile.blocked`

**RBAC:**
- `suppliers.view`, `suppliers.manage`
- `suppliers.evaluations.create`, `suppliers.evaluations.lock`
- `suppliers.certificates.manage`
- `suppliers.preferred.set`

**Sync extension (Phase 3 mappers extended):**
- `SupplierEvaluation` → `supplier_evaluations`
- `KlientFirma.dane.certyfikaty` → `supplier_certificates`
- `KlientFirma.dane.cennik` → `supplier_price_lists` + `supplier_price_list_items`
- `KlientFirma.dane.katalogArtykulow` → `supplier_items`
- `KlientFirma.dane.regionyDostaw` → `supplier_delivery_regions`
- `KlientFirma.dane.konkurencja` → `supplier_competitors`

**Migrations:** 8 files (one per entity)

**Acceptance:**
- Create supplier profile from a company with role=supplier — works
- Create evaluation → `rating_avg` updates on profile
- Certificate expiring 30 days → notification to `procurement` role members
- `find-best?item_no=X&qty=100&country=PL` returns supplier with valid price + best scorecard + supports PL region
- Sync imported historical evaluations from erp-fromee
- TC-SUPPLIER-001 through TC-SUPPLIER-008

**Dependencies:** Phase 1, 2, 3
**Risk:** Medium. Large surface. Mitigation: feature toggle `suppliers.module.enabled`, beta on 1 tenant before general rollout.

### Phase 6 — Procurement workflow (RFQ, framework agreements) (150 h)

**Goal:** purchase-side workflow — from request for quote to framework agreement.

**New module:** `apps/mercato/src/modules/procurement/`

**Entities:**

```typescript
@Entity({ tableName: 'purchase_rfqs' })
class PurchaseRfq {
  id, organizationId, tenantId
  rfqNo                                              // sequence-generated
  title: string
  status: 'draft' | 'sent' | 'received' | 'awarded' | 'cancelled'
  deadline?: Date
  currency?: string
  termsAndConditions?: string
  awardedSupplierId?: string                         // FK supplier_profiles
  totalAwardValue?: number
  createdByUserId
  createdAt, updatedAt, deletedAt
}

@Entity({ tableName: 'purchase_rfq_items' })
class PurchaseRfqItem {
  id
  rfqId
  itemNo                                             // FK catalog or free text
  itemDesc?: string
  qty: number
  unit?: string
  targetPrice?: number
  leadTimeRequired?: number
  notes?: string
}

@Entity({ tableName: 'purchase_rfq_responses' })
class PurchaseRfqResponse {
  id, organizationId, tenantId
  rfqId
  supplierId                                         // FK supplier_profiles
  status: 'pending' | 'submitted' | 'declined' | 'won' | 'lost'
  totalValue?: number
  submittedAt?: Date
  postAwardQualityScore?: number                     // populated after delivery
  notes?: string
  createdAt, updatedAt
}

@Entity({ tableName: 'purchase_rfq_response_items' })
class PurchaseRfqResponseItem {
  id
  responseId
  rfqItemId
  unitPrice?: number
  leadTimeDays?: number
  currency?: string
  validUntil?: Date
  notes?: string
}

@Entity({ tableName: 'purchase_framework_agreements' })
class PurchaseFrameworkAgreement {
  id, organizationId, tenantId
  agreementNo
  supplierId
  title: string
  validFrom: Date
  validTo: Date
  totalCommittedValue?: number
  totalUsedValue: number                             // updated on each PO drawdown
  currency?: string
  status: 'draft' | 'active' | 'expired' | 'terminated'
  createdAt, updatedAt, deletedAt
}

@Entity({ tableName: 'purchase_framework_items' })
class PurchaseFrameworkItem {
  id
  agreementId
  itemNo
  contractedPrice: number
  contractedQty?: number
  drawnQty: number                                   // updated on PO drawdown
  unit?: string
  notes?: string
}
```

**(Optional, Phase 6.5) `purchase_orders` if not delegated to erp-fromee.**

**Workflow (uses `workflows` module):**

```
RFQ Lifecycle:
  Draft → Send to suppliers (email step) → Collect responses (timer + manual)
  → Compare (matrix view) → Award (manual decision) → Create PO
  → After delivery: trigger evaluation_due event for awarded supplier
```

**UI:**
- `/backend/procurement/rfqs/` — pipeline view (kanban by status)
- `/backend/procurement/rfqs/[id]` — comparison matrix (suppliers × items × prices)
- `/backend/procurement/agreements/` — framework agreement list with drawdown progress bars
- `/backend/procurement/agreements/[id]` — detail with item-level drawdown
- Widget on supplier detail: latest RFQs, active framework agreements

**Events:**
- `procurement.rfq.draft_created`, `procurement.rfq.sent`, `procurement.rfq.response_received`, `procurement.rfq.awarded`, `procurement.rfq.cancelled`
- `procurement.framework.created`, `procurement.framework.drawdown`, `procurement.framework.expiring`
- Auto-trigger: `procurement.evaluation.due` 30 days after `delivered_at`

**Strangler erp-fromee:**
- `purchaseRfq*Service.js` in erp-fromee marked `@deprecated`, redirect users to openm
- New RFQs created in openm; old RFQs remain in erp-fromee read-only (audit retention)
- Existing `purchaseFrameworkAgreements` migrated one-time to openm during Phase 6 cutover

**Migrations:** ~10 files

**Acceptance:**
- Create RFQ with 5 items → send to 3 suppliers → all 3 respond → comparison matrix renders → award → PO created → after delivery, evaluation auto-prompt fires
- Framework drawdown: PO against agreement decreases `totalUsedValue` and item-level `drawnQty`
- E2E test of full workflow: TC-PROC-001 through TC-PROC-005

**Dependencies:** Phase 5
**Risk:** High. Workflow + matrix UI is non-trivial. Mitigation: MVP without framework agreements (RFQ + award + PO only), add framework in Phase 6.5.

### Phase 7 — Production cutover (40 h)

**Goal:** erp-fromee `Company` becomes full read-replica. Writes only via openm.

**Outbound sync (one-way push: openm → erp-fromee):**
- Subscriber `customers/subscribers/sync-erp-fromee-push.ts` listens to `customers.entity.updated`, `customers.entity.created`, `customers.entity.deleted`
- Pushes to erp-fromee via REST endpoint or direct Prisma upsert (decision: direct Prisma for performance, REST for clean API boundary — TBD in Phase 7 implementation)
- Idempotent upsert keyed by `external_id`
- Conflict resolution: openm wins for partner master fields

**Write blockade in erp-fromee:**
- Prisma middleware blocks `prisma.company.create/update/delete` unless header `X-Sync-Source: openm` present (or service-role flag set in DI context)
- UI in erp-fromee for `klienci/dostawcy` rendered read-only with link "Edit in CRM →"
- API endpoints `/api/firmy/*` return 410 Gone with `Location: <openm URL>`

**`KlientFirma` elimination:**
- After 2 weeks of stable outbound sync (zero conflicts in audit log)
- Migration in erp-fromee: `DROP TABLE "KlientFirma"`
- Delete erp-fromee services: `klienciSyncService.js`, `klienciCollectionsService.js`, `klienciDuplicatesService.js`, `klienciEnrichmentService.js`, `kontaktyService.js`, `firmyMutationService.js` (the latter is replaced by sync receiver)
- Delete `src/modules/klienci/` if not already removed in Phase 4

**Monitoring:**
- Dashboard widget: sync health (lag, error rate, conflict count last 24h)
- Alert: sync lag >10 min → Slack #ops + PagerDuty after 3 occurrences in 1 hour
- Per-tenant sync metrics: `sync_runs_total`, `sync_failures_total`, `sync_lag_seconds`

**Acceptance:**
- 1 week of writes via openm only, 0 unresolved sync conflicts
- `KlientFirma` table dropped, no code references
- erp-fromee partner UI shows read-only banner
- TC-CUTOVER-001 through TC-CUTOVER-003

**Dependencies:** Phase 4 (UI replacement done)
**Risk:** Medium. Every erp-fromee service writing to `Company` must be located and rerouted. Mitigation: 2-week dual-write period before flipping the blockade, rollback plan = remove blockade middleware.

### Phase 8 — Hardening, GDPR, observability (80 h, ongoing)

**Goal:** production readiness — RODO compliance, audit, performance, observability.

**GDPR:**
- `GET /api/customers/people/[id]/gdpr-export` — full PDF + JSON dump of all data tied to a person
- `DELETE /api/customers/people/[id]/gdpr-purge` — anonymization workflow:
  - PII fields redacted: `displayName='[redacted]'`, emails/phones nulled, PESEL deleted
  - Foreign references retained but display as "[redacted]"
  - Audit trail kept with hashed reference (sha256 of original ID + tenant secret)
- Data retention policy declared per kind in `customers/setup.ts`:
  - Deals: 7 years (tax law)
  - Activities: 3 years
  - Marketing prefs: until opt-out + 30 days
- DPA (Data Processing Agreement) opt-in capture before processing

**Cross-system audit:**
- Webhook receiver in openm: erp-fromee writes (audit-only) → openm `audit_logs` with `source='erp_fromee'`
- All openm commands already emit audit logs via Command Pattern (Phase M)

**Performance:**
- Audit indexes after 4 weeks of production traffic (via `pg_stat_statements`)
- Composite index `customer_entities(organization_id, tenant_id, kind, deleted_at) where deleted_at is null`
- Materialized view `customer_partner_summary`: latest interaction, active deal count, ARR
- Redis cache for `find-best supplier` queries (TTL 5 min)

**Search & AI:**
- Re-index vector search for new entities (`supplier_profiles`, `supplier_certificates`)
- New AI tools (`ai-tools.ts` in `suppliers` and `procurement`):
  - `findBestSupplier({ itemNo, qty, country, certificates: ['ISO_9001'] })`
  - `summarizeSupplierScorecard(supplierId)`
  - `draftRfqFromHistoricalDemand({ items, leadTimeRequired })`

**Observability:**
- Prometheus/Grafana metrics:
  - `partner_sync_lag_seconds`
  - `rfq_response_time_hours`
  - `supplier_evaluation_freshness_days`
  - `partner_search_p99_ms`
- Structured logging (pino) with `partner_id` correlation ID across openm + erp-fromee

**Acceptance:**
- GDPR purge test: create partner → record consents → withdraw → after purge, all PII redacted in both openm and erp-fromee, audit log retained with hashed reference
- Sync lag <30 sec p99 for 1 week
- Top 10 query plans <50 ms p95
- TC-HARDEN-001 (GDPR), TC-HARDEN-002 (sync lag), TC-HARDEN-003 (audit cross-system)

**Dependencies:** Phase 7
**Risk:** Low (incremental). GDPR purge requires legal review before implementation.

## Data Models — consolidated

After Phase 8, the canonical data graph:

```
customer_entities (kind: person | company)
├── customer_people                  (1:1 if kind=person)
├── customer_companies               (1:1 if kind=company; legal_form distinguishes JDG)
├── customer_tax_identities          (1:N)
├── customer_addresses               (1:N)
├── customer_company_billing         (1:1)
├── customer_company_bank_accounts   (1:N)
├── customer_entity_roles            (1:N: customer | supplier | partner | carrier | bank | internal)
├── customer_person_company_links    (M:N for persons↔companies)
├── customer_person_company_roles    (M:N role per link)
├── customer_labels (assignments)    (M:N)
├── customer_tags (assignments)      (M:N)
├── customer_deals → customer_deal_stage_transitions
├── customer_activities (calendar)
├── customer_interactions (canonical interaction model)
├── customer_comments
├── customer_todo_links
└── supplier_profiles                (1:1, only for entities with role=supplier)
    ├── supplier_certificates        (1:N)
    ├── supplier_evaluations         (1:N)
    ├── supplier_price_lists         (1:N → supplier_price_list_items)
    ├── supplier_items               (1:N, mapping to catalog.products)
    ├── supplier_delivery_regions    (1:N)
    └── supplier_competitors         (1:N)

purchase_rfqs                        (procurement module, references supplier_profiles)
├── purchase_rfq_items
├── purchase_rfq_responses           (per supplier)
└── purchase_rfq_response_items

purchase_framework_agreements        (per supplier)
└── purchase_framework_items
```

## API Contracts — surface summary

| Phase | Module | Endpoints added |
|---|---|---|
| 1 | customers | `/api/customers/companies/:id/tax-identities` (CRUD) |
| 2 | customers | `/api/customers/suppliers` (list, reuses companies CRUD with filter), `/api/customers/companies/:id/roles` (toggle) |
| 3 | sync_erp_fromee | `/api/sync_erp_fromee/run`, `/api/sync_erp_fromee/status`, `/api/sync_erp_fromee/conflicts` |
| 4 | customers | `/api/customers/companies/:id/bank-accounts` (CRUD), `/api/customers/companies/:id/block`, `/api/customers/companies/:id/unblock` |
| 5 | suppliers | `/api/suppliers` (CRUD), `/api/suppliers/:id/{certificates|evaluations|price-lists|items|delivery-regions|competitors}` (CRUD), `/api/suppliers/:id/scorecard`, `/api/suppliers/find-best` |
| 6 | procurement | `/api/procurement/rfqs` (CRUD), `/api/procurement/rfqs/:id/{items|responses|award}`, `/api/procurement/agreements` (CRUD), `/api/procurement/agreements/:id/items` |
| 7 | customers | sync push subscriber (no new public endpoints) |
| 8 | customers | `/api/customers/people/:id/gdpr-export`, `/api/customers/people/:id/gdpr-purge` |

All routes export `openApi` per AGENTS.md and use `makeCrudRoute` with `indexer: { entityType }` where applicable.

## Risks & Impact Review

| # | Phase | Risk | Severity | Affected | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | 0 | Audit reveals <50 partners → strangler is overkill | Low | Strategy | Switch to in-place refactor, abandon this spec | Low |
| R2 | 1 | Tax-identity unique constraint conflicts with existing duplicates in erp-fromee | Medium | Sync import in P3 | Pre-import dedup script; manual review queue for conflicts | Low |
| R3 | 2 | `lifecycle_stage='supplier'` semantically clashes with sales-funnel use | Low | UI clarity | Use `customer_entity_roles` instead of lifecycle_stage for hard semantics | None |
| R4 | 3 | Mapping `KlientFirma.dane` JSON loses fields | High | Data integrity | `--dry-run` mandatory, integration test on full backup, manual QA on first 100 partners | Low |
| R5 | 3 | Continuous sync diverges silently | Medium | Data freshness | Sync hash + reconciliation job, weekly cross-system count audit | Low |
| R6 | 4 | GDPR encryption breaks existing search | Medium | UX | `decryptIndexDocForSearch` already in openm; integration test for encrypted-field search | Low |
| R7 | 4 | UI override breaks DS-Foundation v2 components | Low | Visual regression | Component override via wrapper mode (preserves DS), DS-guardian skill scan | None |
| R8 | 5 | `supplier_profiles` 1:1 fails when entity changes role | Medium | Data integrity | Allow soft-delete + re-create, never hard delete; `entity_role` removal cascades to soft-delete supplier_profile | Low |
| R9 | 6 | RFQ workflow scope creep | High | Schedule | Time-box Phase 6.5 for framework, MVP without it | Medium |
| R10 | 7 | Cutover blocks legitimate erp-fromee writes | High | Production | Dual-write period 2 weeks before blockade, rollback = remove middleware | Low |
| R11 | 7 | `KlientFirma` drop loses unmigrated data | High | Data loss | 2-week soak, full backup before drop, replay capability via sync logs | Low |
| R12 | 8 | GDPR purge non-compliant with legal interpretation | High | Compliance | Legal review before implementation, retention policy table reviewed | Low |
| R13 | 8 | Performance regressions surface only in production | Medium | Performance | Load test Phase 5+6 before Phase 7, materialized views ready before cutover | Low |

### Backward Compatibility Implications

Per `BACKWARD_COMPATIBILITY.md`:

- **Surface 5 (Event IDs):** new events declared per phase — additive, no rename of existing
- **Surface 7 (API URLs):** all new routes additive, no rename of existing
- **Surface 8 (DB schema):** all changes additive — new tables, new nullable columns, no removal/rename
- **Surface 10 (ACL feature IDs):** new features added (`customers.suppliers.*`, `suppliers.*`, `procurement.*`) — no rename of existing
- **Surface 13 (Generated file contracts):** `entities.generated.ts` grows additively; no breaking changes to `BootstrapData` shape

Phase 4 risk: extending `customer_company_billing` columns is additive, but if Phase 4 introduces logical changes to billing (e.g. moving fields to `customer_company_bank_accounts`), we MUST keep old fields populated for ≥1 minor version per contract.

## Final Compliance Report

- [x] Strangler approach justified (in-place refactor compared and rejected)
- [x] All phases have acceptance criteria, estimates, dependencies, risks
- [x] Data models specified with full TypeScript shapes and indexes
- [x] API contracts enumerated per phase
- [x] Cross-module integration documented (events, RBAC, audit, GDPR)
- [x] BC contract reviewed for each surface
- [x] Integration test naming convention (TC-PARTNER-*, TC-SUPPLIER-*, TC-PROC-*, TC-CUTOVER-*, TC-HARDEN-*)
- [x] Rollback plan exists for irreversible operations (Phase 7 cutover, Phase 7 KlientFirma drop)
- [ ] Stakeholder sign-off on full scope (pending)
- [ ] Phase 0 audit numbers populated (pending Phase 0 execution)

## Progress

Phase order per ADR-4 re-prioritization + ADR-7 (May MVP-S inserted):

- [x] Phase 0 — Discovery & decisions (16 h) — [audit report](analysis/ANALYSIS-2026-05-03-erp-fromee-partner-data.md)
- [x] Phase 1 — Partner core: TaxIdentity, kind, PL specifics (40 h) — [PR #1](https://github.com/Kuba74/openm/pull/1) (in review)
- [ ] **Phase MVP-S — May Sales MVP in openm (96 h, 5 weeks)** — see ADR-7 + [readiness audit](analysis/ANALYSIS-2026-05-03-openm-sales-readiness.md)
- [ ] Phase 2 — Supplier role overlay (24 h)
- [ ] Phase 5 — `suppliers` module (120 h)
- [ ] Phase 3 — Sync inbound: erp-fromee → openm (80 h, MVP-zakres absorbed into MVP-S; full sync here)
- [ ] Phase 6 — Procurement workflow: RFQ, framework agreements (150 h)
- [ ] ~~Phase 4 — Multi-bank, GDPR, UI replacement (80 h)~~ — **absorbed into MVP-S** (UI replacement no longer needed: openm UI is built fresh; multi-bank deferred to Phase 5)
- [ ] Phase 7 — Production cutover (40 h)
- [ ] Phase 8 — Hardening, GDPR, observability (80 h)

Total: **~726 h** (~18 weeks at 40 h/week, with May MVP-S inserted)

## Per-phase spec files

Per AGENTS.md, each phase MAY get a dedicated spec when implementation starts. Master spec (this file) provides architectural overview; per-phase specs provide implementation detail.

- `2026-MM-DD-partner-master-phase-0-audit.md` (Phase 0)
- `2026-MM-DD-partner-master-phase-1-tax-identity.md` (Phase 1)
- `2026-MM-DD-partner-master-phase-2-supplier-role.md` (Phase 2)
- `2026-MM-DD-partner-master-phase-3-sync-inbound.md` (Phase 3)
- `2026-MM-DD-partner-master-phase-4-multi-bank-gdpr-ui.md` (Phase 4)
- `2026-MM-DD-partner-master-phase-5-suppliers-module.md` (Phase 5)
- `2026-MM-DD-partner-master-phase-6-procurement.md` (Phase 6)
- `2026-MM-DD-partner-master-phase-7-cutover.md` (Phase 7)
- `2026-MM-DD-partner-master-phase-8-hardening.md` (Phase 8)

Per-phase specs are created at the start of each phase and referenced in commit messages.

## ADRs (post-audit, 2026-05-03)

Phase 0 audit ([ANALYSIS-2026-05-03-erp-fromee-partner-data.md](analysis/ANALYSIS-2026-05-03-erp-fromee-partner-data.md)) ratified the following decisions:

### ADR-1: Strangler approved
1140 partners is enough scale to justify strangler over in-place refactor of 8272-line monolithic schema. Phased delivery is faster than rewriting in place.

### ADR-2: Sync direction
- Phase 3 = pull (erp-fromee → openm), bulk + continuous
- Phase 7 = push (openm → erp-fromee), after cutover

### ADR-3: Canonical IDs
- openm `customer_entities.id` (UUID) = master
- erp-fromee `Company.id` (cuid) mapped via `customer_entities.metadata.external_id` + `source = 'erp_fromee'`
- Legacy mapping retained: `customer_entities.metadata.external_links.legacy_klient_firma_id`

### ADR-4: Phase re-prioritization (CRITICAL)
Audit revealed system is **82% supplier-side** (940 supplier-only of 1140). New phase order:

```
0 → 1 → 2 → 5 → 3 → 6 → 4 → 7 → 8
```

Rationale: build supplier model on empty system FIRST (Phases 1, 2, 5), then sync historical data into the proper shape (Phase 3), then add procurement workflow (Phase 6), then deal with customer UI (Phase 4), finally cutover + hardening.

Original order (1→2→3→4→5→6→7→8) would have built incomplete sync mappings, wasting Phase 3 effort.

### ADR-5: `KlientFirma` excluded from this migration
Audit revealed `KlientFirma` is mis-named — it stores **4730 construction objects** (buildings/projects), not customer data. Polish-specific customer data lives in `Company.metadata` JSONB on the 615 ERPBOS-sourced rows.

`KlientFirma` migration is **out of scope** for this spec. A separate future spec (`2026-MM-DD-construction-objects-migration.md`) will design its migration to a `construction_objects` domain.

Phase 3 mapping table is updated: drop `KlientFirma.dane` mappings, add `Company.metadata` mappings.

### ADR-6: JDG reclassification in Phase 1
Audit found 70 `Company.kind=PERSON` rows where 87% have NIP — these are JDG (sole proprietors), misclassified. Phase 1 migration includes a one-time reclassification:

```sql
UPDATE "Company"
SET kind = 'ORGANIZATION',
    metadata = jsonb_set(metadata, '{legalForm}', '"jdg"')
WHERE kind = 'PERSON'
  AND "taxId" IS NOT NULL AND "taxId" != '';
```

After reclass, true B2C natural persons are the residual 9 records. Most are likely test/seed data — Phase 0 manual review before Phase 1 cutover.

### ADR-7: May MVP-S inserted between Phase 1 and Phase 2 (post-readiness-audit)
Per [ANALYSIS-2026-05-03-openm-sales-readiness.md](analysis/ANALYSIS-2026-05-03-openm-sales-readiness.md), openm's `sales` module is enterprise-grade — 27 entities, 36 API routes, 9 backend pages, calculation/tax services, document numbering generator, public quote tokens, accept/send/convert workflow actions. Catalog module is also complete. **The 5-week May MVP delivers Polish sales (B2B quotes, orders, PDF) on openm, NOT erp-fromee.** Original re-prioritization (Phase 1 → 2 → 5 → 3 → 6 → 4 → 7 → 8) is overlaid with MVP-S between Phase 1 and Phase 2.

**Rejected alternatives:**
- Build May MVP in erp-fromee (Option A/B): adds to 8272-line Prisma monolith, deepens dual-source-of-truth, breaks BC contract surface 8 (DB schema), wastes Phase 1 PR work, and forces bidirectional sync of live transactions — incompatible with Open Mercato modular architecture per user decision 2026-05-03.

### ADR-8: PDF library — `@react-pdf/renderer`
The only major MVP gap is PDF rendering (no library currently in repo). Choice between `@react-pdf/renderer` (server-side React in Next.js, no headless browser) and `puppeteer` (HTML→PDF, full CSS control). **Decision: `@react-pdf/renderer`** — fewer dependencies, no Chromium binary in production image, fits Next.js server context, simpler to test. Tradeoff: slightly less CSS power vs HTML, but sufficient for a B2B sales document.

### ADR-9: Sync historycznych ofert — MVP-zakres
erp-fromee carries 8100 `SalesOffer` records. Full migration into `sales_quotes` is non-trivial (status mapping, custom metadata fields, possible duplicate keys). **Decision: MVP-zakres = top 500 active offers (status != cancelled, sorted by valueNet desc)** for demo. Full sync deferred to **Phase 3** (post-MVP, June 2026).

### ADR-10: Out-of-MVP scope
Per readiness audit gap analysis, the following EPIC stories are **deferred to post-MVP (June 2026):**
- **S5 — Sales Inquiries** (zapytania ofertowe) — no native equivalent, requires new module or `customer_interactions` extension
- **S8 — Activities & follow-ups** — `customer_activities` exists but UI timeline + follow-up workflow needs build
- **S9 — Full sales dashboard** — only `new-orders` and `new-quotes` widgets exist; top customers/expiring offers/funnel widgets are post-MVP

**Kept in MVP scope** (because foundation already exists in openm):
- **S6 — Leads/Opportunities** is foundation-complete via `customer_deals` + pipeline_stages + deal_stage_transitions, but UI polish stays in MVP only as time allows; pipeline kanban is post-MVP
- **S7.1 — Quote → Order conversion** — already implemented (`/api/sales/quotes/convert`), only verification needed

## Changelog

- 2026-05-03 — Initial spec created (Kuba74). Full 9-phase scope ratified.
- 2026-05-03 — Phase 0 audit complete. ADRs 1-6 ratified. Phase order re-prioritized to 1→2→5→3→6→4→7→8. `KlientFirma` removed from scope. Risk register extended with R14-R19. See [ANALYSIS-2026-05-03-erp-fromee-partner-data.md](analysis/ANALYSIS-2026-05-03-erp-fromee-partner-data.md).
