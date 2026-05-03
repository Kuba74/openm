import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  CustomerAddress,
  CustomerCompanyBilling,
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerEntityRole,
  CustomerPersonCompanyLink,
  CustomerPersonCompanyRole,
  CustomerTaxIdentity,
} from '@open-mercato/core/modules/customers/data/entities'
import {
  normalizeKrsForStorage,
  normalizeNipForStorage,
  normalizePeselForStorage,
  normalizeRegonForStorage,
  normalizeVatEuForStorage,
} from '@open-mercato/core/modules/customers/data/taxIdentityChecksums'
import type { CompanyImportPlan } from './pipeline'
import type { ImportScope } from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function normalizeTaxValue(kind: string, value: string): string {
  switch (kind) {
    case 'nip':
      return normalizeNipForStorage(value)
    case 'regon':
      return normalizeRegonForStorage(value)
    case 'krs':
      return normalizeKrsForStorage(value)
    case 'pesel':
      return normalizePeselForStorage(value)
    case 'vat_eu':
      return normalizeVatEuForStorage(value)
    default:
      return value.trim()
  }
}

/**
 * Wynik zapisu pojedynczej firmy. Pipeline strumieniuje plany, writer
 * konsumuje je po kolei — po jednym `WriteResult` per plan.
 */
export type WriteResult = {
  externalCompanyId: string
  status: 'created' | 'idempotent-skip' | 'plan-skip' | 'failed'
  entityId?: string
  profileId?: string
  reason?: string
  error?: string
  warnings: string[]
}

export type WriteImportPlanContext = {
  /** Mikro-ORM EntityManager — zostanie forkowany na osobną tx per company. */
  em: EntityManager
  /** Command bus do `customers.companies.create` / `customers.people.create`. */
  commandBus: CommandBus
  /** DI container — przekazywany do CommandContext, żeby command mógł resolve'ować em/dataEngine. */
  container: ContainerLike
  /** UUID użytkownika imitującego import (dla audit logów). Default: 'erp-fromee-import'. */
  importerUserId?: string
}

export type ContainerLike = {
  resolve: <T = unknown>(name: string) => T
}

const COMMAND_BUS_FEATURES = [
  'customers.companies.create',
  'customers.companies.manage',
  'customers.people.create',
  'customers.people.manage',
  'customers.tax_identities.manage',
  'customers.addresses.manage',
  'customers.billing.manage',
]

export const SOURCE_PREFIX = 'erp_fromee'

export function buildSourceKey(externalCompanyId: string): string {
  return `${SOURCE_PREFIX}:${externalCompanyId}`
}

export function buildContactSourceKey(externalContactId: string): string {
  return `${SOURCE_PREFIX}:contact:${externalContactId}`
}

function buildCommandContext(ctx: WriteImportPlanContext, scope: ImportScope): unknown {
  return {
    container: ctx.container,
    auth: {
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
      userId: ctx.importerUserId ?? 'erp-fromee-import',
      roles: ['admin'],
      features: COMMAND_BUS_FEATURES,
    },
    requestId: `erp-fromee-import-${Date.now()}`,
    origin: 'sync_erp_fromee',
  }
}

/**
 * Sprawdza idempotency: czy `customer_entities.source` zawiera już ten
 * external ID. Jeśli tak, zwraca istniejące entityId — writer pomija zapis.
 */
