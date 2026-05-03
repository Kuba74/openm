# MVP-S Week 1 — Partner Foundation

**Status:** Draft (Phase 1 already in PR #1)
**Created:** 2026-05-03
**Target window:** 29.04 – 05.05.2026 (Week 1 of May MVP-S, ~2 days remaining)
**Author:** Kuba74
**Parent spec:** [2026-05-03-partner-master-migration.md](2026-05-03-partner-master-migration.md)
**Estimated:** ~20 h (down from 40 h originally — most of the work is in PR #1)

## TLDR

Week 1 closes the partner foundation needed for the May MVP. PR #1 ([partner-master-phase-1-tax-identity](https://github.com/Kuba74/openm/pull/1)) covers tax identities, JDG support, custom fields, validators, and UI. This Week-1 spec covers the remaining 6 stories: helper services for sales-customer filtering, primary contact/address uniqueness invariants, additional sales-side properties on `customer_company_billing`, dictionary seeds for `prospect`/`supplier`/`partner`/`carrier` lifecycle stages, and the JDG reclassification migration for the 70 PERSON-with-NIP rows that will arrive in Phase 3 sync.

## Overview

Per the parent spec's ADR-7 (May MVP in openm) and ADR-4 (re-prioritization 1 → MVP-S → 2 → ...), Week 1 establishes the partner master foundation. After PR #1 lands and Week 1 wraps, all subsequent MVP-S weeks build on top:
- Week 2 — Sales catalog wiring (PL VAT/units/numbering/currency)
- Week 3 — Sales quotes UI audit + customer→quote pre-fill
- Week 4 — Quote lines + calculation polish
- Week 5 — PDF + sync + demo

## Stories in scope

### S1.1 — `getSalesCustomers()` helper

**Goal:** filter `customer_entities` to those with an active `customer` role for sales selectors.

**Implementation:**

```typescript
// packages/core/src/modules/customers/lib/salesCustomers.ts
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity, CustomerEntityRole } from '../data/entities'

export type SalesCustomerScope = {
  organizationId: string
  tenantId: string
  includeProspects?: boolean        // default false
}

export async function getSalesCustomers(
  em: EntityManager,
  scope: SalesCustomerScope,
): Promise<CustomerEntity[]> {
  const acceptedRoles = scope.includeProspects ? ['customer', 'prospect'] : ['customer']

  return em.find(CustomerEntity, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
    entityRoles: {
      roleType: { $in: acceptedRoles },
      deletedAt: null,
    },
  }, { populate: ['entityRoles'] })
}

export async function isSalesCustomer(
  em: EntityManager,
  entityId: string,
  scope: { organizationId: string; tenantId: string; includeProspects?: boolean },
): Promise<boolean> {
  const acceptedRoles = scope.includeProspects ? ['customer', 'prospect'] : ['customer']
  const role = await em.findOne(CustomerEntityRole, {
    entityId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    roleType: { $in: acceptedRoles },
    deletedAt: null,
  })
  return role !== null
}
```

**Acceptance:**
- Helper returns only entities with `customer` role (or `customer + prospect` when `includeProspects=true`)
- Soft-deleted roles are excluded
- Multi-tenant scoping enforced
- Unit tests in `lib/__tests__/salesCustomers.test.ts`

**Estimate:** 3 h

### S1.2 — Add `prospect`, `supplier`, `partner`, `carrier`, `internal` to lifecycle_stage defaults

**Goal:** seed dictionary entries for the new lifecycle stages used by sales selectors.

**Implementation:**

```typescript
// packages/core/src/modules/customers/cli.ts
const ENTITY_LIFECYCLE_STAGE_DEFAULTS: DictionaryDefault[] = [
  { value: 'lead', label: 'Lead', color: '#3b82f6', icon: 'lucide:sparkles' },
  { value: 'prospect', label: 'Prospect', color: '#8b5cf6', icon: 'lucide:eye' },
  { value: 'customer', label: 'Customer', color: '#22c55e', icon: 'lucide:handshake' },
  { value: 'subscriber', label: 'Subscriber', color: '#10b981', icon: 'lucide:bell' },
  { value: 'churned', label: 'Churned', color: '#ef4444', icon: 'lucide:user-x' },
  // NEW
  { value: 'supplier', label: 'Supplier', color: '#0ea5e9', icon: 'lucide:truck' },
  { value: 'partner', label: 'Partner', color: '#a855f7', icon: 'lucide:link' },
  { value: 'carrier', label: 'Carrier', color: '#f97316', icon: 'lucide:package' },
  { value: 'internal', label: 'Internal', color: '#64748b', icon: 'lucide:building' },
  { value: 'other', label: 'Other', color: '#94a3b8', icon: 'lucide:circle' },
]
```

These are also seeded as default `customer_entity_role` types via `customer_dictionary_kind_settings`.

**Acceptance:**
- New tenants seed all 10 lifecycle_stage entries via `setup.ts`
- Existing tenants pick up new entries on next `seedCustomerDictionaries` run (idempotent)
- UI shows the new stages in filter dropdowns
- Translation keys added to `i18n/{pl,en,de,es}.json`

**Estimate:** 2 h

### S1.3 — Sales-side properties on `customer_company_billing`

**Goal:** add `salesOwnerId` and `defaultOfferValidityDays` so quotes can pre-fill from customer.

**Status:** existing `customer_company_billing` already has `paymentTerms` + `preferredCurrency`. Need to add 2 columns.

**Migration (entity changes only — `yarn db:generate` produces SQL):**

```typescript
// packages/core/src/modules/customers/data/entities.ts (CustomerCompanyBilling)
@Property({ name: 'sales_owner_user_id', type: 'uuid', nullable: true })
salesOwnerUserId?: string | null

@Property({ name: 'default_offer_validity_days', type: 'int', nullable: true, default: 30 })
defaultOfferValidityDays?: number | null
```

**UI surfaces:**
- New section "Sprzedaż" in `customer_company_profile` widget (uses existing `customer_company_billing` 1:1)
- Selector dla `salesOwnerUserId` from `staff` module assignable users API
- Number input for `defaultOfferValidityDays` (default 30)

**Acceptance:**
- Both columns nullable, additive (no BC break)
- Default 30 for new rows
- UI section renders, saves, retrieves correctly
- `getDefaultOfferValidityDays(companyId)` helper returns billing.defaultOfferValidityDays ?? 30
- `getSalesOwner(companyId)` helper returns billing.salesOwnerUserId or null

**Estimate:** 5 h

### S1.4 — Primary contact uniqueness + helper

**Goal:** enforce "max one primary person per company" at DB level.

**Status:** `customer_person_company_links.is_primary: boolean` already exists but no uniqueness constraint.

**Migration:**

```sql
CREATE UNIQUE INDEX customer_person_company_links_primary_per_company_idx
  ON customer_person_company_links (company_entity_id)
  WHERE is_primary = true AND deleted_at IS NULL;
```

(Generated via entity decorator update — see entity edit below.)

**Entity update:**

```typescript
// packages/core/src/modules/customers/data/entities.ts (CustomerPersonCompanyLink)
@Index({
  name: 'customer_person_company_links_primary_per_company_idx',
  expression:
    `create unique index "customer_person_company_links_primary_per_company_idx" on "customer_person_company_links" ("company_entity_id") where "is_primary" = true and "deleted_at" is null`,
})
```

**Helper:**

```typescript
// packages/core/src/modules/customers/lib/primaryContact.ts
export async function getPrimaryContact(
  em: EntityManager,
  companyId: string,
  scope: { organizationId: string; tenantId: string },
): Promise<CustomerPerson | null> {
  const link = await em.findOne(CustomerPersonCompanyLink, {
    company: companyId,
    isPrimary: true,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  }, { populate: ['person'] })
  return link?.person ?? null
}
```

**Pre-migration data audit:**

```sql
-- Find companies with multiple primary contacts (must resolve before migration)
SELECT company_entity_id, count(*)
FROM customer_person_company_links
WHERE is_primary = true AND deleted_at IS NULL
GROUP BY company_entity_id
HAVING count(*) > 1;
```

If any rows surface, the migration is preceded by a one-off data-fix script that keeps the most recently updated link as primary.

**Acceptance:**
- DB rejects second `is_primary=true` for same company (FK constraint test)
- Helper returns the primary person or null
- Promoting another link to primary auto-demotes the previous one (handled by command, not DB)
- Test: `TC-PARTNER-W1-PrimaryContact.spec.ts`

**Estimate:** 4 h

### S1.5 — Primary address uniqueness per type + helper

**Goal:** enforce "max one primary address per (entity, address_type) at DB level". Companies should be able to mark one billing address, one shipping address, etc. as primary — but not two billing primaries.

**Status:** `customer_addresses.is_primary: boolean` exists but no uniqueness constraint.

**Entity update:**

```typescript
// packages/core/src/modules/customers/data/entities.ts (CustomerAddress)
@Index({
  name: 'customer_addresses_primary_per_type_idx',
  expression:
    `create unique index "customer_addresses_primary_per_type_idx" on "customer_addresses" ("entity_id", "address_type") where "is_primary" = true and "deleted_at" is null`,
})
```

**Helper:**

```typescript
// packages/core/src/modules/customers/lib/primaryAddress.ts
export type PrimaryAddressKind = 'billing' | 'shipping' | 'office' | 'home' | 'work'

export async function getDefaultOfferAddress(
  em: EntityManager,
  entityId: string,
  scope: { organizationId: string; tenantId: string },
  preferred: PrimaryAddressKind = 'billing',
): Promise<CustomerAddress | null> {
  // Try preferred kind first, fall back to any primary, then any
  const fallbackOrder: PrimaryAddressKind[] = [preferred, 'billing', 'office', 'work', 'home', 'shipping']
  for (const kind of fallbackOrder) {
    const address = await em.findOne(CustomerAddress, {
      entityId,
      addressType: kind,
      isPrimary: true,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (address) return address
  }
  return null
}
```

**Pre-migration data audit:**

```sql
SELECT entity_id, address_type, count(*)
FROM customer_addresses
WHERE is_primary = true AND deleted_at IS NULL
GROUP BY entity_id, address_type
HAVING count(*) > 1;
```

**Acceptance:**
- DB rejects second `is_primary=true` for same (entity, address_type)
- Helper returns billing→fallback chain
- Test: `TC-PARTNER-W1-PrimaryAddress.spec.ts`

**Estimate:** 4 h

### S1.6 — JDG reclassification migration (deferred from Phase 1 PR #1)

**Goal:** prepare the openm-side migration logic so that when Phase 3 sync inbound runs, the 70 erp-fromee PERSON-with-NIP rows are correctly classified as `kind=company + legal_form=jdg`.

**Note:** No erp-fromee data is touched in this Week 1 PR. The reclassification logic lives in the **sync mapper** (Phase 3) and the openm-side **upgrade action** for any tenants that have already imported.

**Implementation:**

```typescript
// packages/core/src/modules/customers/lib/jdgClassification.ts
export type JdgReclassResult = {
  considered: number
  reclassified: number
  skipped: number
  details: Array<{ entityId: string; reason: 'no-nip' | 'reclassified' | 'already-company' }>
}

/**
 * Reclassifies entities that came in as kind=person but have a NIP
 * (likely JDG sole proprietors). Sets kind=company and stamps
 * legal_form=jdg on the customer_companies row.
 */
export async function reclassifyJdgEntities(
  em: EntityManager,
  scope: { organizationId: string; tenantId: string },
): Promise<JdgReclassResult> {
  // Implementation: iterate customer_entities where kind='person' AND
  // has a customer_tax_identities row with kind='NIP' AND no
  // customer_companies row exists yet. For each, switch kind, create
  // customer_companies row with legal_form='jdg'.
}
```

**Upgrade action:**

```typescript
// packages/core/src/modules/configs/lib/upgrade-actions.ts
{
  version: '0.X.0',
  id: 'customers.jdg-reclassification',
  description: 'Reclassify person entities with NIP as JDG companies',
  guard: 'customers.tax_identities.manage',
  async run(ctx) {
    return reclassifyJdgEntities(ctx.em, { organizationId: ctx.organizationId, tenantId: ctx.tenantId })
  },
}
```

**Acceptance:**
- Helper compiles, has unit tests with mocked entities
- Upgrade action registered, idempotent
- No data migration runs in this PR (idempotent helper only — actual run happens after Phase 3 sync)

**Estimate:** 2 h

## Files touched (estimate)

| Path | Action |
|---|---|
| `packages/core/src/modules/customers/data/entities.ts` | + 2 columns on `CustomerCompanyBilling`, + 2 indexes (CustomerPersonCompanyLink, CustomerAddress) |
| `packages/core/src/modules/customers/lib/salesCustomers.ts` | NEW |
| `packages/core/src/modules/customers/lib/primaryContact.ts` | NEW |
| `packages/core/src/modules/customers/lib/primaryAddress.ts` | NEW |
| `packages/core/src/modules/customers/lib/jdgClassification.ts` | NEW |
| `packages/core/src/modules/customers/cli.ts` | + 5 lifecycle_stage defaults |
| `packages/core/src/modules/customers/setup.ts` | re-trigger seed on existing tenants |
| `packages/core/src/modules/configs/lib/upgrade-actions.ts` | + JDG reclass action |
| `packages/core/src/modules/customers/i18n/{pl,en,de,es}.json` | + 5 lifecycle_stage labels |
| `packages/core/src/modules/customers/migrations/MigrationYYYYMMDDHHMMSS.ts` | generated |
| `packages/core/src/modules/customers/__tests__/salesCustomers.test.ts` | NEW |
| `packages/core/src/modules/customers/__tests__/primaryContact.test.ts` | NEW |
| `packages/core/src/modules/customers/__tests__/primaryAddress.test.ts` | NEW |
| `packages/core/src/modules/customers/__tests__/jdgClassification.test.ts` | NEW |
| `packages/core/src/modules/customers/__integration__/TC-PARTNER-W1-PrimaryContact.spec.ts` | NEW |
| `packages/core/src/modules/customers/__integration__/TC-PARTNER-W1-PrimaryAddress.spec.ts` | NEW |

## Dependencies

- **PR #1** ([Phase 1 partner master](https://github.com/Kuba74/openm/pull/1)) MUST be merged before this PR opens. It introduces `customer_tax_identities` and the JDG concept that S1.6 builds on.
- No other module dependencies.

## Backward compatibility

All changes are **additive**:

- New entity columns are nullable
- New indexes are partial (`WHERE is_primary = true`)
- New library helpers (no rename of existing functions)
- New dictionary entries (no rename of existing values)
- New i18n keys (no rename of existing keys)

Per `BACKWARD_COMPATIBILITY.md` no contract surface broken.

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| W1.1 | Existing tenants have multiple primary contacts/addresses violating new unique index | Medium | Pre-migration audit query; one-off data-fix script keeps most-recent as primary |
| W1.2 | `salesOwnerUserId` references `auth.users.id` but FK not declared (cross-module link via DSL) | Low | Use `defineLink(entityId('customers:company_billing'), linkable('auth:user'))` in `data/extensions.ts` |
| W1.3 | JDG reclass logic might accidentally double-create company rows for synced entities | Medium | Idempotent guard: skip if `customer_companies` row already exists for entity |
| W1.4 | Week 1 deadline already partially missed (29.04 → 03.05 done) | Low | This spec is 20 h; possible to finish by 05.05 EOD with focused execution |

## Validation gate (mandatory before PR)

```bash
yarn build:packages
yarn generate
yarn db:generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
```

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Helpers + dictionaries (8 h)

- [ ] 1.1 `getSalesCustomers()` + `isSalesCustomer()` helpers
- [ ] 1.2 Unit tests for sales customers helpers
- [ ] 1.3 Add `prospect/supplier/partner/carrier/internal/other` to `ENTITY_LIFECYCLE_STAGE_DEFAULTS`
- [ ] 1.4 i18n keys for new lifecycle stages
- [ ] 1.5 Re-trigger seed on existing tenants via `setup.ts` idempotent path

### Phase 2: customer_company_billing extensions (5 h)

- [ ] 2.1 Add `salesOwnerUserId` + `defaultOfferValidityDays` columns
- [ ] 2.2 `defineLink` in `data/extensions.ts` to `auth:user`
- [ ] 2.3 UI section "Sprzedaż" in company profile widget
- [ ] 2.4 Helpers `getSalesOwner()` + `getDefaultOfferValidityDays()`
- [ ] 2.5 Unit tests

### Phase 3: Primary uniqueness invariants (8 h)

- [ ] 3.1 Pre-migration audit query for primary contact duplicates
- [ ] 3.2 Pre-migration audit query for primary address duplicates
- [ ] 3.3 Partial unique index on `customer_person_company_links`
- [ ] 3.4 Partial unique index on `customer_addresses`
- [ ] 3.5 `getPrimaryContact()` helper + unit tests
- [ ] 3.6 `getDefaultOfferAddress()` helper + unit tests
- [ ] 3.7 Integration tests TC-PARTNER-W1-PrimaryContact + TC-PARTNER-W1-PrimaryAddress

### Phase 4: JDG reclassification logic (2 h)

- [ ] 4.1 `reclassifyJdgEntities()` helper
- [ ] 4.2 Unit tests
- [ ] 4.3 Upgrade action registration

### Phase 5: Validation gate + PR (1 h)

- [ ] 5.1 Run full validation gate locally
- [ ] 5.2 Open PR against develop
- [ ] 5.3 Apply labels: `review`, `feature`, `needs-qa`

## Changelog

- 2026-05-03 — Initial spec created (Kuba74). Estimated 20 h for ~6 stories. Depends on PR #1 merge.
