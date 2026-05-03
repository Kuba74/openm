import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity, CustomerEntityRole } from '../data/entities'

export type SalesCustomerScope = {
  organizationId: string
  tenantId: string
  includeProspects?: boolean
}

const SALES_ROLES_CUSTOMER_ONLY = ['customer'] as const
const SALES_ROLES_INCLUDE_PROSPECTS = ['customer', 'prospect'] as const

function pickRoles(scope: { includeProspects?: boolean }): readonly string[] {
  return scope.includeProspects ? SALES_ROLES_INCLUDE_PROSPECTS : SALES_ROLES_CUSTOMER_ONLY
}

export async function getSalesCustomers(
  em: EntityManager,
  scope: SalesCustomerScope,
): Promise<CustomerEntity[]> {
  const acceptedRoles = pickRoles(scope)
  const roles = await findWithDecryption(
    em,
    CustomerEntityRole,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entityType: 'company',
      roleType: { $in: [...acceptedRoles] },
      deletedAt: null,
    } as Record<string, unknown>,
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!roles.length) return []

  const seen = new Set<string>()
  const entityIds: string[] = []
  for (const role of roles) {
    if (!role.entityId || seen.has(role.entityId)) continue
    seen.add(role.entityId)
    entityIds.push(role.entityId)
  }
  if (!entityIds.length) return []

  return findWithDecryption(
    em,
    CustomerEntity,
    {
      id: { $in: entityIds },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    } as Record<string, unknown>,
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

export async function isSalesCustomer(
  em: EntityManager,
  entityId: string,
  scope: { organizationId: string; tenantId: string; includeProspects?: boolean },
): Promise<boolean> {
  const acceptedRoles = pickRoles(scope)
  const role = await findOneWithDecryption(
    em,
    CustomerEntityRole,
    {
      entityId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      roleType: { $in: [...acceptedRoles] },
      deletedAt: null,
    } as Record<string, unknown>,
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return role !== null
}
