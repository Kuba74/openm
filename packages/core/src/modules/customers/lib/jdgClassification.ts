import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerTaxIdentity,
  type CustomerTaxIdentityKind,
} from '@open-mercato/core/modules/customers/data/entities'

export type JdgReclassScope = {
  organizationId: string
  tenantId: string
}

export type JdgReclassDetail = {
  entityId: string
  reason: 'reclassified' | 'no-nip' | 'already-company'
}

export type JdgReclassResult = {
  considered: number
  reclassified: number
  skipped: number
  details: JdgReclassDetail[]
}

const PL_NIP_KIND: CustomerTaxIdentityKind = 'nip'
const PL_COUNTRY = 'PL'
const JDG_LEGAL_FORM = 'jdg'

async function runInTransaction<TResult>(
  em: EntityManager,
  operation: (trx: EntityManager) => Promise<TResult>,
): Promise<TResult> {
  const transactionalEm = em as EntityManager & {
    transactional?: (callback: (trx: EntityManager) => Promise<TResult>) => Promise<TResult>
  }
  if (typeof transactionalEm.transactional === 'function') {
    return transactionalEm.transactional((trx) => operation(trx))
  }
  return operation(em)
}

export async function reclassifyJdgEntities(
  em: EntityManager,
  scope: JdgReclassScope,
): Promise<JdgReclassResult> {
  const candidates = await em.find(
    CustomerEntity,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      kind: 'person',
      deletedAt: null,
    },
    { orderBy: { createdAt: 'asc' } },
  )

  const result: JdgReclassResult = {
    considered: candidates.length,
    reclassified: 0,
    skipped: 0,
    details: [],
  }

  for (const entity of candidates) {
    const existingCompany = await em.findOne(CustomerCompanyProfile, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entity,
    })
    if (existingCompany) {
      result.skipped += 1
      result.details.push({ entityId: entity.id, reason: 'already-company' })
      continue
    }

    const taxIdentity = await em.findOne(CustomerTaxIdentity, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entity,
      kind: PL_NIP_KIND,
      countryCode: PL_COUNTRY,
      deletedAt: null,
    })
    if (!taxIdentity) {
      result.skipped += 1
      result.details.push({ entityId: entity.id, reason: 'no-nip' })
      continue
    }

    await runInTransaction(em, async (trx) => {
      entity.kind = 'company'
      const company = trx.create(CustomerCompanyProfile, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        legalForm: JDG_LEGAL_FORM,
        entity,
      })
      trx.persist(entity)
      trx.persist(company)
      await trx.flush()
    })

    result.reclassified += 1
    result.details.push({ entityId: entity.id, reason: 'reclassified' })
  }

  return result
}
