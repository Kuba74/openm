# ERP-fromee Import — Customers (200 partners)

**Status:** Draft
**Created:** 2026-05-03
**Target window:** Można odpalić od razu (po Tygodniu 1, niezależnie od Tygodnia 2)
**Author:** Kuba74
**Parent spec:** [2026-05-03-partner-master-migration.md](2026-05-03-partner-master-migration.md)
**Companion audit:** [ANALYSIS-2026-05-03-import-readiness-erp-fromee.md](analysis/ANALYSIS-2026-05-03-import-readiness-erp-fromee.md)
**Estimated:** ~15 h

## TLDR

One-time import skrypt który zaciąga 200 firm z rolą CUSTOMER (+ ewentualne PROSPECT) z erp-fromee Postgres do openm. Build na Tygodniu 1: customer_tax_identities + helpery + Polish columns. Module: `apps/mercato/src/modules/sync_erp_fromee/`. CLI: `yarn mercato sync-erp-fromee customers --dry-run` / `--commit`. Idempotent przez `metadata.external_id` lookup.

## Decisions (ratified 2026-05-03)

- **D1** Filtr ról: `roleType IN ('CUSTOMER', 'PROSPECT')` — daje ~200 partners (200 CUSTOMER, ~0 PROSPECT obecnie)
- **D2** JDG: PERSON-z-NIP (61 rekordów) → reclassify do company + `legal_form='jdg'`. PERSON-bez-NIP (9 rekordów) → import jako person z manual_review flag w report.
- **D3** Source attribution: wszystkie `CompanySourceLink` linki → `customer_entities.metadata.external_links` array
- **D4** INTERNAL companies: SKIP (nie partnerzy zewnętrzni)

## Architecture

### Module: `apps/mercato/src/modules/sync_erp_fromee/`

```
sync_erp_fromee/
├── index.ts                       # Module metadata
├── di.ts                          # Awilix registrar
├── lib/
│   ├── erpFromeeAdapter.ts        # Connection do erp-fromee Postgres
│   ├── mappers/
│   │   ├── companyToPartner.ts    # Company → customer_entities + customer_companies/customer_people
│   │   ├── taxIdentities.ts       # taxId/regon/krs/vatEu → customer_tax_identities (Phase 1)
│   │   ├── roles.ts               # CompanyRole → customer_entity_roles + lifecycle_stage
│   │   ├── contacts.ts            # CompanyContact → customer_people + person_company_links
│   │   ├── addresses.ts           # CompanyAddress → customer_addresses (per address_type)
│   │   ├── billing.ts             # CompanyBankAccount[primary] + CompanyRole.{paymentTerms,currency,creditLimit} → customer_company_billing
│   │   ├── metadata.ts            # Company.metadata.{formaPrawna,typPodmiotu,pelnyAdresKRS,...} → customer_companies columns
│   │   └── audit.ts               # Pre-import dedup queries (NIP, primary contacts, primary addresses)
│   ├── importPipeline.ts          # Orkiestracja całości
│   ├── reportFormatter.ts         # Dry-run report
│   └── idempotency.ts             # external_id lookup, upsert pattern
├── cli/
│   └── import-customers.ts        # CLI command
└── __integration__/
    └── TC-IMPORT-001-erp-fromee-customers.spec.ts
```

### Connection do erp-fromee

ENV variable: `ERP_FROMEE_DATABASE_URL=postgresql://user:pass@localhost:5432/formee`

Adapter używa `pg` module (już w deps), separate connection pool (nie współdzieli z openm DB).

## Stories in scope

### S1 — `companyToPartner.ts` mapper (4 h)

