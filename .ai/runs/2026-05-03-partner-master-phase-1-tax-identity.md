# Partner Master Phase 1 — Tax Identity Foundation

Source spec: brief supplied to `auto-create-pr` (the canonical spec at
`.ai/specs/2026-05-03-partner-master-migration.md` is not yet checked into
`develop`; the brief is the source of truth for this run).

## Goal

Land the additive Phase 1 schema + API + minimal UI for the partner master
migration: introduce a normalized `customer_tax_identities` table on the
`customers` module, extend `customer_companies` with three new optional
dictionary-backed columns (`legal_form`, `entity_type`, `full_address_krs`),
add zod validators with checksum logic for Polish tax IDs (NIP/REGON/KRS/PESEL)
and EU VAT, and expose CRUD over `/api/customers/companies/[id]/tax-identities`
with command-pattern undo support, encryption coverage, ACL features,
in-app dictionaries, an injection widget on the company detail page, and an
integration test covering create / list / duplicate-409 / soft-delete /
permission denial.

## Scope

- New table `customer_tax_identities` with composite unique partial index on
  `(country_code, kind, value)` where `deleted_at is null`.
- New columns on `customer_companies` (all nullable): `legal_form`,
  `entity_type`, `full_address_krs`.
- zod validators in `data/validators.ts` with full checksum logic for NIP,
  REGON (9/14), KRS, PESEL, and EU-VAT (per-country length).
- Tax-identity commands (create / update / delete) wired into
  `commands/index.ts` with snapshot-based undo, side effects, and tracked
  events.
- CRUD route at
  `api/companies/[id]/tax-identities/route.ts` (GET list / POST create) and
  `api/companies/[id]/tax-identities/[tid]/route.ts` (PATCH / DELETE) using
  `makeCrudRoute` with the indexer entity type
  `customers:customer_tax_identity` and a single OpenAPI export per file.
- ACL features `customers.tax_identities.view` and
  `customers.tax_identities.manage`, plus matching role grants in
  `setup.ts` (`admin`: full / `employee`: view).
- Three module events (`customers.tax_identity.created/updated/deleted`)
  declared in `events.ts`.
- Encryption registration for the new table's `value` field in
  `encryption.ts`.
- Dictionary defaults `LEGAL_FORM_DEFAULTS` and `ENTITY_TYPE_DEFAULTS`
  appended to `cli.ts` and seeded in `seedCustomerDictionaries` (with the
  `legal_form` / `entity_type` kinds added to the dictionary kind allow-list
  in both the validators and `commands/shared.ts#ensureDictionaryEntry`).
- Custom-field defaults for `legal_form`, `entity_type`, `full_address_krs`
  appended to `customFieldDefaults.ts` and registered in `ce.ts`.
- A minimal injection widget at
  `widgets/injection/tax-identities` mounted on
  `crud-form:customers.company:fields` that lists existing tax identities
  with a country / kind / value chip plus an inline create form (country
  picker → kind picker → value), with a NIP visual mask helper for
  display-only formatting.
- Locale strings for the new UI / commands / errors in
  `i18n/{en,pl,de,es}.json` under `customers.tax_identities.*` and
  `customers.audit.taxIdentities.*` keys.
- Integration test
  `__integration__/TC-PARTNER-001-tax-identities.spec.ts` covering create,
  list, duplicate (409), soft-delete, and permission gating.

### Non-goals (deferred)

- No data-migration scripts; this PR is purely additive (per the brief).
- No erp-fromee sync work; Phase 3 will reclassify JDG and map
  `Company.metadata.formaPrawna` later.
- No advanced autoformat round-trip (`123-456-78-90`) for the input field —
  display-only normalization ships in this PR; bidirectional input masking
  lands in a later UI polish task.
- No translatable-fields registration for the new entity (the new fields
  are dictionary-backed values, not translatable text).

## Implementation Plan

### Phase 1 — Entities

- 1.1 Add `CustomerTaxIdentity` entity to `data/entities.ts` with the
  required indexes and the partial unique index named
  `customer_tax_identities_unique_active`.
