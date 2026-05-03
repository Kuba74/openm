import { mapAddresses, __testables } from '../addresses'
import type { ErpFromeeCompanyAddress, ImportScope } from '../../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

function buildAddress(overrides: Partial<ErpFromeeCompanyAddress> = {}): ErpFromeeCompanyAddress {
  return {
    id: 'addr_a',
    companyId: 'company_x',
    type: 'PRIMARY',
    label: null,
    attentionOf: null,
    name1: null,
    name2: null,
    street1: 'ul. Testowa 1',
    street2: null,
    postalCode: '00-001',
    city: 'Warszawa',
    region: null,
    countryCode: 'PL',
    latitude: null,
    longitude: null,
    isPrimary: false,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    ...overrides,
  }
}

describe('sanitize', () => {
  it('trims and collapses whitespace', () => {
    expect(__testables.sanitize('  ul.   Testowa   1  ')).toBe('ul. Testowa 1')
  })
  it('returns null for empty/null', () => {
    expect(__testables.sanitize(null)).toBeNull()
    expect(__testables.sanitize('')).toBeNull()
    expect(__testables.sanitize('   ')).toBeNull()
  })
})

describe('normalizeCountry', () => {
  it('uppercases and limits to 2 chars', () => {
    expect(__testables.normalizeCountry('pl')).toBe('PL')
    expect(__testables.normalizeCountry('Pol')).toBe('PO') // defensive slice
  })
  it('falls back to PL when missing', () => {
    expect(__testables.normalizeCountry(null)).toBe('PL')
    expect(__testables.normalizeCountry('')).toBe('PL')
  })
})

describe('ADDRESS_TYPE_MAP', () => {
  it('covers all 3 erp-fromee types per D9', () => {
    expect(__testables.ADDRESS_TYPE_MAP.PRIMARY).toBe('office')
    expect(__testables.ADDRESS_TYPE_MAP.INVOICE).toBe('billing')
    expect(__testables.ADDRESS_TYPE_MAP.DELIVERY).toBe('shipping')
  })
})