```typescript
export type CompanyImportResult = {
  source: ErpFromeeCompany
  target: {
    entity: Partial<CustomerEntity>
    profile: Partial<CustomerCompany> | Partial<CustomerPerson>
    profileKind: 'company' | 'person'
  }
  warnings: string[]
}

export function mapCompanyToPartner(
  source: ErpFromeeCompany,
  scope: { organizationId: string; tenantId: string },
): CompanyImportResult {
  // Logic:
  // 1. Determine kind: 
  //    - source.kind=ORGANIZATION → openm kind=company
  //    - source.kind=PERSON + has taxId → openm kind=company + legal_form=jdg (D2)
  //    - source.kind=PERSON + no taxId → openm kind=person (manual_review=true if test data)
  // 2. Build customer_entities row:
  //    - displayName ← source.displayName ?? source.legalName
  //    - description ← source.note
  //    - status ← 'active' if isActive, 'archived' otherwise
  //    - is_active ← source.isActive
  //    - metadata.external_id ← source.id
  //    - metadata.source ← 'erp_fromee'
  //    - metadata.partner_no ← source.companyNo
  //    - metadata.short_name ← source.shortName
  //    - metadata.search_term ← source.searchTerm  (for index hints)
  //    - metadata.is_blocked ← source.isBlocked  (G1 gap, custom field till Phase 4)
  //    - metadata.legacy_klient_firma_id ← source.metadata?.legacyKlientFirmaId
  // 3. Build customer_companies / customer_people row
  //    - For company: legal_name, brand_name, country_code (default 'PL')
  //    - For company with metadata: legal_form, entity_type, full_address_krs (Phase 1)
  //    - For person (B2C): first_name/last_name (split from displayName)
  // 4. Warnings:
  //    - "PERSON without NIP — manual review needed" (9 cases)
  //    - "Conflicting tax IDs in source row vs metadata.legacyKlientFirmaId" (rare)
  //    - "isBlocked=true — currently stored as custom field (Phase 4 will add column)"
}
```

Unit tests:
- ORGANIZATION mapping
- PERSON-with-NIP → JDG (D2)
- PERSON-without-NIP → person + manual_review
- isBlocked → metadata.is_blocked
- metadata.formaPrawna → customer_companies.legal_form
- isPrimary preservation (later in contacts/addresses mappers)

### S2 — `taxIdentities.ts` mapper (1 h)

```typescript
export function mapTaxIdentities(
  source: ErpFromeeCompany,
  entityId: string,
  scope: Scope,
): CustomerTaxIdentity[] {
  const identities: CustomerTaxIdentity[] = []
  if (source.taxId) {
    identities.push({
      entityId, organizationId: scope.organizationId, tenantId: scope.tenantId,
      countryCode: source.countryCode ?? 'PL',
      kind: 'nip',
      value: source.taxId,
      isPrimary: true,
    })
  }
  if (source.regon) {
    identities.push({ ...same shape, kind: 'regon', value: source.regon })
  }
  if (source.krs) {
    identities.push({ ...same shape, kind: 'krs', value: source.krs })
  }
  if (source.vatEu) {
    identities.push({ ...same shape, kind: 'vat_eu', value: source.vatEu })
  }
  return identities
}
```

