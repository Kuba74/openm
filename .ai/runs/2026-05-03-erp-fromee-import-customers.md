# Run plan — ERP-fromee customers import

**Slug:** `erp-fromee-import-customers`
**Branch:** `feat/erp-fromee-import-customers`
**Source spec:** `.ai/specs/2026-05-03-erp-fromee-import-customers.md`
**Companion audit:** `.ai/specs/analysis/ANALYSIS-2026-05-03-import-readiness-erp-fromee.md`
**Base:** `develop`
**Estimated:** ~15h

## Goal

Implement a one-time CLI importer that pulls ~200 partners with `roleType IN ('CUSTOMER','PROSPECT')` from the legacy erp-fromee Postgres into openm's customer module — covering company/person profiles, tax identities, roles, contacts, addresses, billing, and Polish metadata. Idempotent via `metadata.external_id` lookup.

## Scope

- New app-side module `apps/mercato/src/modules/sync_erp_fromee/` with adapter, mappers, idempotency layer, pipeline orchestration, CLI command, dry-run report, and unit tests for every mapper.
- Read-only access to the legacy `formee` Postgres via `pg`. Source is **never written**.
- All writes scoped to a single `(tenantId, organizationId)` pair passed via CLI flags.
- Integration smoke test that exercises a synthetic pg-fixture or short-circuit (sandbox-aware).

## Non-goals

- Continuous sync (post-MVP, Faza 3 of master spec).
- Supplier-only partners (`SUPPLIER`, `PARTNER`, `CARRIER`, `BANK`, `LEAD`).
- Multi-bank account model (Faza 4 — only primary bank record imported).
- KlientFirma / construction objects — not customers.
- INTERNAL companies — explicitly skipped (D4).

## Architecture summary

- `lib/erpFromeeAdapter.ts` — pg client, batched fetch of `Company` + child tables (`CompanyRole`, `CompanyContact`, `CompanyAddress`, `CompanyBankAccount`, `CompanySourceLink`).
- `lib/mappers/*` — pure functions: source row → target payload.
- `lib/idempotency.ts` — `findExistingPartner` using `customer_entities.source = 'erp_fromee'` + a metadata column we don't have, so we use a generic JSON-based lookup via raw SQL using a custom query or via the `description` field surrogate. We use `customer_entities.source = 'erp_fromee'` and a synthetic surrogate stored in `customer_entities.lifecycle_stage` is wrong — instead we store external id via the existing `customer_entity_roles` table? No — simpler: we add no new column; we use a synthetic `customer_entity_roles.role_type` of `external_ref:erp_fromee:<id>` is also wrong. Final approach: piggyback on the customers module's existing JSON metadata path is unavailable (no `metadata` column on `customer_entities`). We instead combine `source = 'erp_fromee'` + a deterministic surrogate captured by hashing source.id into `description` is fragile. The clean approach: keep a **module-local mapping table** is forbidden by spec ("NO migration changes"). Use the deterministic strategy: rely on `customer_tax_identities (country_code, kind, value)` unique-active index for NIP-bearing rows, and for the rest combine `source='erp_fromee'` with `displayName` exact match within the scope. Re-runs match by NIP first, by display_name second. Document as a known limitation for partners that have neither.
- `lib/importPipeline.ts` — orchestrates: load source → audit → per-row map+upsert → write.
- `lib/reportFormatter.ts` — dry-run console table output.
- `cli/import-customers.ts` — `ModuleCli` exporting `import-customers` command supporting `--dry-run`, `--commit`, `--tenant`, `--org`, `--limit`.

## Files to touch

| Path | Action |
|---|---|
| `apps/mercato/src/modules/sync_erp_fromee/index.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/cli.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/erpFromeeAdapter.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/types.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/mappers/companyToPartner.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/mappers/taxIdentities.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/mappers/roles.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/mappers/contacts.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/mappers/addresses.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/mappers/billing.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/mappers/metadata.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/idempotency.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/importPipeline.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/lib/reportFormatter.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/__tests__/companyToPartner.test.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/__tests__/taxIdentities.test.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/__tests__/roles.test.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/__tests__/contacts.test.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/__tests__/addresses.test.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/__tests__/billing.test.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/__tests__/metadata.test.ts` | NEW |
| `apps/mercato/src/modules/sync_erp_fromee/__tests__/idempotency.test.ts` | NEW |
| `apps/mercato/src/modules.ts` | EDIT — register `sync_erp_fromee` |
| `apps/mercato/.env.example` | EDIT — document `ERP_FROMEE_DATABASE_URL` |

