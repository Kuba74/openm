/**
 * Source-row shapes for the legacy erp-fromee Postgres schema.
 *
 * These mirror the Prisma table definitions from erp-fromee. Only the columns
 * we actually consume during the import are typed — the source database has
 * many more columns that we ignore on purpose.
 *
 * The shapes intentionally accept `null` for nullable columns (matching the
 * raw pg result) and decode JSONB blobs as `unknown` so mappers must validate
 * before access.
 */

export type ErpFromeeCompanyKind = 'ORGANIZATION' | 'PERSON'

export type ErpFromeeRoleType =
  | 'CUSTOMER'
  | 'SUPPLIER'
  | 'PROSPECT'
  | 'LEAD'
  | 'PARTNER'
  | 'CARRIER'
  | 'BANK'
  | 'INTERNAL'

export type ErpFromeeAddressType = 'PRIMARY' | 'INVOICE' | 'DELIVERY'

export type ErpFromeeCompany = {
  id: string
  companyNo: string | null
  kind: ErpFromeeCompanyKind
  legalName: string
  displayName: string | null
  shortName: string | null
  searchTerm: string | null
  taxId: string | null
  regon: string | null
  krs: string | null
  vatEu: string | null
  countryCode: string | null
  defaultLanguage: string | null
  isActive: boolean
  isBlocked: boolean
  note: string | null
  metadata: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export type ErpFromeeCompanyRole = {
  id: string
  companyId: string
  roleType: ErpFromeeRoleType
  isActive: boolean
  currency: string | null
  paymentTerms: string | null
  deliveryTerms: string | null
  priceGroup: string | null
  creditLimit: string | null
  createdAt: Date
}

export type ErpFromeeCompanyContact = {
  id: string
  companyId: string
  firstName: string | null
  lastName: string | null
  displayName: string | null
  jobTitle: string | null
  department: string | null
  contactFunction: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
  isActive: boolean
  metadata: Record<string, unknown> | null
  createdAt: Date
}

export type ErpFromeeCompanyAddress = {
  id: string
  companyId: string
  type: ErpFromeeAddressType
  label: string | null
  attentionOf: string | null
  name1: string | null
  name2: string | null
  street1: string | null
  street2: string | null
  postalCode: string | null
  city: string | null
  region: string | null
  countryCode: string | null
  latitude: number | null
  longitude: number | null
  isPrimary: boolean
  createdAt: Date
}

export type ErpFromeeCompanyBankAccount = {
  id: string
  companyId: string
  bankName: string | null
  iban: string | null
  swift: string | null
  isPrimary: boolean
  isActive: boolean
  createdAt: Date
}

export type ErpFromeeCompanySourceLink = {
  id: string
  companyId: string
  sourceSystem: string
  externalId: string
  lastSyncAt: Date | null
}

export type ErpFromeeBundle = {
  company: ErpFromeeCompany
  roles: ErpFromeeCompanyRole[]
  contacts: ErpFromeeCompanyContact[]
  addresses: ErpFromeeCompanyAddress[]
  bankAccounts: ErpFromeeCompanyBankAccount[]
  sourceLinks: ErpFromeeCompanySourceLink[]
}

export type ImportScope = {
  organizationId: string
  tenantId: string
}
