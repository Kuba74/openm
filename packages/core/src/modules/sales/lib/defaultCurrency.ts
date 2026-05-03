import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesSettings } from '../data/entities'

const PL_HARDCODED_FALLBACK = 'PLN'

export type CurrencyScope = {
  organizationId: string
  tenantId: string
}

/**
 * Resolve default currency for sales documents per (organization, tenant).
 * Returns SalesSettings.defaultCurrencyCode if configured, otherwise PLN
 * fallback. Use this when neither the request payload nor the customer
 * billing record carries an explicit currency.
 *
 * Lookup chain (highest priority first) — caller is responsible for the
 * upstream layers; this helper covers the SalesSettings + hardcoded
 * fallback only:
 *
 *   payload.currencyCode
 *     ?? customerBilling.preferredCurrency
 *     ?? getDefaultCurrency(em, scope)   // ← this helper
 *     ?? 'PLN' (hardcoded final)
 */
export async function getDefaultCurrency(
  em: EntityManager,
  scope: CurrencyScope,
): Promise<string> {
  const settings = await em.findOne(SalesSettings, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return settings?.defaultCurrencyCode ?? PL_HARDCODED_FALLBACK
}

export const SALES_DEFAULT_CURRENCY_FALLBACK = PL_HARDCODED_FALLBACK
