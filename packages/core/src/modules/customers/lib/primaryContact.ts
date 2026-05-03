import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '../data/entities'

export type PrimaryContactScope = {
  organizationId: string
  tenantId: string
}

export async function getPrimaryContact(
  em: EntityManager,
  companyEntityId: string,
  scope: PrimaryContactScope,
): Promise<CustomerPersonProfile | null> {
  const link = await findOneWithDecryption(
    em,
    CustomerPersonCompanyLink,
    {
      company: companyEntityId,
      isPrimary: true,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    } as Record<string, unknown>,
    { populate: ['person'] },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!link) return null
  const personEntity = typeof link.person === 'string' ? null : (link.person as CustomerEntity | null)
  if (!personEntity) return null
  return findOneWithDecryption(
    em,
    CustomerPersonProfile,
    {
      entity: personEntity,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    } as Record<string, unknown>,
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}
