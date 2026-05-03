# Formee Companies Bridge — POC

Read-only bridge that mirrors the legacy Formee `Company` rows (Postgres / Prisma) into Open Mercato `customer_entities` (kind=`company`) via the canonical `customers.companies.create` command.

## What this proves

1. **Open Mercato can host Formee data without rewriting the legacy schema.** The bridge talks to the existing Formee Postgres in read-only mode.
2. **The OM custom-fields system absorbs Formee-specific columns** (NIP, REGON, KRS, VAT-EU, `companyNo`, `kind`) without touching MikroORM entities or running a migration. Anything Formee-specific lands under `customFields.formee_*`.
3. **The MCP/AI-assistant layer works against imported data the moment the import finishes** — Claude can hit `GET /api/customers/companies` through the existing `execute` tool with no extra wiring on this bridge's side.

## Files

| File | Role |
|---|---|
| `index.ts` | Module manifest |
| `acl.ts` | RBAC features (`formee_companies_bridge.import`, `.view`) |
| `setup.ts` | Default role mapping (superadmin/admin can import) |
| `lib/formee-prisma.ts` | Streaming Postgres reader with cursor pagination (uses `pg` already pulled in by MikroORM) |
| `lib/company-mapper.ts` | Pure mapper: `Company` row → `CompanyCreateInput` payload |
| `lib/import.ts` | Orchestrator that streams batches and dispatches to the `commandBus` |
| `cli.ts` | `mercato formee_companies_bridge import` |
| `api/import-companies/route.ts` | `POST /api/formee_companies_bridge/import-companies` |
| `i18n/{en,pl}.json` | Translations |

## Required env

```bash
# Pointer to the legacy Formee Postgres (read-only credentials are fine)
FORMEE_LEGACY_DATABASE_URL="postgresql://rafalkubrycht@localhost/formee?schema=public"
```

The OM app keeps using its own `DATABASE_URL` for the new schema.

## How to run (1-shot)

From the openm root:

```bash
yarn generate              # Re-discover modules — REQUIRED after adding new files
yarn build:packages        # Only if you changed shared/* or core/* packages

# Wskaż starą bazę
export FORMEE_LEGACY_DATABASE_URL="postgresql://rafalkubrycht@localhost/formee?schema=public"

# Dry run — no writes, just count
yarn mercato formee_companies_bridge import \
  --tenant <TENANT_UUID> \
  --org <ORG_UUID> \
  --dry-run --limit 50

# Real import
yarn mercato formee_companies_bridge import \
  --tenant <TENANT_UUID> \
  --org <ORG_UUID> \
  --batch-size 200
```

## How to verify

After the import completes:

1. Open `http://localhost:3000/backend/customers/companies` — Formee firms appear in the OM CRM list.
2. Click any company — the Formee identifiers (NIP, REGON, KRS, `companyNo`) show up in the Custom Fields section.
3. Open the AI Assistant (`Cmd+K`) and ask: *"List the 5 most recently created customer companies"* — Claude calls `api.request({ method: 'GET', path: '/api/customers/companies', query: { sort: '-createdAt', perPage: 5 } })` against the imported rows.

## What this POC deliberately skips

- **No two-way sync** — Formee remains the system of record for now. A full migration would either flip the direction (OM → Formee write-back) or, more realistically, make this an adapter under the `data_sync` module so it gets retry / scheduling / progress UI for free.
- **No people/contacts** — `CompanyContact` rows would map to OM `customer_person_profile` plus a `companyEntityId` link. Same pattern, ~80 LOC more.
- **No address normalization** — `CompanyAddress` would land in OM `addresses` with one mapper. Add a follow-up bridge module when ready.
- **No deletion handling** — the importer is additive. Idempotency would key off `customFields.formee_legacy_id` and either upsert or skip.

## Why this lives in `apps/mercato/src/modules/`, not `packages/`

Per OM convention this is a **tenant-specific bridge**, not a reusable package. If you later want to ship "ERPbos sync" as a productized integration, it gets promoted to `packages/sync-erpbos/` and rewritten as a `DataSyncAdapter` — the mapper / pg client code ports over verbatim.
