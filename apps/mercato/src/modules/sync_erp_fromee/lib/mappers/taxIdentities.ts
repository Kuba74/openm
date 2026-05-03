import type { ErpFromeeCompany, ImportScope } from '../types'

/**
 * Output shape: rows ready to be upserted into `customer_tax_identities`.
 * One source `Company` may produce 0..N tax identity rows depending on
 * which top-level columns are populated.
 */
export type TaxIdentityRow = {
  externalId: string                    // erp-fromee Company.id (parent reference)
  organizationId: string
  tenantId: string
  countryCode: string                   // ISO 3166-1 alpha-2
  kind: 'nip' | 'regon' | 'krs' | 'pesel' | 'vat_eu' | 'vat' | 'eori' | 'other'
  value: string                         // raw value, validation happens in command layer
  isPrimary: boolean
}

export type TaxIdentitiesPlan = {
  rows: TaxIdentityRow[]
  warnings: string[]
}

/**
 * Maps Company tax columns to tax identity rows.
 *
 * Per audit:
 *   - 212/1140 Company rows have populated `taxId` (NIP)
 *   - 61/1140 have `krs`
 *   - 0 have `regon` populated
 *   - 0 have `vatEu` populated separately (cross-border NIPs sit in `taxId`)
 *
 * D5: top-level columns are authoritative. We do NOT read tax IDs from
 * `Company.metadata` — only from `taxId/regon/krs/vatEu`. If a Company has
 * `metadata.taxId` that differs, the companyToPartner mapper logs the
 * conflict warning; this mapper trusts the column.
 *
 * Returned `value` strings are unsanitized — the command-layer zod schema
 * (taxIdentityCreateSchema) trims, validates checksum, and normalizes for
 * storage.
 */
export function mapTaxIdentities(
  source: ErpFromeeCompany,
  scope: ImportScope,
): TaxIdentitiesPlan {
  const rows: TaxIdentityRow[] = []
  const warnings: string[] = []

  const country = (source.countryCode ?? 'PL').toUpperCase()
  const baseId = source.id

  if (source.taxId && source.taxId.trim()) {
    rows.push({
      externalId: baseId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      countryCode: country,
      kind: 'nip',
      value: source.taxId.trim(),
      isPrimary: true,                  // NIP is canonical PL tax id
    })
  }

  if (source.regon && source.regon.trim()) {
    rows.push({
      externalId: baseId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      countryCode: country,
      kind: 'regon',
      value: source.regon.trim(),
      isPrimary: false,
    })
  } else if (source.regon === '') {
    // Empty string vs null: erp-fromee may store '' for "we asked, no value".
    // We don't import empty strings; no warning needed (treated as null).
  }

  if (source.krs && source.krs.trim()) {
    rows.push({
      externalId: baseId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      countryCode: country,
      kind: 'krs',
      value: source.krs.trim(),
      isPrimary: false,
    })
  }

  if (source.vatEu && source.vatEu.trim()) {
    rows.push({
      externalId: baseId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      countryCode: country,
      kind: 'vat_eu',
      value: source.vatEu.trim(),
      isPrimary: false,
    })
  }

  if (rows.length === 0 && source.kind === 'ORGANIZATION') {
    warnings.push(`Company ${baseId} (${source.legalName}) has no tax identifiers`)
  }

  return { rows, warnings }
}

export const __testables = {}
