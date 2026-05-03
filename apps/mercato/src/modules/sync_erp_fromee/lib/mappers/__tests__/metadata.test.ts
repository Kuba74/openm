import { mapMetadata, __testables } from '../metadata'
import type {
  ErpFromeeCompany,
  ErpFromeeCompanySourceLink,
  ImportScope,
} from '../../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

function buildCompany(overrides: Partial<ErpFromeeCompany> = {}): ErpFromeeCompany {
  return {
    id: 'company_x',
    companyNo: 'C-001',
    kind: 'ORGANIZATION',
    legalName: 'Test Sp. z o.o.',
    displayName: 'Test',
    shortName: null,
    searchTerm: null,
    taxId: '5260250996',
    regon: null,
    krs: null,
    vatEu: null,
    countryCode: 'PL',
    defaultLanguage: 'pl',
    isActive: true,
    isBlocked: false,
    note: null,
    metadata: null,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-06-15T12:30:00Z'),
    ...overrides,
  }
}

function buildLink(overrides: Partial<ErpFromeeCompanySourceLink> = {}): ErpFromeeCompanySourceLink {
  return {
    id: 'link_a',
    companyId: 'company_x',
    sourceSystem: 'salesforce',
    externalId: 'sf_001',
    lastSyncAt: new Date('2024-05-01T08:00:00Z'),
    ...overrides,
  }
}

describe('sanitizeString', () => {
  it('trims and returns null for empty', () => {
    expect(__testables.sanitizeString('  hello  ')).toBe('hello')
    expect(__testables.sanitizeString('   ')).toBeNull()
    expect(__testables.sanitizeString('')).toBeNull()
  })
  it('returns null for non-strings', () => {
    expect(__testables.sanitizeString(42)).toBeNull()
    expect(__testables.sanitizeString(null)).toBeNull()
    expect(__testables.sanitizeString(undefined)).toBeNull()
  })
})

describe('pruneLegacyMetadata', () => {
  it('strips promoted keys', () => {
    const pruned = __testables.pruneLegacyMetadata({
      legacyKlientFirmaId: 'KF-1',
      taxId: '999',
      regon: '111',
      krs: '222',
      vatEu: 'PL999',
      statusRelacji: 'klient',
      branzaKod: 'IT',
    })
    expect(pruned).toEqual({ statusRelacji: 'klient', branzaKod: 'IT' })
  })
  it('returns null when only promoted keys present', () => {
    const pruned = __testables.pruneLegacyMetadata({ legacyKlientFirmaId: 'KF-1', taxId: '999' })
    expect(pruned).toBeNull()
  })
  it('returns null for null/empty input', () => {
    expect(__testables.pruneLegacyMetadata(null)).toBeNull()
    expect(__testables.pruneLegacyMetadata({})).toBeNull()
  })
})

describe('PROMOTED_METADATA_KEYS', () => {
  it('lists all 5 promoted keys per D5', () => {
    expect(__testables.PROMOTED_METADATA_KEYS.size).toBe(5)
    expect(__testables.PROMOTED_METADATA_KEYS.has('legacyKlientFirmaId')).toBe(true)
    expect(__testables.PROMOTED_METADATA_KEYS.has('taxId')).toBe(true)
    expect(__testables.PROMOTED_METADATA_KEYS.has('regon')).toBe(true)
    expect(__testables.PROMOTED_METADATA_KEYS.has('krs')).toBe(true)
    expect(__testables.PROMOTED_METADATA_KEYS.has('vatEu')).toBe(true)
  })
})