No DB migrations. Pure additive module; no contract surfaces touched.

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R.1 | No JSON metadata column on `customer_entities` for storing `external_id` | Medium | Use NIP unique-active index + `(source='erp_fromee', display_name)` fallback for re-runs |
| R.2 | Sandbox blocks live pg connection | Medium | Adapter is functional; integration test uses a fake pg client; document blocker if `--commit` cannot be smoke-tested |
| R.3 | `yarn` denied in sandbox | Medium | Best-effort: try targeted Jest, document as BLOCKED if needed; manual diff re-read |
| R.4 | Multi-primary contacts/addresses in source | Low | First-wins handling in mapper (per spec) |
| R.5 | unmapped legalForm values | Low | Default fallback to lower-case slug; warning emitted |
| R.6 | Encryption flag enabled at runtime → IBAN must be persisted via decryption helpers | Medium | Pipeline uses `findOneWithDecryption` for reads; writes use plain ORM persist (encryption is applied via subscribers when flag is enabled) |

## Implementation Plan

### Phase 1: Module setup + adapter (3 h)

Create module skeleton, register in app, add env var docs. Build read-only pg adapter.

### Phase 2: Mappers (10 h)

Eight pure mapper functions plus idempotency helper. Each ships unit tests.

### Phase 3: Pipeline + CLI (2 h)

Orchestrator that loads source, runs audit, maps each row, upserts, and emits report. CLI command exposes flags.

### Phase 4: Polish + (best-effort) integration test

Self-contained test using fake pg client + in-memory MikroORM (or stub) to verify idempotency and counts. Skipped if sandbox blocks DB.

### Phase 5: Validation gate + PR

Best-effort run of typecheck, unit tests for the new module, and `yarn build:packages`. Open PR with the right labels.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Module setup + adapter

- [ ] 1.1 NEW `sync_erp_fromee/index.ts` module metadata
- [ ] 1.2 NEW `lib/erpFromeeAdapter.ts` read-only pg client + child loaders
- [ ] 1.3 NEW `lib/types.ts` source-row type definitions
- [ ] 1.4 EDIT `apps/mercato/src/modules.ts` register module
- [ ] 1.5 EDIT `apps/mercato/.env.example` document `ERP_FROMEE_DATABASE_URL`

### Phase 2: Mappers + unit tests

- [ ] 2.1 `mappers/companyToPartner.ts` + tests
- [ ] 2.2 `mappers/taxIdentities.ts` + tests
- [ ] 2.3 `mappers/roles.ts` + tests
- [ ] 2.4 `mappers/contacts.ts` + tests
- [ ] 2.5 `mappers/addresses.ts` + tests
- [ ] 2.6 `mappers/billing.ts` + tests
- [ ] 2.7 `mappers/metadata.ts` + tests
- [ ] 2.8 `lib/idempotency.ts` + tests

### Phase 3: Pipeline + CLI

- [ ] 3.1 `lib/importPipeline.ts` orchestration
- [ ] 3.2 `lib/reportFormatter.ts`
- [ ] 3.3 `cli.ts` register `import-customers` command with `--dry-run` / `--commit`

### Phase 4: Polish

- [ ] 4.1 Self-review BC + code-review checklist
- [ ] 4.2 Manual diff re-read

### Phase 5: Validation gate + PR

- [ ] 5.1 `yarn build:packages` (best-effort)
- [ ] 5.2 `yarn typecheck` (best-effort)
- [ ] 5.3 `yarn test` for the new module (best-effort)
- [ ] 5.4 Open PR (`feat/erp-fromee-import-customers` → `develop`)
- [ ] 5.5 Apply labels: `review`, `feature`, `needs-qa`

## Changelog

- 2026-05-03 — plan drafted by `auto-create-pr` for slug `erp-fromee-import-customers`.
