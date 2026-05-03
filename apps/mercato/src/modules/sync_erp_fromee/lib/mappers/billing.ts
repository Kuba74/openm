import type {
  ErpFromeeCompany,
  ErpFromeeCompanyRole,
  ImportScope,
} from '../types'
import type { BankAccountRow } from './banks'

/**
 * Output shape: a single row destined for `customer_company_billing` (W1
 * 1:1 with `customer_entities` for kind=company). Only columns that exist
 * in the W1 schema are emitted; sales props that don't have a column
 * (deliveryTerms, priceGroup, creditLimit) are preserved in
 * `legacyExtras` so the pipeline can stash them in the entity metadata
 * blob — losing them silently would forfeit data that the customers
 * module is expected to surface eventually.
 */
export type BillingRow = {
  externalCompanyId: string             // erp-fromee Company.id (parent reference)
  organizationId: string
  tenantId: string
  bankName: string | null
  bankAccountMasked: string | null      // masked IBAN: 'PL61 ************ 2874'
  paymentTerms: string | null
  preferredCurrency: string | null      // ISO-4217 alpha-3, fallback PLN
  salesOwnerUserId: string | null       // pipeline resolves from auth context — mapper always emits null
  defaultOfferValidityDays: number      // W1 default = 30
  legacyExtras: BillingLegacyExtras
}

export type BillingLegacyExtras = {
  delivery_terms: string | null
  price_group: string | null
  credit_limit: string | null
  /** External bank id from the source row chosen as primary (FK back to BanksPlan.primary). */
  primary_bank_external_id: string | null
}

export type BillingPlan = {
  row: BillingRow | null
  warnings: string[]
}

/** W1 default per `customer_company_billing.default_offer_validity_days` column default. */
export const DEFAULT_OFFER_VALIDITY_DAYS = 30

/** Country-code fallback for preferred currency when CUSTOMER role lacks one. */
const COUNTRY_CURRENCY_FALLBACK: Record<string, string> = {
  PL: 'PLN',
  DE: 'EUR',
  AT: 'EUR',
  CZ: 'CZK',
  SK: 'EUR',
  HU: 'HUF',
  GB: 'GBP',
  US: 'USD',
}

function sanitize(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed : null
}

function normalizeCurrency(value: string | null | undefined): string | null {
  const cleaned = sanitize(value)
  if (!cleaned) return null
  return cleaned.toUpperCase().slice(0, 3)
}

/**
 * Mask an IBAN for display: keep the first 4 (country + check digits) and
 * last 4 chars; everything else is `*`. Empty / too-short IBANs return null.
 */
export function maskIban(iban: string | null): string | null {
  if (!iban) return null
  const cleaned = iban.replace(/\s+/g, '').toUpperCase()
  if (cleaned.length < 8) return null
  const head = cleaned.slice(0, 4)
  const tail = cleaned.slice(-4)
  const middleLen = Math.max(0, cleaned.length - 8)
  return `${head} ${'*'.repeat(middleLen)} ${tail}`
}

/**
 * Picks the dominant active CUSTOMER role for sales-side billing props.
 * If there are multiple active CUSTOMER roles (rare), the earliest by
 * `createdAt ASC` wins — same first-wins rule we use for primary contacts
 * and addresses for cross-mapper consistency.
 */
function pickCustomerRole(roles: ErpFromeeCompanyRole[]): ErpFromeeCompanyRole | null {
  const active = roles.filter((r) => r.isActive && r.roleType === 'CUSTOMER')
  if (active.length === 0) return null
  return [...active].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
}

function resolveCurrency(
  customerRole: ErpFromeeCompanyRole | null,
  source: ErpFromeeCompany,
): string {
  const fromRole = normalizeCurrency(customerRole?.currency)
  if (fromRole) return fromRole
  const country = (source.countryCode ?? '').toUpperCase()
  return COUNTRY_CURRENCY_FALLBACK[country] ?? 'PLN'
}