Notes:
- 0 erp-fromee Company has REGON populated → 0 imports for kind=regon
- 0 has vatEu populated separately (it's in taxId for cross-border)
- Validation skipped (already validated upstream w erp-fromee); bypass zod transform
- Idempotent: lookup by (entity_id, country_code, kind) before insert

Unit tests: 5 cases (no IDs, only NIP, NIP+KRS, full set, vatEu detection)

### S3 — `roles.ts` mapper (1 h)

```typescript
const ROLE_TYPE_MAP: Record<ErpFromeeRoleType, OpenmRoleType> = {
  CUSTOMER: 'customer',
  SUPPLIER: 'supplier',
  PROSPECT: 'prospect',
  LEAD: 'lead',
  PARTNER: 'partner',
  CARRIER: 'carrier',
  BANK: 'bank',
  INTERNAL: 'internal',  // SKIP'owane (D4) ale mapper zachowuje semantykę
}

export function mapRoles(
  sourceRoles: ErpFromeeCompanyRole[],
  entityId: string,
  scope: Scope,
): {
  entityRoles: CustomerEntityRole[]
  primaryLifecycleStage: string  // pierwszy sensowny role_type
  shouldSkip: boolean             // jeśli wszystkie role to INTERNAL
} {
  const filtered = sourceRoles.filter((r) => r.roleType !== 'INTERNAL' || sourceRoles.length === 1)
  if (filtered.every((r) => r.roleType === 'INTERNAL')) {
    return { entityRoles: [], primaryLifecycleStage: 'other', shouldSkip: true }
  }
  // Per role: create customer_entity_roles row
  // Pick primary lifecycle: customer > prospect > supplier > lead > partner > carrier
  ...
}
```

Unit tests:
- Single CUSTOMER role
- Dual CUSTOMER + SUPPLIER
- INTERNAL only → skip
- INTERNAL + CUSTOMER → keep (skip INTERNAL)

### S4 — `contacts.ts` mapper (2 h)

```typescript
export function mapContacts(
  sourceContacts: ErpFromeeCompanyContact[],
  companyEntityId: string,
  scope: Scope,
): {
  people: CustomerPerson[]
  links: CustomerPersonCompanyLink[]
  warnings: string[]
} {
  // For each contact:
  // 1. Create customer_entities row (kind=person)
  // 2. Create customer_people row (firstName, lastName, jobTitle, department)
  // 3. Create customer_person_company_links row
  //    - is_primary = source.isPrimary
  //    - PARTIAL UNIQUE INDEX z Tygodnia 1 wymaga max 1 primary per company → handle conflicts
  //    - Multiple primary in source: keep first (earliest createdAt) as primary, rest as non-primary
  // 4. Map contactFunction (German: Architekt/Statiker/Verkauf/Einkauf...) → customer_person_company_roles.role_value
  //    Mapping table inline.
}

const CONTACT_FUNCTION_MAP: Record<string, string> = {
  'Architekt': 'architect',
  'Statiker': 'structural_engineer',
  'Bauherr': 'project_owner',
  'Verkauf': 'sales',
  'Einkauf': 'procurement',
  'Buchhaltung': 'accounting',
  'Qualität': 'quality',
  'Logistik': 'logistics',
  'Technik': 'technical',
  'Sonstige': 'other',
}
```

Note: 380 CompanyContact, but only 9 mają isPrimary=true. Większość firm nie ma primary contact'a — to OK z openm (primary is optional).

Unit tests:
- Single contact, isPrimary=true
- Multiple primary contacts (data error in source) → first wins
- Contact without isPrimary
- contactFunction mapping (German → openm)

### S5 — `addresses.ts` mapper (1 h)

```typescript
const ADDRESS_TYPE_MAP: Record<ErpFromeeAddressType, OpenmAddressType> = {
  PRIMARY: 'office',
  INVOICE: 'billing',
  DELIVERY: 'shipping',
}

export function mapAddresses(
  sourceAddresses: ErpFromeeCompanyAddress[],
  companyEntityId: string,
  scope: Scope,
): { addresses: CustomerAddress[]; warnings: string[] } {
  // For each address:
  // 1. Map address_type via ADDRESS_TYPE_MAP
  // 2. Concat name1+name2 → attention_of (or metadata)
  // 3. Direct map: street1/street2 → address_line_1/2, postalCode/city/region/countryCode
  // 4. is_primary → respect partial unique index per (entity_id, address_type) z Tygodnia 1
  //    Same handling jak contacts (first wins on conflict)
}
```

Unit tests:
- Office + billing + shipping per company
- Multiple addresses same type → first primary wins
- Address with name1/name2 → attention_of formatted
- Latitude/longitude preservation

### S6 — `billing.ts` mapper (1 h)

```typescript
export function mapBilling(
  sourceCompany: ErpFromeeCompany,
  sourceRoles: ErpFromeeCompanyRole[],
  sourceBankAccounts: ErpFromeeCompanyBankAccount[],
  companyEntityId: string,
  scope: Scope,
): CustomerCompanyBilling | null {
  // 1. Find primary bank account (or first active)
  const primaryBank = sourceBankAccounts.find((b) => b.isPrimary && b.isActive)
                  ?? sourceBankAccounts.find((b) => b.isActive)
                  ?? sourceBankAccounts[0]
  
  // 2. Find CUSTOMER role (best for paymentTerms, currency, creditLimit)
  const customerRole = sourceRoles.find((r) => r.roleType === 'CUSTOMER' && r.isActive)
  
  // 3. Build CustomerCompanyBilling
  if (!primaryBank && !customerRole) return null  // nothing to fill
  
  return {
    entityId: companyEntityId, organizationId: scope.organizationId, tenantId: scope.tenantId,
    bankName: primaryBank?.bankName ?? null,
    bankAccountMasked: maskIban(primaryBank?.iban) ?? null,  // helper z Phase 1 encryption
    paymentTerms: customerRole?.paymentTerms ?? null,
    preferredCurrency: customerRole?.currency ?? null,
    salesOwnerUserId: null,  // erp-fromee nie ma tego field
    defaultOfferValidityDays: null,  // default = 30 z helpera Tygodnia 1
  }
}
```

Notes:
- 66 CompanyBankAccount → 66 customer_company_billing rows (5.8% pokrycie)
- Pozostałe firmy bez billing row → fallback do salesSettings.defaultCurrencyCode (Tydzień 2)
- IBAN encryption: użyć `TenantDataEncryptionService` jeśli encryption flag enabled

Unit tests: 4 cases (with bank, without bank, multiple banks first-primary-wins, customer role with paymentTerms)

### S7 — `metadata.ts` mapper (1 h)

```typescript
export function mapMetadata(
  source: ErpFromeeCompany,
  target: { customerCompany: CustomerCompany; customFields: Record<string, unknown> },
): void {
  const meta = source.metadata ?? {}
  
  // Polish-specific columns (Phase 1)
  if (meta.formaPrawna && target.customerCompany.kind === 'company') {
    target.customerCompany.legalForm = mapLegalForm(meta.formaPrawna)
    // mapping: 'Sp. z o.o.' → 'sp_z_oo', 'S.A.' → 's_a', 'GmbH' → 'gmbh', 'JDG' → 'jdg', etc.
  }
  if (meta.typPodmiotu) {
    target.customerCompany.entityType = mapEntityType(meta.typPodmiotu)
    // mapping: 'Firma' → 'organization' (default), 'Osoba prywatna' → 'consumer'
  }
  if (meta.pelnyAdresKRS) {
    target.customerCompany.fullAddressKrs = meta.pelnyAdresKRS
  }
  
  // Custom fields (rzadziej używane)
  if (meta.kategoriaKontaktu) {
    target.customFields.contact_category = meta.kategoriaKontaktu
  }
  if (meta.statusRelacji) {  // 2 rekordy, prawie nieużywane
    target.customFields.relationship_status = meta.statusRelacji
  }
  if (meta.powodBlokady) {
    target.customFields.block_reason = meta.powodBlokady  // G1 gap
  }
}

const LEGAL_FORM_MAP: Record<string, string> = {
  'Sp. z o.o.': 'sp_z_oo',
  'Sp. z o.o': 'sp_z_oo',
  'S.A.': 's_a',
  'SA': 's_a',
  'GmbH': 'gmbh',
  'JDG': 'jdg',
  'Sp. komandytowa': 'sp_k',
  'Sp. cywilna': 's_c',
  'Fundacja': 'fundacja',
  'Stowarzyszenie': 'stowarzyszenie',
  // ... więcej w razie potrzeby
}
```

Unit tests: 6 cases (Sp. z o.o., S.A., GmbH, JDG, unknown form → fallback to lower-case slug, missing metadata)

### S8 — Idempotency + upsert (1 h)

```typescript
export async function findExistingPartner(
  em: EntityManager,
  externalId: string,
  scope: Scope,
): Promise<CustomerEntity | null> {
  return em.findOne(CustomerEntity, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    metadata: { external_id: externalId },  // JSONB lookup
    deletedAt: null,
  })
}

export async function upsertPartner(
  em: EntityManager,
  source: ErpFromeeCompany,
  scope: Scope,
): Promise<{ entity: CustomerEntity; created: boolean }> {
  const existing = await findExistingPartner(em, source.id, scope)
  if (existing) {
    // Update fields from source (selective: only fields that erp-fromee owns)
    return { entity: applyUpdates(existing, source), created: false }
  }
  // Create fresh
  return { entity: createNewPartner(source, scope), created: true }
}
```

Unit tests: re-run idempotency, conflict detection (entity exists ale ma inne external_id)

### S9 — Audit pre-import (już mamy queries) (0 h, dokumentacja)

Reusing queries z [audytu Tygodnia 1](analysis/ANALYSIS-2026-05-03-import-readiness-erp-fromee.md) — duplikaty NIP/primary contact/primary address.

Skrypt importu wykonuje audit przed startem i raportuje konflikty. Jeśli > 0 duplikatów → prosi o resolve manual w erp-fromee przed `--commit`.

### S10 — CLI command (0.5 h)

```bash
yarn mercato sync-erp-fromee customers --dry-run [--tenant=UUID] [--org=UUID]
yarn mercato sync-erp-fromee customers --commit [--tenant=UUID] [--org=UUID]
```

Output (dry-run):
```
🚀 ERP-fromee customers import (dry-run)

📊 Source data:
  Company total: 1140
  Filtered (CUSTOMER + PROSPECT): 200 (200 CUSTOMER + 0 PROSPECT)
  Skipped INTERNAL: 0
  
📋 Pre-import audit:
  ✅ NIP duplicates: 0
  ✅ Primary contact duplicates: 3 companies (auto-resolve: keep first)
  ✅ Primary address duplicates: 0
  
📥 Mapping plan:
  customer_entities: 200 (199 company + 1 person)
  customer_companies: 199 (198 ORG + 1 JDG)
  customer_people: 1 (B2C)
  customer_tax_identities: 187 NIP + 51 KRS = 238 rows
  customer_addresses: 78 (per address_type)
  customer_people (contacts): 65 (with 4 isPrimary)
  customer_person_company_links: 65
  customer_company_billing: 18 (with bank info)
  customer_entity_roles: 200 (CUSTOMER) + 0 (PROSPECT)

⚠️ Warnings:
  - 1 PERSON without NIP marked manual_review (Test User Demo, ID: cuid_xyz)
  - 3 unmapped legalForm values: 'Sp.j.' (4 occurrences)
  - 0 conflicts requiring user intervention

⏱️ Estimated commit time: ~30s
🚀 Run with --commit to execute
```

### S11 — Integration test (2 h)

`__integration__/TC-IMPORT-001-erp-fromee-customers.spec.ts`:
- Setup: seeded erp-fromee fixtures + clean openm DB
- Run: `await runImport({ dryRun: true })` → verify counts
- Run: `await runImport({ commit: true })` → verify rows w openm
- Re-run: idempotent (no new rows, no errors)
- Verify: tax_identities count, billing pre-fill chain, entity_roles multi-role

## Files to touch

| Path | Action |
|---|---|
| `apps/mercato/src/modules/sync_erp_fromee/index.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/di.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/erpFromeeAdapter.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/mappers/{companyToPartner,taxIdentities,roles,contacts,addresses,billing,metadata,audit}.ts` | NEW (8 plików) |
| `apps/mercato/src/modules/sync_erp_fromee/lib/{importPipeline,reportFormatter,idempotency}.ts` | NEW (3 pliki) |
| `apps/mercato/src/modules/sync_erp_fromee/cli/import-customers.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/__tests__/mappers/*.test.ts` | NEW (8 plików unit testów) |
| `apps/mercato/src/modules/sync_erp_fromee/__integration__/TC-IMPORT-001-erp-fromee-customers.spec.ts` | NEW |
| `apps/mercato/src/modules.ts` | + entry dla `sync_erp_fromee` |
| `apps/mercato/.env.example` | + `ERP_FROMEE_DATABASE_URL` |

NO migration changes (używamy istniejących encji).

## Backward compatibility

Nowy moduł — całkowicie additive. Istniejące tabele customer_* nie modyfikowane. Skrypt jest one-time CLI, nie zmienia runtime behavior'u.

## Validation gate

```bash
yarn build:packages
yarn typecheck
yarn jest apps/mercato/src/modules/sync_erp_fromee/
yarn ts-node apps/mercato/src/modules/sync_erp_fromee/cli/import-customers.ts --dry-run
# Expected output: success report z 200 partners
```

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| I.1 | erp-fromee schema change w trakcie importu | Low | Pin schema snapshot przy starcie, fail fast jeśli mismatch |
| I.2 | Duplicate NIP w erp-fromee → narusza unique index | Medium | Pre-import audit (S9); fail jeśli >0 duplikatów |
| I.3 | Multiple primary contacts/addresses w jednej firmie | Low | First-wins handling w mapper; warning w report |
| I.4 | unmapped `legalForm` values | Low | Default fallback to lower-case slug; warning |
| I.5 | erp-fromee timeout na big query | Low | Batch'owanie po 100 firm |
| I.6 | Customer w erp-fromee linkowany do INTERNAL company | Low | Skip INTERNAL filter (D4) |
| I.7 | Encryption mismatch — customer ma kind=person + tax_identity z encryption flag, ale skrypt pisze w plain | Medium | Use `findOneWithDecryption` + `persist...withEncryption` per Phase 1 pattern |

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Module setup + adapter (3 h)

- [ ] 1.1 NEW `sync_erp_fromee/index.ts` + module metadata
- [ ] 1.2 NEW `lib/erpFromeeAdapter.ts` z connection do erp-fromee Postgres
- [ ] 1.3 ENV variable docs
- [ ] 1.4 Module registration w `apps/mercato/src/modules.ts`

### Phase 2: Mappers (10 h)

- [ ] 2.1 `companyToPartner.ts` (4 h) + unit tests
- [ ] 2.2 `taxIdentities.ts` (1 h) + unit tests
- [ ] 2.3 `roles.ts` (1 h) + unit tests
- [ ] 2.4 `contacts.ts` (2 h) + unit tests
- [ ] 2.5 `addresses.ts` (1 h) + unit tests
- [ ] 2.6 `billing.ts` (1 h) + unit tests
- [ ] 2.7 `metadata.ts` (1 h) + unit tests
- [ ] 2.8 `idempotency.ts` (1 h) + unit tests

### Phase 3: Pipeline + CLI (2 h)

- [ ] 3.1 `importPipeline.ts` orkiestracja
- [ ] 3.2 `reportFormatter.ts`
- [ ] 3.3 `cli/import-customers.ts` + yarn integration

### Phase 4: Integration test + polish (2 h)

- [ ] 4.1 NEW TC-IMPORT-001 integration test
- [ ] 4.2 Dry-run weryfikacja na real erp-fromee data
- [ ] 4.3 Commit run weryfikacja w isolated test tenant
- [ ] 4.4 Idempotency test (re-run = 0 zmian)

### Phase 5: Validation gate + PR (1 h)

- [ ] 5.1 yarn build:packages + typecheck + tests
- [ ] 5.2 Open PR (base = develop)
- [ ] 5.3 Apply labels: review, feature, needs-qa

## Changelog

- 2026-05-03 — Initial spec created (Kuba74). Decyzje D1-D4 ratified. ~15 h estimate. Independent of Tydzień 2 (może iść w parallel).