describe('mapMetadata', () => {
  it('always anchors external_links with ambient erp_fromee link (D3)', () => {
    const plan = mapMetadata(buildCompany(), [], scope)
    expect(plan.metadata.external_links).toEqual([
      { source_system: 'erp_fromee', external_id: 'company_x', last_sync_at: null },
    ])
  })

  it('appends CompanySourceLink rows (99%-of-companies single-link case)', () => {
    const plan = mapMetadata(buildCompany(), [buildLink()], scope)
    expect(plan.metadata.external_links).toHaveLength(2)
    expect(plan.metadata.external_links[0]).toMatchObject({ source_system: 'erp_fromee' })
    expect(plan.metadata.external_links[1]).toMatchObject({
      source_system: 'salesforce',
      external_id: 'sf_001',
      last_sync_at: '2024-05-01T08:00:00.000Z',
    })
  })

  it('handles multi-source companies (rare but legit per D3)', () => {
    const plan = mapMetadata(buildCompany(), [
      buildLink({ id: 'l1', sourceSystem: 'salesforce', externalId: 'sf_001' }),
      buildLink({ id: 'l2', sourceSystem: 'hubspot', externalId: 'hs_999', lastSyncAt: null }),
    ], scope)
    expect(plan.metadata.external_links).toHaveLength(3)
    expect(plan.metadata.external_links.map((l) => l.source_system).sort()).toEqual([
      'erp_fromee', 'hubspot', 'salesforce',
    ])
    expect(plan.metadata.external_links.find((l) => l.source_system === 'hubspot')?.last_sync_at).toBeNull()
  })

  it('drops CompanySourceLink with missing sourceSystem with warning', () => {
    const plan = mapMetadata(buildCompany(), [buildLink({ id: 'l1', sourceSystem: '' })], scope)
    expect(plan.metadata.external_links).toHaveLength(1)
    expect(plan.warnings.some((w) => w.includes('dropped CompanySourceLink l1'))).toBe(true)
  })

  it('deduplicates links sharing source_system + external_id', () => {
    const plan = mapMetadata(buildCompany(), [
      buildLink({ id: 'l1', sourceSystem: 'salesforce', externalId: 'sf_001' }),
      buildLink({ id: 'l2', sourceSystem: 'salesforce', externalId: 'sf_001' }),
    ], scope)
    expect(plan.metadata.external_links).toHaveLength(2) // ambient + 1 unique salesforce
  })

  it('surfaces legacy_klient_firma_id from source metadata (D5 audit trail)', () => {
    const plan = mapMetadata(
      buildCompany({ metadata: { legacyKlientFirmaId: 'KF-12345' } }),
      [],
      scope,
    )
    expect(plan.metadata.legacy_klient_firma_id).toBe('KF-12345')
  })

  it('returns null legacy_klient_firma_id when not present', () => {
    const plan = mapMetadata(buildCompany({ metadata: { other: 'value' } }), [], scope)
    expect(plan.metadata.legacy_klient_firma_id).toBeNull()
  })

  it('strips promoted keys from legacy_metadata (D5)', () => {
    const plan = mapMetadata(
      buildCompany({
        metadata: {
          legacyKlientFirmaId: 'KF-1',
          taxId: '999',
          statusRelacji: 'klient',
          branzaKod: 'IT',
        },
      }),
      [],
      scope,
    )
    expect(plan.metadata.legacy_metadata).toEqual({
      statusRelacji: 'klient',
      branzaKod: 'IT',
    })
  })

  it('emits null legacy_metadata when source had only promoted keys', () => {
    const plan = mapMetadata(
      buildCompany({ metadata: { legacyKlientFirmaId: 'KF-1', taxId: '999' } }),
      [],
      scope,
    )
    expect(plan.metadata.legacy_metadata).toBeNull()
  })

  it('passes through legacy_created_at and legacy_updated_at as ISO strings', () => {
    const plan = mapMetadata(
      buildCompany({
        createdAt: new Date('2020-03-15T08:00:00Z'),
        updatedAt: new Date('2024-12-01T16:45:00Z'),
      }),
      [],
      scope,
    )
    expect(plan.metadata.legacy_created_at).toBe('2020-03-15T08:00:00.000Z')
    expect(plan.metadata.legacy_updated_at).toBe('2024-12-01T16:45:00.000Z')
  })

  it('always tags legacy_source_system as erp_fromee', () => {
    const plan = mapMetadata(buildCompany(), [], scope)
    expect(plan.metadata.legacy_source_system).toBe('erp_fromee')
  })

  it('preserves externalId for FK resolution', () => {
    const plan = mapMetadata(
      buildCompany({ id: 'cmnap2afj009alghtzdrdtjwp' }),
      [],
      scope,
    )
    expect(plan.externalId).toBe('cmnap2afj009alghtzdrdtjwp')
  })

  it('passes organizationId/tenantId from scope', () => {
    const plan = mapMetadata(buildCompany(), [], scope)
    expect(plan.organizationId).toBe(scope.organizationId)
    expect(plan.tenantId).toBe(scope.tenantId)
  })

  it('handles GOREM PREFA-style companies with null currency in metadata (defensive null source.metadata)', () => {
    const plan = mapMetadata(
      buildCompany({ id: 'cmnap2c7r05tmlghthjjwshzg', metadata: null }),
      [],
      scope,
    )
    expect(plan.metadata.legacy_metadata).toBeNull()
    expect(plan.metadata.legacy_klient_firma_id).toBeNull()
    expect(plan.metadata.external_links).toHaveLength(1)
  })
})