async function findExistingEntityId(
  em: EntityManager,
  scope: ImportScope,
  externalCompanyId: string,
): Promise<string | null> {
  const sourceKey = buildSourceKey(externalCompanyId)
  const existing = await em.findOne(
    CustomerEntity,
    {
      source: sourceKey,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as Record<string, unknown>,
  )
  return existing?.id ?? null
}

/**
 * Zapisuje pojedynczy `CompanyImportPlan` do bazy openm. Idempotent:
 * sprawdza `customer_entities.source = 'erp_fromee:<externalId>'` przed
 * zapisem i pomija jeśli rekord już istnieje.
 *
 * Co zapisujemy:
 * - `customer_entities` + `customer_companies` lub `customer_people`
 *   (przez command bus — preserves audit log + side effects)
 * - `customer_companies.legal_form` / `entity_type` / `full_address_krs`
 *   (direct EM update — nie ma ich w companyCreateSchema)
 * - `customer_tax_identities` (direct EM insert, value normalizowany przez
 *   `normalize{Nip,Regon,Krs,Pesel,VatEu}ForStorage` żeby canonical value
 *   był taki sam jak by szła przez `customers.tax_identities.create`)
 * - `customer_entity_roles` (direct EM insert; wymaga UUID `importerUserId`
 *   bo schema ma `user_id NOT NULL`)
 * - `customer_addresses` (direct EM insert; `address_line1` required —
 *   pomijamy adresy bez `street1`)
 * - `customer_company_billing` (direct EM insert; tylko dla firm)
 *
 * Każdy ancillary insert jest izolowany (em.fork → flush per row) — failure
 * jednego rekordu (np. unique-constraint conflict na NIP) nie zabija
 * pozostałych ancillary'ek tej firmy.
 *
 * Y8 — kontakty osobowe:
 * - `customer_people` (przez `customers.people.create` command, source =
 *   'erp_fromee:contact:<id>' jako idempotency anchor)
 * - `customer_person_company_links` (M:N person↔company; D6 first-wins
 *   pre-applied w mapperze)
 * - `customer_person_company_roles` (Architekt → 'architect' itd.)
 *
 * Co odkładamy na Y8a (out of scope tego PR):
 * - `customer_entities.metadata` blob (column nie istnieje — wymaga migracji)
 * - Multi-source `external_links` array (D3) — używamy single `source` field
 *
 * Encryption (D11):
 * - Plain IBAN nie jest persistowany (mapper banks emituje go tylko dla
 *   wyboru, billing zapisuje wyłącznie zamaskowaną wersję). Encryption
 *   layer na poziomie tenanta automatycznie obejmuje encrypted-by-default
 *   pola — writer nie zna explicit `TenantDataEncryptionService`.
 */
export async function writeImportPlan(
  plan: CompanyImportPlan,
  scope: ImportScope,
  ctx: WriteImportPlanContext,
): Promise<WriteResult> {
  if (plan.status === 'skipped' || plan.status === 'manual_review') {
    return {
      externalCompanyId: plan.externalCompanyId,
      status: 'plan-skip',
      reason: plan.skipReason ?? plan.manualReviewReason ?? plan.status,
      warnings: plan.warnings,
    }
  }
  if (!plan.partner.entity || !plan.partner.profile) {
    return {
      externalCompanyId: plan.externalCompanyId,
      status: 'plan-skip',
      reason: 'no-entity-row',
      warnings: plan.warnings,
    }
  }

  const sourceKey = buildSourceKey(plan.externalCompanyId)
  const fork = ctx.em.fork()

  const existingId = await findExistingEntityId(fork, scope, plan.externalCompanyId)
  if (existingId) {
    return {
      externalCompanyId: plan.externalCompanyId,
      status: 'idempotent-skip',
      entityId: existingId,
      reason: `already imported as ${existingId}`,
      warnings: plan.warnings,
    }
  }

  const entityRow = plan.partner.entity
  const profileRow = plan.partner.profile
  const cmdCtx = buildCommandContext(ctx, scope)

  const baseScopedPayload = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    displayName: entityRow.displayName,
    description: entityRow.description ?? undefined,
    primaryEmail: entityRow.primaryEmail ?? undefined,
    primaryPhone: entityRow.primaryPhone ?? undefined,
    isActive: entityRow.isActive,
    lifecycleStage: plan.roles.primaryLifecycleStage ?? undefined,
    source: sourceKey,
  }

  const warnings = [...plan.warnings]
  let entityId: string
  let profileId: string | undefined

  try {
    if (entityRow.kind === 'company' && profileRow.kind === 'company') {
      const cmd = await ctx.commandBus.execute<
        Record<string, unknown>,
        { entityId: string; companyId: string }
      >(
        'customers.companies.create',
        {
          input: {
            ...baseScopedPayload,
            legalName: profileRow.legalName ?? undefined,
            brandName: profileRow.brandName ?? undefined,
          },
          ctx: cmdCtx as never,
        },
      )
      entityId = cmd.result.entityId
      profileId = cmd.result.companyId

      // Domknij pola których nie ma w companyCreateSchema (legal_form, entity_type, full_address_krs).
      const profile = await fork.findOne(CustomerCompanyProfile, { id: profileId })
      if (profile) {
        let touched = false
        if (profileRow.legalForm !== null) {
          profile.legalForm = profileRow.legalForm
          touched = true
        }
        if (profileRow.entityType !== null) {
          profile.entityType = profileRow.entityType
          touched = true
        }
        if (profileRow.fullAddressKrs !== null) {
          profile.fullAddressKrs = profileRow.fullAddressKrs
          touched = true
        }
        if (touched) await fork.flush()
      }
    } else if (entityRow.kind === 'person' && profileRow.kind === 'person') {
      const firstName = profileRow.firstName ?? entityRow.displayName.split(' ')[0] ?? ''
      const lastName =
        profileRow.lastName ?? entityRow.displayName.split(' ').slice(1).join(' ') ?? ''
      if (!firstName || !lastName) {
        warnings.push(
          `Skipped person ${plan.externalCompanyId}: command requires firstName + lastName, derived from "${entityRow.displayName}" was incomplete`,
        )
        return {
          externalCompanyId: plan.externalCompanyId,
          status: 'plan-skip',
          reason: 'missing-name-parts',
          warnings,
        }
      }
      const cmd = await ctx.commandBus.execute<
        Record<string, unknown>,
        { entityId: string; personId: string }
      >(
        'customers.people.create',
        {
          input: {
            ...baseScopedPayload,
            displayName: undefined,
            firstName,
            lastName,
          },
          ctx: cmdCtx as never,
        },
      )
      entityId = cmd.result.entityId
      profileId = cmd.result.personId
    } else {
      return {
        externalCompanyId: plan.externalCompanyId,
        status: 'plan-skip',
        reason: 'kind-mismatch',
        warnings,
      }
    }

    const entityRef = fork.getReference(CustomerEntity, entityId)

    // Tax identities — flush per row, żeby unique-constraint na (country, kind, value)
    // dla jednego rekordu nie zabił pozostałych. Bug F: jedno collision dropowało
    // wszystkie tax_identities tej firmy.
    for (const tax of plan.taxIdentities.rows) {
      try {
        const normalizedValue = normalizeTaxValue(tax.kind, tax.value)
        if (!normalizedValue) {
          warnings.push(
            `Skipped tax identity ${tax.kind}=${tax.value} (Company ${plan.externalCompanyId}): empty after normalization`,
          )
          continue
        }
        const sub = fork.fork()
        sub.create(CustomerTaxIdentity, {
          organizationId: tax.organizationId,
          tenantId: tax.tenantId,
          entity: sub.getReference(CustomerEntity, entityId),
          countryCode: tax.countryCode,
          kind: tax.kind,
          value: normalizedValue,
          isPrimary: tax.isPrimary,
        })
        await sub.flush()
      } catch (err) {
        warnings.push(
          `Failed tax identity ${tax.kind}=${tax.value} (Company ${plan.externalCompanyId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }

    // Bug E — entity_roles (customer/supplier classification per source CompanyRole).
    // Schema wymaga user_id NOT NULL → używamy importerUserId (UUID wymagany).
    if (isUuid(ctx.importerUserId)) {
      for (const roleRow of plan.roles.rows) {
        try {
          const sub = fork.fork()
          sub.create(CustomerEntityRole, {
            organizationId: roleRow.organizationId,
            tenantId: roleRow.tenantId,
            entityType: roleRow.entityType,
            entityId: entityId,
            userId: ctx.importerUserId,
            roleType: roleRow.roleType,
          })
          await sub.flush()
        } catch (err) {
          warnings.push(
            `Failed entity role ${roleRow.roleType} (Company ${plan.externalCompanyId}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        }
      }
    } else if (plan.roles.rows.length > 0) {
      warnings.push(
        `Skipped ${plan.roles.rows.length} entity_role rows (Company ${plan.externalCompanyId}): importerUserId not a UUID — pass --user <UUID> to CLI`,
      )
    }

    for (const addr of plan.addresses.rows) {
      if (!addr.street1) {
        warnings.push(
          `Skipped address ${addr.externalAddressId} (Company ${plan.externalCompanyId}): address_line1 required, source had no street1`,
        )
        continue
      }
      try {
        const sub = fork.fork()
        sub.create(CustomerAddress, {
          organizationId: addr.organizationId,
          tenantId: addr.tenantId,
          entity: sub.getReference(CustomerEntity, entityId),
          purpose: addr.addressType,
          addressLine1: addr.street1,
          addressLine2: addr.street2,
          city: addr.city,
          region: addr.region,
          postalCode: addr.postalCode,
          country: addr.countryCode,
          isPrimary: addr.isPrimary,
        })
        await sub.flush()
      } catch (err) {
        warnings.push(
          `Failed address ${addr.externalAddressId} (Company ${plan.externalCompanyId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }

    if (entityRow.kind === 'company' && plan.billing.row) {
      try {
        const sub = fork.fork()
        sub.create(CustomerCompanyBilling, {
          organizationId: plan.billing.row.organizationId,
          tenantId: plan.billing.row.tenantId,
          entity: sub.getReference(CustomerEntity, entityId),
          bankName: plan.billing.row.bankName,
          bankAccountMasked: plan.billing.row.bankAccountMasked,
          paymentTerms: plan.billing.row.paymentTerms,
          preferredCurrency: plan.billing.row.preferredCurrency,
          salesOwnerUserId: plan.billing.row.salesOwnerUserId,
          defaultOfferValidityDays: plan.billing.row.defaultOfferValidityDays,
        })
        await sub.flush()
      } catch (err) {
        warnings.push(
          `Failed billing row (Company ${plan.externalCompanyId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }

    // Y8: contacts → customer_people + customer_person_company_links + customer_person_company_roles
    // Person idempotency anchor: customer_entities.source = 'erp_fromee:contact:<contactId>'.
    // Person↔company link unique: (person_entity_id, company_entity_id) where deleted_at IS NULL.
    if (entityRow.kind === 'company' && plan.contacts.persons.length > 0) {
      const personIdByContactId = new Map<string, string>()

      for (const person of plan.contacts.persons) {
        const profile = plan.contacts.profiles.find((p) => p.externalId === person.externalId)
        const personSourceKey = buildContactSourceKey(person.externalId)
        try {
          // Idempotency check
          const sub = fork.fork()
          const existing = await sub.findOne(CustomerEntity, {
            source: personSourceKey,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            deletedAt: null,
          } as Record<string, unknown>)
          if (existing) {
            personIdByContactId.set(person.externalId, existing.id)
            continue
          }

          // Derive firstName/lastName: explicit profile fields first, fallback z displayName.
          const explicitFirst = profile?.firstName?.trim() ?? null
          const explicitLast = profile?.lastName?.trim() ?? null
          const split = person.displayName.trim().split(/\s+/)
          const firstName = explicitFirst || split[0] || ''
          const lastName = explicitLast || split.slice(1).join(' ') || ''
          if (!firstName || !lastName) {
            warnings.push(
              `Skipped contact ${person.externalId} (Company ${plan.externalCompanyId}): cannot derive firstName + lastName from "${person.displayName}"`,
            )
            continue
          }

          const cmd = await ctx.commandBus.execute<
            Record<string, unknown>,
            { entityId: string; personId: string }
          >(
            'customers.people.create',
            {
              input: {
                organizationId: scope.organizationId,
                tenantId: scope.tenantId,
                firstName,
                lastName,
                primaryEmail: person.primaryEmail ?? undefined,
                primaryPhone: person.primaryPhone ?? undefined,
                isActive: person.isActive,
                source: personSourceKey,
              },
              ctx: cmdCtx as never,
            },
          )
          personIdByContactId.set(person.externalId, cmd.result.entityId)
        } catch (err) {
          warnings.push(
            `Failed contact ${person.externalId} (Company ${plan.externalCompanyId}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        }
      }

      // Person↔Company links — primary handling już zrobiony w mapperze (D6 first-wins).
      for (const link of plan.contacts.links) {
        const personId = personIdByContactId.get(link.externalContactId)
        if (!personId) continue // person creation failed earlier — already warned
        try {
          const sub = fork.fork()
          sub.create(CustomerPersonCompanyLink, {
            organizationId: link.organizationId,
            tenantId: link.tenantId,
            person: sub.getReference(CustomerEntity, personId),
            company: sub.getReference(CustomerEntity, entityId),
            isPrimary: link.isPrimary,
          })
          await sub.flush()
        } catch (err) {
          warnings.push(
            `Failed person↔company link (contact ${link.externalContactId}, company ${plan.externalCompanyId}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        }
      }

      // Person↔Company role rows (Architekt → architect, etc).
      for (const roleRow of plan.contacts.roles) {
        const personId = personIdByContactId.get(roleRow.externalContactId)
        if (!personId) continue
        try {
          const sub = fork.fork()
          sub.create(CustomerPersonCompanyRole, {
            organizationId: roleRow.organizationId,
            tenantId: roleRow.tenantId,
            personEntity: sub.getReference(CustomerEntity, personId),
            companyEntity: sub.getReference(CustomerEntity, entityId),
            roleValue: roleRow.roleValue,
          })
          await sub.flush()
        } catch (err) {
          warnings.push(
            `Failed person company role (contact ${roleRow.externalContactId}, company ${plan.externalCompanyId}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
        }
      }
    }
  } catch (error) {
    return {
      externalCompanyId: plan.externalCompanyId,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      warnings,
    }
  }

  return {
    externalCompanyId: plan.externalCompanyId,
    status: 'created',
    entityId,
    profileId,
    warnings,
  }
}

/**
 * Konsumuje listę planów i zapisuje sekwencyjnie. Każda firma ma własną
 * transakcję — failure jednej nie cofa już zapisanych.
 */
export async function writeAllPlans(
  plans: CompanyImportPlan[],
  scope: ImportScope,
  ctx: WriteImportPlanContext,
): Promise<{ results: WriteResult[]; summary: WriteSummary }> {
  const results: WriteResult[] = []
  for (const plan of plans) {
    results.push(await writeImportPlan(plan, scope, ctx))
  }
  return { results, summary: summarizeWrites(results) }
}

export type WriteSummary = {
  total: number
  created: number
  idempotentSkip: number
  planSkip: number
  failed: number
  byReason: Record<string, number>
}

export function summarizeWrites(results: WriteResult[]): WriteSummary {
  const summary: WriteSummary = {
    total: results.length,
    created: 0,
    idempotentSkip: 0,
    planSkip: 0,
    failed: 0,
    byReason: {},
  }
  for (const r of results) {
    if (r.status === 'created') summary.created += 1
    else if (r.status === 'idempotent-skip') summary.idempotentSkip += 1
    else if (r.status === 'plan-skip') summary.planSkip += 1
    else if (r.status === 'failed') summary.failed += 1
    const key = r.reason ?? r.status
    summary.byReason[key] = (summary.byReason[key] ?? 0) + 1
  }
  return summary
}