/**
 * Maps a Company (with its CompanyRole list and the BanksPlan primary
 * already resolved by the banks mapper) into a single
 * `customer_company_billing` row.
 *
 * Decyzje aplikowane:
 * - **W1 1:1** — every Company that survives previous mappers gets at most
 *   one billing row. Returns `null` when there is no signal at all (no
 *   primary bank AND no active CUSTOMER role with any populated sales
 *   prop) — avoids creating empty placeholder rows for companies that
 *   are pure leads / suppliers without billing data.
 * - **D10 single-bank** — IBAN comes from `BanksPlan.primary` (already
 *   normalized & broken-record-skipped by the banks mapper). The mapper
 *   stores the **masked** IBAN in `bank_account_masked`; the encrypted
 *   plain IBAN is the pipeline layer's responsibility (per D11) and is
 *   handled through a separate column or extension in Faza 4 multi-bank.
 * - **W1 helpers** — `salesOwnerUserId` always emitted as `null` here;
 *   the pipeline resolves the actual owner (e.g. from import scope's
 *   `userId` or a per-company override). `defaultOfferValidityDays`
 *   defaults to W1's `30` constant.
 * - **Currency fallback** — CUSTOMER role currency wins; otherwise we
 *   look up `Company.countryCode` against `COUNTRY_CURRENCY_FALLBACK`
 *   (PL→PLN, DE→EUR, …); ultimate fallback is `'PLN'` (matches GOREM
 *   PREFA fixture from the audit, which has currency NULL but is PL).
 * - **Sales props without a column** (`deliveryTerms`, `priceGroup`,
 *   `creditLimit`) — preserved on `legacyExtras` so the pipeline can
 *   stash them inside the entity-metadata blob without dropping data.
 */
export function mapBilling(
  source: ErpFromeeCompany,
  roles: ErpFromeeCompanyRole[],
  primaryBank: BankAccountRow | null,
  scope: ImportScope,
): BillingPlan {
  const warnings: string[] = []
  const customerRole = pickCustomerRole(roles)

  const paymentTerms = sanitize(customerRole?.paymentTerms)
  const deliveryTerms = sanitize(customerRole?.deliveryTerms)
  const priceGroup = sanitize(customerRole?.priceGroup)
  const creditLimit = sanitize(customerRole?.creditLimit)
  const hasSalesProp =
    paymentTerms !== null ||
    deliveryTerms !== null ||
    priceGroup !== null ||
    creditLimit !== null ||
    (customerRole?.currency != null && sanitize(customerRole.currency) !== null)

  if (!primaryBank && !hasSalesProp && !customerRole) {
    return { row: null, warnings }
  }

  if (!customerRole && primaryBank) {
    warnings.push(
      `Company ${source.id}: bank account present but no active CUSTOMER role — billing imported with bank only`,
    )
  }
  if (customerRole && !primaryBank) {
    warnings.push(
      `Company ${source.id}: active CUSTOMER role but no usable bank account — billing imported without bank`,
    )
  }

  const currency = resolveCurrency(customerRole, source)
  if (!normalizeCurrency(customerRole?.currency)) {
    warnings.push(
      `Company ${source.id}: CUSTOMER role currency missing — defaulted to ${currency}`,
    )
  }

  const row: BillingRow = {
    externalCompanyId: source.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    bankName: primaryBank?.bankName ?? null,
    bankAccountMasked: maskIban(primaryBank?.iban ?? null),
    paymentTerms,
    preferredCurrency: currency,
    salesOwnerUserId: null,
    defaultOfferValidityDays: DEFAULT_OFFER_VALIDITY_DAYS,
    legacyExtras: {
      delivery_terms: deliveryTerms,
      price_group: priceGroup,
      credit_limit: creditLimit,
      primary_bank_external_id: primaryBank?.externalBankId ?? null,
    },
  }

  return { row, warnings }
}

export const __testables = { sanitize, normalizeCurrency, pickCustomerRole, resolveCurrency, COUNTRY_CURRENCY_FALLBACK }
