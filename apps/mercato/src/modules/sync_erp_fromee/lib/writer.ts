import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  CustomerAddress,
  CustomerCompanyBilling,
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerTaxIdentity,
} from '@open-mercato/core/modules/customers/data/entities'
import type { CompanyImportPlan } from './pipeline'
import type { ImportScope } from './types'

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
 * - `customer_tax_identities` (direct EM insert)
 * - `customer_addresses` (direct EM insert; `address_line1` required —
 *   pomijamy adresy bez `street1`)
 * - `customer_company_billing` (direct EM insert; tylko dla firm)
 *
 * Co odkładamy na Y8:
 * - Person↔Company links (kontakty osobowe + `customer_person_company_*`)
 * - `customer_entities.metadata` blob (column nie istnieje — wymaga
 *   migracji lub osobnej tabeli)
 * - Multi-source `external_links` array (D3) — używamy single `source`
 *   field jako idempotency anchor
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

    for (const tax of plan.taxIdentities.rows) {
      fork.create(CustomerTaxIdentity, {
        organizationId: tax.organizationId,
        tenantId: tax.tenantId,
        entity: entityRef,
        countryCode: tax.countryCode,
        kind: tax.kind,
        value: tax.value,
        isPrimary: tax.isPrimary,
      })
    }

    for (const addr of plan.addresses.rows) {
      if (!addr.street1) {
        warnings.push(
          `Skipped address ${addr.externalAddressId} (Company ${plan.externalCompanyId}): address_line1 required, source had no street1`,
        )
        continue
      }
      fork.create(CustomerAddress, {
        organizationId: addr.organizationId,
        tenantId: addr.tenantId,
        entity: entityRef,
        purpose: addr.addressType,
        addressLine1: addr.street1,
        addressLine2: addr.street2,
        city: addr.city,
        region: addr.region,
        postalCode: addr.postalCode,
        country: addr.countryCode,
        isPrimary: addr.isPrimary,
      })
    }

    if (entityRow.kind === 'company' && plan.billing.row) {
      fork.create(CustomerCompanyBilling, {
        organizationId: plan.billing.row.organizationId,
        tenantId: plan.billing.row.tenantId,
        entity: entityRef,
        bankName: plan.billing.row.bankName,
        bankAccountMasked: plan.billing.row.bankAccountMasked,
        paymentTerms: plan.billing.row.paymentTerms,
        preferredCurrency: plan.billing.row.preferredCurrency,
        salesOwnerUserId: plan.billing.row.salesOwnerUserId,
        defaultOfferValidityDays: plan.billing.row.defaultOfferValidityDays,
      })
    }

    await fork.flush()
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