- 1.2 Append `legalForm`, `entityType`, and `fullAddressKrs` properties to
  `CustomerCompanyProfile`. Add a `OneToMany` `taxIdentities` collection on
  `CustomerEntity`.

### Phase 2 — Validators + checksum unit tests

- 2.1 Add `nipSchema`, `regonSchema`, `krsSchema`, `peselSchema`,
  `vatEuSchema`, and `taxIdentityCreate/Update/Delete` schemas to
  `data/validators.ts`. Implement the checksum logic in pure helpers in
  `data/taxIdentityChecksums.ts` so they are unit-testable without zod.
- 2.2 Add `__tests__/taxIdentityChecksums.test.ts` and
  `__tests__/validators.taxIdentity.test.ts` with positive and negative
  cases per kind.

### Phase 3 — Migration + custom fields + dictionaries + ACL + events + encryption

- 3.1 Run `yarn db:generate` and commit the produced migration verbatim.
- 3.2 Append `LEGAL_FORM_DEFAULTS` and `ENTITY_TYPE_DEFAULTS` to `cli.ts`
  and seed them in `seedCustomerDictionaries`. Allow-list the new kinds.
- 3.3 Add `cf.text('legal_form', …)`, `cf.text('entity_type', …)`,
  `cf.text('full_address_krs', …)` to `customFieldDefaults.ts` and update
  `ce.ts` so the existing custom-field installer keeps the company entity
  in sync.
- 3.4 Add the two new ACL features to `acl.ts`. Grant
  `customers.tax_identities.*` to `admin` (already covered by `customers.*`
  but list explicitly for clarity) and `customers.tax_identities.view` to
  `employee` in `setup.ts`.
- 3.5 Declare the three new events in `events.ts`.
- 3.6 Register the encryption map entry for `customers:customer_tax_identity`
  with at minimum the `value` field in `encryption.ts`.

### Phase 4 — Commands

- 4.1 Add `commands/taxIdentities.ts` with `create`, `update`, and `delete`
  commands following the addresses-style pattern (snapshot, soft-delete via
  `deletedAt`, undo restore, `emitCrudSideEffects` /
  `emitCrudUndoSideEffects`, query-index events). Wire `customers.tax_identity.*`
  events via `CrudEventsConfig`.
- 4.2 Register in `commands/index.ts`.

### Phase 5 — API routes

- 5.1 `api/companies/[id]/tax-identities/route.ts`: list (GET) + create (POST)
  using `makeCrudRoute` with `indexer: { entityType: 'customers:customer_tax_identity' }`.
  Validate the parent company id from the URL params and inject it into the
  scoped payload via `mapInput`. Apply RBAC via route metadata
  (`requireFeatures: ['customers.tax_identities.view'|'.manage']`). Export
  `openApi`. `withScopedPayload`-style scoping for tenant/org. Wire mutation
  guards via `validateCrudMutationGuard` if the factory does not already
  do so (factory does — confirm via the route).
- 5.2 `api/companies/[id]/tax-identities/[tid]/route.ts`: PATCH (update) +
  DELETE (soft delete). Reuse the same crud factory pattern but with the
  `tid` param routed to the command id.
- 5.3 Translate duplicate index violations into `409` with a clear error
  message (`customers.errors.tax_identity_duplicate`).

### Phase 6 — UI

- 6.1 Add `widgets/injection/tax-identities/widget.tsx` (Section + List +
  inline form), `widget.meta.ts`, and an `index.ts` re-exporting the widget.
