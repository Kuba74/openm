import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerCompanyBilling } from '../data/entities'

export const DEFAULT_OFFER_VALIDITY_DAYS = 30

export type CompanyBillingScope = {
  organizationId: string
  tenantId: string
}

async function loadBilling(
  em: EntityManager,
  companyEntityId: string,
  scope: CompanyBillingScope,
): Promise<CustomerCompanyBilling | null> {
  return findOneWithDecryption(
    em,
    CustomerCompanyBilling,
    {
      entity: companyEntityId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    } as Record<string, unknown>,
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

export async function getSalesOwner(
  em: EntityManager,
  companyEntityId: string,
  scope: CompanyBillingScope,
): Promise<string | null> {
  const billing = await loadBilling(em, companyEntityId, scope)
  return billing?.salesOwnerUserId ?? null
}

export async function getDefaultOfferValidityDays(
  em: EntityManager,
  companyEntityId: string,
  scope: CompanyBillingScope,
): Promise<number> {
  const billing = await loadBilling(em, companyEntityId, scope)
  const value = billing?.defaultOfferValidityDays
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  return DEFAULT_OFFER_VALIDITY_DAYS
}
