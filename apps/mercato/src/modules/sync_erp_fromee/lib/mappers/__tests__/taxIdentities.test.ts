import { mapTaxIdentities } from '../taxIdentities'
import type { ErpFromeeCompany, ImportScope } from '../../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

function buildCompany(overrides: Partial<ErpFromeeCompany> = {}): ErpFromeeCompany {
  return {
    id: 'cuid_a',
    companyNo: null,
    kind: 'ORGANIZATION',
    legalName: 'Acme',
    displayName: null,
    shortName: null,
    searchTerm: null,
    taxId: null,
    regon: null,
    krs: null,
    vatEu: null,
    countryCode: 'PL',
    defaultLanguage: null,
    isActive: true,
    isBlocked: false,
    note: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('mapTaxIdentities', () => {
  it('emits NIP row when taxId is populated', () => {
    const plan = mapTaxIdentities(buildCompany({ taxId: '5260250995' }), scope)
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0]).toMatchObject({
      kind: 'nip',
      countryCode: 'PL',
      value: '5260250995',
      isPrimary: true,
      externalId: 'cuid_a',
    })
  })

  it('emits NIP + KRS when both populated', () => {
    const plan = mapTaxIdentities(buildCompany({
      taxId: '5260250995',
      krs: '0000123456',
    }), scope)
    expect(plan.rows).toHaveLength(2)
    expect(plan.rows.map((r) => r.kind)).toEqual(['nip', 'krs'])
    expect(plan.rows[1]).toMatchObject({ kind: 'krs', value: '0000123456', isPrimary: false })
  })

  it('emits no rows when all tax columns null (PERSON without NIP)', () => {
    const plan = mapTaxIdentities(buildCompany({ kind: 'PERSON', taxId: null }), scope)
    expect(plan.rows).toHaveLength(0)
    // No warning for PERSON — companyToPartner already handles manual_review.
    expect(plan.warnings).toHaveLength(0)
  })

  it('warns when ORGANIZATION has no tax identifiers', () => {
    const plan = mapTaxIdentities(buildCompany({ legalName: 'NoTaxOrg' }), scope)
    expect(plan.rows).toHaveLength(0)
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toContain('NoTaxOrg')
  })

  it('respects countryCode from source (uppercased)', () => {
    const plan = mapTaxIdentities(buildCompany({ taxId: '123', countryCode: 'de' }), scope)
    expect(plan.rows[0].countryCode).toBe('DE')
  })

  it('falls back to PL when countryCode is null', () => {
    const plan = mapTaxIdentities(buildCompany({ taxId: '5260250995', countryCode: null }), scope)
    expect(plan.rows[0].countryCode).toBe('PL')
  })

  it('emits VAT-EU row when vatEu is populated separately', () => {
    const plan = mapTaxIdentities(buildCompany({ vatEu: 'DE123456789' }), scope)
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0]).toMatchObject({ kind: 'vat_eu', value: 'DE123456789' })
  })

  it('emits REGON when regon column is populated (zero in current dataset but mapper supports it)', () => {
    const plan = mapTaxIdentities(buildCompany({ regon: '012345678' }), scope)
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0]).toMatchObject({ kind: 'regon', value: '012345678', isPrimary: false })
  })

  it('trims whitespace from values', () => {
    const plan = mapTaxIdentities(buildCompany({ taxId: '  5260250995  ' }), scope)
    expect(plan.rows[0].value).toBe('5260250995')
  })

  it('treats empty string as null (no row)', () => {
    const plan = mapTaxIdentities(buildCompany({ taxId: '   ', regon: '' }), scope)
    expect(plan.rows).toHaveLength(0)
  })

  it('emits NIP+KRS+VAT-EU all together when populated', () => {
    const plan = mapTaxIdentities(buildCompany({
      taxId: '5260250995',
      krs: '0000123456',
      vatEu: 'PL5260250995',
    }), scope)
    expect(plan.rows).toHaveLength(3)
    expect(plan.rows.map((r) => r.kind)).toEqual(['nip', 'krs', 'vat_eu'])
  })

  it('only NIP marked isPrimary; others isPrimary=false', () => {
    const plan = mapTaxIdentities(buildCompany({
      taxId: '5260250995',
      krs: '0000123456',
      vatEu: 'PL5260250995',
    }), scope)
    const primary = plan.rows.filter((r) => r.isPrimary)
    expect(primary).toHaveLength(1)
    expect(primary[0].kind).toBe('nip')
  })

  it('passes externalId from source.id for parent reference', () => {
    const plan = mapTaxIdentities(buildCompany({ id: 'company_xyz', taxId: '5260250995' }), scope)
    expect(plan.rows[0].externalId).toBe('company_xyz')
  })

  it('passes organizationId/tenantId from scope', () => {
    const plan = mapTaxIdentities(buildCompany({ taxId: '5260250995' }), scope)
    expect(plan.rows[0].organizationId).toBe(scope.organizationId)
    expect(plan.rows[0].tenantId).toBe(scope.tenantId)
  })
})