- 6.2 Map the widget to `crud-form:customers.company:fields` in
  `widgets/injection-table.ts` (creating that file if it doesn't exist).
- 6.3 Implement the display-only NIP formatter (`123-456-78-90`) and inline
  validation that mirrors the zod schema. All API writes flow through
  `useGuardedMutation` + `apiCallOrThrow`.

### Phase 7 — i18n

- 7.1 Add the new keys to `i18n/{en,pl,de,es}.json` (English baseline +
  Polish primary; German / Spanish use the English text as a placeholder
  since the brief does not provide native translations and machine
  translation in this run would be lower-quality than English fallback).
- 7.2 Run `yarn i18n:check-sync` and `yarn i18n:check-usage`.

### Phase 8 — Integration test

- 8.1 `__integration__/TC-PARTNER-001-tax-identities.spec.ts` running
  through Playwright API. Covers: create company → POST 3 tax identities
  (PL NIP, DE VAT, FR VAT) → GET list returns 3 → POST duplicate PL NIP
  responds 409 → DELETE one → GET shows 2 / soft-deleted record gone from
  list. Permission case: a user with only the view feature attempts a POST
  and gets 403.

## Risks

- **Encryption** — the `value` column is encrypted at rest. The unique
  partial index in Postgres operates on whatever value is stored; if
  encryption is enabled tenant-wide, the encrypted ciphertext is what the
  index sees and duplicates of the same plaintext will collide because the
  encryption helper is deterministic per-tenant. We rely on this property;
  if a future change breaks determinism we would need a separate
  `value_lookup` digest column. Documented as a residual risk.
- **JDG reclassification** — out of scope; the brief explicitly defers it
  to Phase 3.
- **Bidirectional NIP masking** — display formatter only. A reviewer may
  ask for full masking; we would address that in a follow-up to keep this
  PR focused.
- **Validation gate cannot be run inside this sandbox** — the agent
  environment denies `yarn`, `npm`, `node`, `jest`, and `git checkout -B`.
  The execution plan therefore commits source-of-truth code without
  having executed `yarn build:packages`, `yarn generate`, `yarn typecheck`,
  `yarn test`, `yarn i18n:check-sync`, or `yarn build:app`. The PR body
  carries `Status: in-progress` and explicitly asks the reviewer (or a
  follow-up `auto-continue-pr` run with the full toolchain) to run the
  full gate, generate the ORM migration via `yarn db:generate`, and
  commit the produced migration file. The plan's Phase 3.1 and the
  validation-gate todo are both flagged as **BLOCKED** for this run.

## External References

None (no `--skill-url` provided).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a
> step lands. Do not rename step titles.

### Phase 1: Entities

- [x] 1.1 Add `CustomerTaxIdentity` entity with required indexes — 86721cb7d
- [x] 1.2 Extend `CustomerCompanyProfile` with legal_form / entity_type / full_address_krs — 86721cb7d

### Phase 2: Validators + checksum unit tests

- [x] 2.1 Add tax-identity zod schemas + checksum helpers — ea2143117
- [x] 2.2 Add unit tests covering checksums and zod schemas — ea2143117

### Phase 3: Migration + custom fields + dictionaries + ACL + events + encryption

- [ ] 3.1 Generate and commit ORM migration (BLOCKED: yarn db:generate denied; see Risks)
- [x] 3.2 Add LEGAL_FORM_DEFAULTS / ENTITY_TYPE_DEFAULTS dictionaries — 0c22c9467
- [x] 3.3 Add custom-field defaults and update ce.ts — 0c22c9467
- [x] 3.4 Add ACL features and update setup.ts default role grants — 0c22c9467
- [x] 3.5 Declare new events in events.ts — 0c22c9467
- [x] 3.6 Register encryption map for customer_tax_identity — 0c22c9467

### Phase 4: Commands

- [x] 4.1 Implement create / update / delete commands with undo — c5a708401
- [x] 4.2 Register commands in commands/index.ts — c5a708401

### Phase 5: API routes

- [ ] 5.1 List + create route with openapi
- [ ] 5.2 Update + delete sub-resource route with openapi
- [ ] 5.3 Surface duplicate index violations as 409

### Phase 6: UI

- [ ] 6.1 Build the injection widget (list + inline create)
- [ ] 6.2 Map the widget into crud-form:customers.company:fields
- [ ] 6.3 Wire NIP display formatter and inline validation

### Phase 7: i18n

- [ ] 7.1 Add locale keys to en/pl/de/es
- [ ] 7.2 Pass yarn i18n:check-sync and i18n:check-usage

### Phase 8: Integration test

- [ ] 8.1 Write TC-PARTNER-001 covering create / list / 409 / delete / permissions

## Changelog

- 2026-05-03 — initial plan committed.
