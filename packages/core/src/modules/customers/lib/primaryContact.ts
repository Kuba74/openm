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

export type PrimaryContactCard = {
  id: string
  displayName: string
  email: string | null
  phone: string | null
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

function composeDisplayName(
  profile: CustomerPersonProfile | null,
  fallback: string,
): string {
  if (!profile) return fallback
  const parts: string[] = []
  const first = profile.preferredName ?? profile.firstName
  if (typeof first === 'string' && first.trim().length > 0) parts.push(first.trim())
  if (typeof profile.lastName === 'string' && profile.lastName.trim().length > 0) {
    parts.push(profile.lastName.trim())
  }
  const composed = parts.join(' ').trim()
  return composed.length > 0 ? composed : fallback
}

export async function getPrimaryContactCard(
  em: EntityManager,
  companyEntityId: string,
  scope: PrimaryContactScope,
): Promise<PrimaryContactCard | null> {
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
  const profile = await findOneWithDecryption(
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
  return {
    id: personEntity.id,
    displayName: composeDisplayName(profile, personEntity.displayName),
    email: personEntity.primaryEmail ?? null,
    phone: personEntity.primaryPhone ?? null,
  }
}