describe('mapAddresses', () => {
  it('returns empty plan for company with no addresses (738/1140 case)', () => {
    const plan = mapAddresses({ companyId: 'company_x', addresses: [] }, scope)
    expect(plan.rows).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  it('maps PRIMARY → office, INVOICE → billing, DELIVERY → shipping', () => {
    const plan = mapAddresses({
      companyId: 'company_x',
      addresses: [
        buildAddress({ id: 'a1', type: 'PRIMARY' }),
        buildAddress({ id: 'a2', type: 'INVOICE', createdAt: new Date('2024-01-02T10:00:00Z') }),
        buildAddress({ id: 'a3', type: 'DELIVERY', createdAt: new Date('2024-01-03T10:00:00Z') }),
      ],
    }, scope)
    expect(plan.rows).toHaveLength(3)
    expect(plan.rows.map((r) => r.addressType).sort()).toEqual(['billing', 'office', 'shipping'])
  })

  it('auto-promotes earliest as primary per type when none flagged', () => {
    const plan = mapAddresses({
      companyId: 'company_x',
      addresses: [
        buildAddress({ id: 'a1', type: 'PRIMARY', createdAt: new Date('2024-01-02T10:00:00Z') }),
        buildAddress({ id: 'a2', type: 'PRIMARY', createdAt: new Date('2024-01-01T10:00:00Z') }),
      ],
    }, scope)
    expect(plan.rows.find((r) => r.externalAddressId === 'a2')?.isPrimary).toBe(true)
    expect(plan.rows.find((r) => r.externalAddressId === 'a1')?.isPrimary).toBe(false)
  })

  it('per-type primary first-wins when multiple flagged primary', () => {
    const plan = mapAddresses({
      companyId: 'company_x',
      addresses: [
        buildAddress({ id: 'a1', type: 'PRIMARY', isPrimary: true, createdAt: new Date('2024-01-02T10:00:00Z') }),
        buildAddress({ id: 'a2', type: 'PRIMARY', isPrimary: true, createdAt: new Date('2024-01-01T10:00:00Z') }),
        buildAddress({ id: 'a3', type: 'PRIMARY', isPrimary: true, createdAt: new Date('2024-01-03T10:00:00Z') }),
      ],
    }, scope)
    expect(plan.rows.find((r) => r.externalAddressId === 'a2')?.isPrimary).toBe(true)
    expect(plan.rows.filter((r) => r.isPrimary)).toHaveLength(1)
    expect(plan.warnings.some((w) => w.includes('demoted a1, a3'))).toBe(true)
  })

  it('separate primary per type — INVOICE primary independent of PRIMARY', () => {
    const plan = mapAddresses({
      companyId: 'company_x',
      addresses: [
        buildAddress({ id: 'a1', type: 'PRIMARY', isPrimary: true }),
        buildAddress({ id: 'a2', type: 'INVOICE', isPrimary: true }),
      ],
    }, scope)
    expect(plan.rows.filter((r) => r.isPrimary)).toHaveLength(2)
  })

  it('sanitizes street/city/postalCode', () => {
    const plan = mapAddresses({
      companyId: 'company_x',
      addresses: [buildAddress({
        id: 'a1',
        street1: '  ul.   Testowa   1  ',
        city: '  Warszawa  ',
        postalCode: ' 00-001 ',
      })],
    }, scope)
    expect(plan.rows[0].street1).toBe('ul. Testowa 1')
    expect(plan.rows[0].city).toBe('Warszawa')
    expect(plan.rows[0].postalCode).toBe('00-001')
  })

  it('preserves DE address with PL countryCode (D11 leave-as-is for Nuckel Architekten Hamburg)', () => {
    const plan = mapAddresses({
      companyId: 'cmnaqmwwc00eilgqqx3yix94p',
      addresses: [buildAddress({
        id: 'addr_nuckel',
        city: 'Hamburg',
        countryCode: 'PL',
      })],
    }, scope)
    expect(plan.rows[0].countryCode).toBe('PL')
    expect(plan.rows[0].city).toBe('Hamburg')
  })

  it('falls back to PL when countryCode missing', () => {
    const plan = mapAddresses({
      companyId: 'company_x',
      addresses: [buildAddress({ id: 'a1', countryCode: null })],
    }, scope)
    expect(plan.rows[0].countryCode).toBe('PL')
  })

  it('does not emit lat/lng (skipped per audit, 0 production usage)', () => {
    const plan = mapAddresses({
      companyId: 'company_x',
      addresses: [buildAddress({ id: 'a1', latitude: 52.2297, longitude: 21.0122 })],
    }, scope)
    const row = plan.rows[0] as Record<string, unknown>
    expect(row.latitude).toBeUndefined()
    expect(row.longitude).toBeUndefined()
  })

  it('passes organizationId/tenantId from scope', () => {
    const plan = mapAddresses({
      companyId: 'company_x',
      addresses: [buildAddress()],
    }, scope)
    expect(plan.rows[0].organizationId).toBe(scope.organizationId)
    expect(plan.rows[0].tenantId).toBe(scope.tenantId)
  })

  it('passes externalCompanyId for FK resolution', () => {
    const plan = mapAddresses({
      companyId: 'cmnap2afj009alghtzdrdtjwp',
      addresses: [buildAddress({ id: 'addr_constar' })],
    }, scope)
    expect(plan.rows[0].externalCompanyId).toBe('cmnap2afj009alghtzdrdtjwp')
    expect(plan.rows[0].externalAddressId).toBe('addr_constar')
  })

  it('handles unknown address type defensively → "other" with warning', () => {
    const plan = mapAddresses({
      companyId: 'company_x',
      addresses: [buildAddress({ id: 'a1', type: 'WAREHOUSE' as never })],
    }, scope)
    expect(plan.rows[0].addressType).toBe('other')
    expect(plan.warnings.some((w) => w.includes('unknown type "WAREHOUSE"'))).toBe(true)
  })
})
