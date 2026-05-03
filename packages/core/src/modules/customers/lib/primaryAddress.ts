import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerAddress } from '../data/entities'

export type PrimaryAddressKind = 'billing' | 'shipping' | 'office' | 'home' | 'work'

export type PrimaryAddressScope = {
  organizationId: string
  tenantId: string
}

const FALLBACK_ORDER: readonly PrimaryAddressKind[] = ['billing', 'office', 'work', 'home', 'shipping']

function buildFallbackChain(preferred: PrimaryAddressKind): readonly PrimaryAddressKind[] {
  const seen = new Set<PrimaryAddressKind>()
  const chain: PrimaryAddressKind[] = []
  for (const kind of [preferred, ...FALLBACK_ORDER]) {
    if (!seen.has(kind)) {
      seen.add(kind)
      chain.push(kind)
    }
  }
  return chain
}

async function findPrimaryByPurpose(
  em: EntityManager,
  entityId: string,
  scope: PrimaryAddressScope,
  purpose: PrimaryAddressKind,
): Promise<CustomerAddress | null> {
  return findOneWithDecryption(
    em,
    CustomerAddress,
    {
      entity: entityId,
      purpose,
      isPrimary: true,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    } as Record<string, unknown>,
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

export async function getDefaultOfferAddress(
  em: EntityManager,
  entityId: string,
  scope: PrimaryAddressScope,
  preferred: PrimaryAddressKind = 'billing',
): Promise<CustomerAddress | null> {
  for (const kind of buildFallbackChain(preferred)) {
    const address = await findPrimaryByPurpose(em, entityId, scope, kind)
    if (address) return address
  }
  return null
}
