import type {
  ErpFromeeAddressType,
  ErpFromeeCompanyAddress,
  ImportScope,
} from '../types'

/**
 * Output shape: rows ready to be upserted into `customer_entity_addresses`.
 * One source `Company` produces 0..N address rows. Per-type primary uniqueness
 * is enforced at DB level by the partial unique index from Tydzień 1
 * (`(entity_id, address_type) WHERE is_primary = true AND deleted_at IS NULL`),
 * so we pre-emptively demote duplicates per type per D9.
 */
export type AddressRow = {
  externalAddressId: string             // erp-fromee CompanyAddress.id
  externalCompanyId: string             // erp-fromee Company.id (parent)
  organizationId: string
  tenantId: string
  addressType: 'office' | 'billing' | 'shipping' | 'other'
  label: string | null
  attentionOf: string | null
  name1: string | null
  name2: string | null
  street1: string | null
  street2: string | null
  postalCode: string | null
  city: string | null
  region: string | null
  countryCode: string                   // ISO-3166-1 alpha-2, fallback PL
  isPrimary: boolean
}

export type AddressesPlan = {
  rows: AddressRow[]
  warnings: string[]
}

/** D9: erp-fromee CompanyAddress.type → openm address_type dictionary slug. */
const ADDRESS_TYPE_MAP: Record<ErpFromeeAddressType, AddressRow['addressType']> = {
  PRIMARY: 'office',
  INVOICE: 'billing',
  DELIVERY: 'shipping',
}

function sanitize(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed : null
}

function normalizeCountry(raw: string | null | undefined): string {
  const cleaned = sanitize(raw)
  if (!cleaned) return 'PL'
  return cleaned.toUpperCase().slice(0, 2)
}

/**
 * Maps erp-fromee CompanyAddress rows for a single Company into openm
 * `customer_entity_addresses` rows.
 *
 * Decyzje aplikowane:
 * - **D9** Address type mapping `PRIMARY → office`, `INVOICE → billing`,
 *   `DELIVERY → shipping`. Unknown types fall back to `'other'` with a
 *   warning (defensive — production data only contains the 3 known types).
 * - **Per-type primary first-wins**: if a Company has multiple `isPrimary=true`
 *   addresses of the same `address_type`, the earliest by `createdAt ASC`
 *   stays primary; rest demoted with a warning. Auto-promote: if NO address
 *   of a given type is flagged primary, the earliest one becomes primary.
 *
 * Skipped fields (per audit, 0 production usage):
 * - `latitude`/`longitude` — never populated in source data
 *
 * 738/1140 source companies have zero addresses; this mapper returns an
 * empty plan in that case (no warning — matches the documented coverage).
 */
export function mapAddresses(
  source: { companyId: string; addresses: ErpFromeeCompanyAddress[] },
  scope: ImportScope,
): AddressesPlan {
  const rows: AddressRow[] = []
  const warnings: string[] = []

  if (source.addresses.length === 0) {
    return { rows, warnings }
  }

  // Sort by createdAt ASC for deterministic per-type primary selection.
  const sorted = [...source.addresses].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )

  // Group by mapped openm address_type to enforce per-type primary uniqueness.
  type Bucket = { type: AddressRow['addressType']; entries: ErpFromeeCompanyAddress[] }
  const buckets = new Map<AddressRow['addressType'], Bucket>()
  for (const addr of sorted) {
    let mapped: AddressRow['addressType'] | undefined = ADDRESS_TYPE_MAP[addr.type]
    if (!mapped) {
      mapped = 'other'
      warnings.push(
        `Address ${addr.id} (Company ${source.companyId}): unknown type "${addr.type}", defaulted to 'other'`,
      )
    }
    let bucket = buckets.get(mapped)
    if (!bucket) {
      bucket = { type: mapped, entries: [] }
      buckets.set(mapped, bucket)
    }
    bucket.entries.push(addr)
  }

  for (const [type, bucket] of buckets) {
    const explicitPrimaries = bucket.entries.filter((a) => a.isPrimary)
    let primaryId: string | null = null
    if (explicitPrimaries.length === 1) {
      primaryId = explicitPrimaries[0].id
    } else if (explicitPrimaries.length > 1) {
      primaryId = explicitPrimaries[0].id
      const demoted = explicitPrimaries.slice(1).map((a) => a.id)
      warnings.push(
        `Company ${source.companyId} (${type}): ${explicitPrimaries.length} primary addresses — kept ${primaryId} (earliest), demoted ${demoted.join(', ')}`,
      )
    } else {
      // Auto-promote earliest of this type as primary (silent: matches openm convention
      // that every entity has at least one primary per address_type when any exist).
      primaryId = bucket.entries[0].id
    }

    for (const addr of bucket.entries) {
      rows.push({
        externalAddressId: addr.id,
        externalCompanyId: source.companyId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        addressType: type,
        label: sanitize(addr.label),
        attentionOf: sanitize(addr.attentionOf),
        name1: sanitize(addr.name1),
        name2: sanitize(addr.name2),
        street1: sanitize(addr.street1),
        street2: sanitize(addr.street2),
        postalCode: sanitize(addr.postalCode),
        city: sanitize(addr.city),
        region: sanitize(addr.region),
        countryCode: normalizeCountry(addr.countryCode),
        isPrimary: addr.id === primaryId,
      })
    }
  }

  return { rows, warnings }
}

export const __testables = { sanitize, normalizeCountry, ADDRESS_TYPE_MAP }
