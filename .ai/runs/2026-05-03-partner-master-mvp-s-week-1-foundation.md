# Run Plan — Partner Master MVP-S Week 1 Foundation

**Status:** in-progress (validation gate blocked by sandbox; reviewer to rerun locally)
**Created:** 2026-05-03
**Author:** Kuba74 (auto-create-pr)
**Source spec:** [.ai/specs/2026-05-03-mvp-s-week-1-partner-foundation.md](../specs/2026-05-03-mvp-s-week-1-partner-foundation.md) — lives on `origin/docs/partner-master-migration-spec`, not on the base branch
**Parent spec:** [.ai/specs/2026-05-03-partner-master-migration.md](../specs/2026-05-03-partner-master-migration.md) — same source branch
**Base branch:** `feat/partner-master-phase-1-tax-identity` (PR #1, in review)
**Branch:** `feat/partner-master-mvp-s-week-1-foundation`
**PR title:** `feat(customers): MVP-S Week 1 — partner foundation lifecycle stages + JDG reclassification`

## Goal

Deliver the achievable subset of MVP-S Week 1 partner foundation work that is buildable on top of the Phase 1 tax identity branch:

1. Seed five new lifecycle stage dictionary entries (`supplier`, `partner`, `carrier`, `internal`, `other`) so sales filters/selectors can branch on them later.
2. Provide an idempotent `reclassifyJdgEntities` helper that flips synced `kind=person` entities with a NIP into `kind=company` + `customer_companies.legal_form='jdg'`, and register it as a tenant-scoped upgrade action (the JDG concept is established by PR #1's `customer_tax_identities` table + `customer_companies.legal_form`).

## Scope reduction vs. the source spec

The source spec [mvp-s-week-1-partner-foundation.md](../specs/2026-05-03-mvp-s-week-1-partner-foundation.md) lists six stories. Three of them touch entities that do **not yet exist** on the chosen base branch (`feat/partner-master-phase-1-tax-identity`):

| Source-spec story | Status on base branch | Decision |
|---|---|---|
| S1.1 — `getSalesCustomers()` helper | `customer_entity_roles` table missing | Defer (master spec Phase 2) |
| S1.2 — Lifecycle stage seeds | Dictionary infra in place | **In scope** |
| S1.3 — `customer_company_billing` extensions | `customer_company_billing` table missing | Defer (master spec Phase 4) |
| S1.4 — Primary contact uniqueness | `customer_person_company_links` table missing | Defer (master spec Phase 4) |
| S1.5 — Primary address uniqueness | `customer_addresses` lacks `address_type` and `deleted_at` columns | Defer (master spec Phase 4) |
| S1.6 — JDG reclassification | `customer_tax_identities` and `customer_companies.legal_form` exist | **In scope** |

Creating the missing entities here would multiply the PR's surface area well beyond Week 1's brief and would conflict with master-spec Phase 4 by pre-empting its data model. The deferred work is restated in the PR body so the human reviewer can decide whether to fold them into a follow-up before MVP-S close or push them to their natural Phase 4 home.

## Implementation Plan

### Phase 1 — Lifecycle stage dictionary defaults

Augment `ENTITY_LIFECYCLE_STAGE_DEFAULTS` in `packages/core/src/modules/customers/cli.ts` with the five new entries (`supplier`, `partner`, `carrier`, `internal`, `other`). The existing `seedCustomerDictionaries` already iterates the defaults via the idempotent `ensureDictionaryEntry`, so `setup.ts` re-runs (initial onboarding + manual reseed) will pick these up automatically — no `setup.ts` edits required.

Translatable labels: existing dictionary entries use the static `label` field on the default object; lifecycle-stage values are not currently localized via `i18n/*.json`. To stay minimal and consistent with the existing five entries (Prospect/Evaluation/Customer/Expansion/Churned) we use the same shape — no new i18n keys for the dictionary labels themselves. (If future UI introduces `dictionary.values.lifecycle.<value>` keys, this PR will not be the place to bootstrap them.)

### Phase 2 — JDG reclassification helper + upgrade action

Add `packages/core/src/modules/customers/lib/jdgClassification.ts` exporting `reclassifyJdgEntities(em, scope)`. Behaviour:

- Iterate `customer_entities` rows where `kind = 'person'`, scoped by `(organizationId, tenantId)`, not soft-deleted.
- Skip when no PL `NIP` row exists in `customer_tax_identities` for the entity (`reason: 'no-nip'`).
- Skip when a `customer_companies` row already exists for the entity (`reason: 'already-company'`) — idempotency guard.
- Otherwise update the entity's `kind` to `company` and create a `customer_companies` row with `legal_form='jdg'`.
- Return `{ considered, reclassified, skipped, details }`.

Register the upgrade action in `packages/core/src/modules/configs/lib/upgrade-actions.ts` using the existing `upgradeActions` array (currently empty). The registration uses the action wiring already shipped with the configs module:

```ts
upgradeActions.push({
  id: 'customers.jdg-reclassification',
  version: '0.6.0',
  messageKey: 'customers.upgrade.jdgReclassification.message',
  ctaKey: 'customers.upgrade.jdgReclassification.cta',
  successKey: 'customers.upgrade.jdgReclassification.success',
  loadingKey: 'customers.upgrade.jdgReclassification.loading',
  run: (ctx) => reclassifyJdgEntities(ctx.em, ...).then(() => undefined),
})
```

Add the four i18n keys (`customers.upgrade.jdgReclassification.{message,cta,success,loading}`) to `i18n/{pl,en,de,es}.json`.

Unit tests in `packages/core/src/modules/customers/lib/__tests__/jdgClassification.test.ts` mock the EM with a thin in-memory store and cover:

- A `kind=person` entity with a PL NIP gets reclassified (kind flipped, company row created with `legal_form='jdg'`).
- A run twice over the same dataset is idempotent (second pass reports zero reclassifications).
- An entity without a NIP is skipped (`reason: 'no-nip'`).
- An entity that already has a `customer_companies` row is skipped (`reason: 'already-company'`).
- Tenant scoping prevents cross-tenant reclassification.

### Phase 3 — Validation gate + PR

Run the achievable parts of the validation gate (`yarn build:packages`, `yarn typecheck`, `yarn test`, `yarn i18n:check-sync`). Sandbox restrictions may block some commands — the run captures pass/fail/blocked status in the PR body so the reviewer can rerun locally. `yarn db:generate` is **not** run (no DB schema changes in this PR).

Open the PR against `feat/partner-master-phase-1-tax-identity` (stacked PR, NOT develop), title `feat(customers): MVP-S Week 1 — partner foundation lifecycle stages + JDG reclassification`. Apply labels `review`, `feature`, `needs-qa`.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Source spec assumes entities that do not exist on base branch | High | Scope reduction documented above; deferred items called out in the PR body. |
| `upgradeActions` array currently empty — first registered action might surface ordering bugs in the loader | Low | Loader uses semver compare + id alphabetic sort; well-covered by existing `__tests__/upgrade-actions.test.ts`. |
| `reclassifyJdgEntities` flipping `kind` + creating a company row in two `em.persist`+`flush` calls could leak partial state on failure | Low | Wrap mutations in `withAtomicFlush(em, [...], { transaction: true })` per `packages/core/AGENTS.md` rules. |
| Cross-tenant reclassification | Critical | Helper takes `{ organizationId, tenantId }` scope; tested explicitly in unit tests. |

## Backward compatibility

Purely additive:

- 5 new lifecycle stage dictionary entries (additive seed values; idempotent).
- 1 new helper (no public API rename or removal).
- 1 new upgrade action registered in the previously-empty array.
- 4 new i18n keys (no rename).

No contract surface (per `BACKWARD_COMPATIBILITY.md`) is broken.

## External References

None — this run honours the brief from `auto-create-pr` and the source spec; no `--skill-url` was supplied.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Lifecycle stage dictionary defaults

- [x] 1.1 Add `supplier`, `partner`, `carrier`, `internal`, `other` to `ENTITY_LIFECYCLE_STAGE_DEFAULTS` — 99c6f7e16
- [x] 1.2 Confirm `seedCustomerDictionaries` is idempotent across a re-run (manual diff) — 99c6f7e16

### Phase 2: JDG reclassification helper + upgrade action

- [x] 2.1 `reclassifyJdgEntities` helper at `packages/core/src/modules/customers/lib/jdgClassification.ts` — ccf243772
- [x] 2.2 Unit tests in `packages/core/src/modules/customers/lib/__tests__/jdgClassification.test.ts` — ccf243772
- [x] 2.3 Upgrade action registration via `packages/core/src/modules/customers/upgrade-actions.ts` (side-effect import from `customers/index.ts`) — ccf243772
- [x] 2.4 i18n keys for the upgrade action in `i18n/{pl,en,de,es}.json` — ccf243772

### Phase 3: Validation gate + PR

- [x] 3.1 Run `yarn build:packages`, `yarn typecheck`, `yarn test`, `yarn i18n:check-sync` — **BLOCKED by sandbox**; reviewer MUST rerun locally
- [x] 3.2 Open the stacked PR against `feat/partner-master-phase-1-tax-identity` — PR #3
- [x] 3.3 Apply labels: `review`, `feature`, `needs-qa` — done

## Changelog

- 2026-05-03 — Initial plan drafted (auto-create-pr). Scope reduced to S1.2 + S1.6 of the source spec; rationale captured above.
- 2026-05-03 — PR #3 opened against `feat/partner-master-phase-1-tax-identity`. Validation gate **blocked by sandbox**; reviewer MUST rerun `yarn typecheck`, `yarn test`, `yarn i18n:check-sync`, `yarn build:packages` locally before merge.
