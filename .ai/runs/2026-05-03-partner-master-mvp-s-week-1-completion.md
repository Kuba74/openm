# Run Plan — Partner Master MVP-S Week 1 Completion

**Status:** in-progress
**Created:** 2026-05-03
**Author:** Kuba74 (auto-create-pr)
**Source spec:** `.ai/specs/2026-05-03-mvp-s-week-1-partner-foundation.md` — lives on `origin/docs/partner-master-migration-spec`
**Sibling run:** `.ai/runs/2026-05-03-partner-master-mvp-s-week-1-foundation.md` — PR #3, delivered S1.2 + S1.6
**Base branch:** `feat/partner-master-mvp-s-week-1-foundation` (PR #3 head — already on develop+phase1+S1.2+S1.6)
**PR target:** `develop`
**Branch:** `feat/partner-master-mvp-s-week-1-completion`
**PR title:** `feat(customers): MVP-S Tydzień 1 — uzupełnienie (helpery + uniqueness invariants)`

## Goal

Deliver the four stories deferred from PR #3 because the previous agent had based on a branch that lacked the customer entities introduced in `develop+phase1`:

- **S1.1** — `getSalesCustomers()` helper for sales-customer filtering via `customer_entity_roles`.
- **S1.3** — Sales-side properties on `customer_company_billing` (`salesOwnerUserId`, `defaultOfferValidityDays`) + helpers + UI section.
- **S1.4** — Primary contact uniqueness via partial unique index on `customer_person_company_links` + `getPrimaryContact()` helper + integration test.
- **S1.5** — Primary address uniqueness per `purpose` via partial unique index on `customer_addresses` + `getDefaultOfferAddress()` helper + integration test.

All stories are purely additive per `BACKWARD_COMPATIBILITY.md`.

## Scope notes

### Address `purpose` vs `address_type`

The brief assumed `customer_addresses` already had an `address_type` column. The actual codebase uses **`purpose`** consistently (e.g., `cli.ts` seeds `purpose: 'office'` / `'work'`, `dictionaries/context.ts` maps `address-types` to `purpose`, `commands/addresses.ts` operates on `purpose`). To stay additive and avoid a breaking rename, this PR scopes the partial unique index to `(entity_id, purpose) WHERE is_primary = true` and adds a sibling **`deleted_at` column** so the index can include `deleted_at IS NULL` (matching the spec's intent of soft-delete-aware uniqueness). The helper is named `getDefaultOfferAddress()` and treats `purpose` as the address-kind discriminator.

### S1.5 — schema deltas required by index

The Phase 1 PR did not add `deleted_at` to `customer_addresses`. To make the partial unique index survive soft deletes, this PR adds:
- `customer_addresses.deleted_at` (nullable timestamp) — additive, matches every other soft-deletable customer table.

The index uses `WHERE is_primary = true AND deleted_at IS NULL` for symmetry with the person-company link index.

### S1.3 — UI minimalism

Per `customers/AGENTS.md`, the company profile widget injection slot is `crud-form:customers:customer_company_profile:fields`. The new "Sprzedaż" section is added by registering a fresh injection widget alongside the existing `tax-identities` widget. The widget reads/writes only the two new billing columns and uses an existing assignable-users API (`/api/auth/users`) for the owner picker. Number input clamped 1–365 with default 30.

### Test boundaries

- Unit tests use the same in-memory mock pattern as `jdgClassification.test.ts`.
- Integration tests follow `__integration__/TC-CRM-*.spec.ts` naming and expectations.

## Implementation Plan

### Phase 1 — S1.1 helpers (`getSalesCustomers` + `isSalesCustomer`)

- 1.1 Add `lib/salesCustomers.ts` — exports `SalesCustomerScope`, `getSalesCustomers`, `isSalesCustomer`. Uses `findWithDecryption` / `findOneWithDecryption` for tenant isolation.
- 1.2 Unit tests in `lib/__tests__/salesCustomers.test.ts` covering: empty result, customer-only, prospect inclusion, soft-deleted role exclusion, multi-tenant isolation.

### Phase 2 — S1.3 billing properties + helpers + UI

- 2.1 Extend `CustomerCompanyBilling` with `salesOwnerUserId` (uuid, nullable) and `defaultOfferValidityDays` (int, nullable, default 30).
- 2.2 Create `data/extensions.ts` exporting `defineLink(entityId('customers','company_billing'), entityId('auth','user'), …)` for the cross-module link.
- 2.3 Add `lib/companyBilling.ts` with `getSalesOwner` and `getDefaultOfferValidityDays` (default 30 fallback).
- 2.4 Unit tests in `lib/__tests__/companyBilling.test.ts`.
- 2.5 New widget `widgets/injection/sales/widget.{ts,client.tsx}` injected into `crud-form:customers:customer_company_profile:fields` (column 2, after tax identities). i18n keys for label, helper text, validation.

### Phase 3 — S1.4 primary contact uniqueness

- 3.1 Add partial unique index `customer_person_company_links_primary_per_company_idx` on `customer_person_company_links` via `@Index` expression.
- 3.2 Add `lib/primaryContact.ts` exporting `getPrimaryContact`.
- 3.3 Unit tests in `lib/__tests__/primaryContact.test.ts`.
- 3.4 Pre-migration data audit query documented in plan and PR body (DO NOT execute).
- 3.5 Integration test `__integration__/TC-PARTNER-W1-PrimaryContact.spec.ts` — exercises promoting a new primary, ensuring previous demoted, list-unique invariant.

```sql
SELECT company_entity_id, count(*)
FROM customer_person_company_links
WHERE is_primary = true AND deleted_at IS NULL
GROUP BY company_entity_id
HAVING count(*) > 1;
```

### Phase 4 — S1.5 primary address uniqueness per purpose

- 4.1 Add `deleted_at` column to `CustomerAddress`.
- 4.2 Add partial unique index `customer_addresses_primary_per_purpose_idx` on `customer_addresses (entity_id, purpose) WHERE is_primary = true AND deleted_at IS NULL` via `@Index` expression.
- 4.3 Add `lib/primaryAddress.ts` exporting `getDefaultOfferAddress`. Type alias `PrimaryAddressKind` covers the seeded purposes (`billing`, `shipping`, `office`, `home`, `work`).
- 4.4 Unit tests in `lib/__tests__/primaryAddress.test.ts`.
- 4.5 Pre-migration data audit query documented in plan and PR body (DO NOT execute).
- 4.6 Integration test `__integration__/TC-PARTNER-W1-PrimaryAddress.spec.ts`.

```sql
SELECT entity_id, purpose, count(*)
FROM customer_addresses
WHERE is_primary = true AND deleted_at IS NULL
GROUP BY entity_id, purpose
HAVING count(*) > 1;
```

### Phase 5 — i18n + Progress + validation gate + PR

- 5.1 Add new keys to `i18n/{en,pl,de,es}.json` for the Sales section UI.
- 5.2 Run targeted unit tests + the validation gate (sandbox-permitting). Document blocked steps for reviewer.
- 5.3 Open PR against `develop` with the labels `review`, `feature`, `needs-qa`. Include data-audit queries in PR body.

## Backward compatibility

Purely additive (per BACKWARD_COMPATIBILITY.md):

- New nullable columns (`sales_owner_user_id`, `default_offer_validity_days`, `customer_addresses.deleted_at`).
- New partial unique indexes (assume no duplicate-primary state — audit queries surface duplicates).
- New helpers (no rename or signature change).
- New i18n keys.
- New extension declaration (no rename).

No contract surface (per `BACKWARD_COMPATIBILITY.md`) is broken.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Existing tenants violate the new partial unique indexes | Medium | Pre-migration audit queries documented; reviewer must run + resolve before applying migrations. |
| `customer_addresses.purpose` is nullable, so multiple primaries with `purpose IS NULL` still slip the index | Low | Accepted — Postgres treats `(entity_id, NULL)` as distinct from `(entity_id, NULL)` only when one of the index cols is NULL. We document this in the helper / spec and rely on UI to require a `purpose` for primary addresses. |
| `getSalesCustomers` issues 1+N (roles → entities) instead of one query | Low | Acceptable for current call sites (selectors typically <50 records); future optimization can fold into a single QB join if hot-path warrants. |
| Sales widget UI overlaps tax-identities widget visually | Low | Use `priority: 200` (after tax identities at 150) and `column: 2`. Keep the section minimal (two fields + helper text). |
| Cross-module FK (billing.salesOwnerUserId → auth.users) declared via DSL only — no DB FK enforcement | Low | Aligns with the project's "NO direct ORM relationships between modules" rule. Enforced via `defineLink`. |

## External References

None — this run honours the brief and the source spec only.

## Validation gate

Best-effort, sandbox-aware. Each step is documented as PASS/BLOCKED:
- `yarn build:packages`
- `yarn typecheck`
- `yarn test`
- `yarn i18n:check-sync`
- `yarn i18n:check-usage`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: S1.1 helpers — `getSalesCustomers`

- [x] 1.1 `lib/salesCustomers.ts` exports `SalesCustomerScope`, `getSalesCustomers`, `isSalesCustomer` — 982c560f9
- [x] 1.2 Unit tests in `lib/__tests__/salesCustomers.test.ts` — 982c560f9

### Phase 2: S1.3 billing properties + helpers + UI

- [x] 2.1 Extend `CustomerCompanyBilling` with `salesOwnerUserId` and `defaultOfferValidityDays` — 258e4aaec
- [x] 2.2 Create `data/extensions.ts` with the `defineLink` to `auth:user` — 258e4aaec
- [x] 2.3 Add `lib/companyBilling.ts` with `getSalesOwner` + `getDefaultOfferValidityDays` — 258e4aaec
- [x] 2.4 Unit tests in `lib/__tests__/companyBilling.test.ts` — 258e4aaec
- [x] 2.5 New "Sprzedaż" injection widget for `crud-form:customers:customer_company_profile:fields` (+ GET/PATCH `/api/customers/companies/[id]/sales-billing`) — 258e4aaec

### Phase 3: S1.4 primary contact uniqueness

- [x] 3.1 Add partial unique index on `customer_person_company_links` — 8fa5093b6
- [x] 3.2 Add `lib/primaryContact.ts` with `getPrimaryContact` — 8fa5093b6
- [x] 3.3 Unit tests in `lib/__tests__/primaryContact.test.ts` — 8fa5093b6
- [x] 3.4 Integration test `__integration__/TC-PARTNER-W1-PrimaryContact.spec.ts` — 8fa5093b6

### Phase 4: S1.5 primary address uniqueness per purpose

- [x] 4.1 Add `deleted_at` to `CustomerAddress` — 74c98d7d6
- [x] 4.2 Add partial unique index on `customer_addresses` — 74c98d7d6
- [x] 4.3 Add `lib/primaryAddress.ts` with `getDefaultOfferAddress` — 74c98d7d6
- [x] 4.4 Unit tests in `lib/__tests__/primaryAddress.test.ts` — 74c98d7d6
- [x] 4.5 Integration test `__integration__/TC-PARTNER-W1-PrimaryAddress.spec.ts` — 74c98d7d6

### Phase 5: i18n + validation gate + PR

- [ ] 5.1 Add `customers.sales.*` i18n keys to `i18n/{en,pl,de,es}.json`
- [ ] 5.2 Run targeted validation gate (best-effort)
- [ ] 5.3 Open PR against `develop`; apply `review`, `feature`, `needs-qa`

## Changelog

- 2026-05-03 — Initial plan drafted (auto-create-pr). Scope = S1.1 + S1.3 + S1.4 + S1.5 (deferred from PR #3 because that branch lacked the develop+phase1 entities).
