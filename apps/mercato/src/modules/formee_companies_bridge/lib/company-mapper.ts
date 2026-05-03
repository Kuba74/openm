import type { FormeeCompanyRow } from './formee-prisma'

export type MercatoCompanyCreatePayload = {
  organizationId: string
  tenantId: string
  displayName: string
  description?: string | null
  legalName?: string | null
  brandName?: string | null
  domain?: string | null
  industry?: string | null
  isActive?: boolean
  customFields?: Record<string, unknown>
}

const FORMEE_KIND_TO_INDUSTRY_HINT: Record<string, string | null> = {
  ORGANIZATION: null,
  CUSTOMER: 'customer',
  SUPPLIER: 'supplier',
  PARTNER: 'partner',
}

function pickDisplayName(row: FormeeCompanyRow): string {
  return (
    row.displayName?.trim() ||
    row.shortName?.trim() ||
    row.legalName?.trim() ||
    row.companyNo?.trim() ||
    `Formee company ${row.id}`
  )
}

function buildDescription(row: FormeeCompanyRow): string | null {
  const fragments: string[] = []
  if (row.note) fragments.push(row.note)
  if (row.companyNo) fragments.push(`Formee No: ${row.companyNo}`)
  if (row.taxId) fragments.push(`NIP: ${row.taxId}`)
  if (row.regon) fragments.push(`REGON: ${row.regon}`)
  if (row.krs) fragments.push(`KRS: ${row.krs}`)
  if (row.vatEu) fragments.push(`VAT-EU: ${row.vatEu}`)
  return fragments.length > 0 ? fragments.join(' · ') : null
}

export function mapFormeeCompanyToMercato(
  row: FormeeCompanyRow,
  scope: { tenantId: string; organizationId: string },
): MercatoCompanyCreatePayload {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    displayName: pickDisplayName(row),
    description: buildDescription(row),
    legalName: row.legalName ?? null,
    brandName: row.shortName ?? null,
    isActive: row.isActive && !row.isBlocked,
    customFields: {
      formee_legacy_id: row.id,
      formee_company_no: row.companyNo,
      formee_kind: row.kind,
      formee_industry_hint: FORMEE_KIND_TO_INDUSTRY_HINT[row.kind] ?? null,
      tax_id: row.taxId,
      regon: row.regon,
      krs: row.krs,
      vat_eu: row.vatEu,
      country_code: row.countryCode ?? 'PL',
      default_language: row.defaultLanguage,
      legacy_metadata: row.metadata,
      legacy_created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      legacy_updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    },
  }
}
