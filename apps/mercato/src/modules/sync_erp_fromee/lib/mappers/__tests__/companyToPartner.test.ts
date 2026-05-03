import { mapCompanyToPartner, __testables } from '../companyToPartner'
import type { ErpFromeeCompany, ImportScope } from '../../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

function buildCompany(overrides: Partial<ErpFromeeCompany> = {}): ErpFromeeCompany {
  return {
    id: 'cuid_test',
    companyNo: 'C001',
    kind: 'ORGANIZATION',
    legalName: 'Acme Sp. z o.o.',
    displayName: 'Acme',
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
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('sanitize', () => {
  it('returns null for empty values', () => {
    expect(__testables.sanitize(null)).toBeNull()
    expect(__testables.sanitize(undefined)).toBeNull()
    expect(__testables.sanitize('   ')).toBeNull()
    expect(__testables.sanitize('')).toBeNull()
  })

  it('trims and collapses whitespace', () => {
    expect(__testables.sanitize('  Acme   Sp.   z o.o.  ')).toBe('Acme Sp. z o.o.')
    expect(__testables.sanitize('\nLine\t\twith\ttabs\n')).toBe('Line with tabs')
  })
})

describe('mapLegalForm', () => {
  it('maps known PL forms to slugs', () => {
    expect(__testables.mapLegalForm('Sp. z o.o.')).toBe('sp_z_oo')
    expect(__testables.mapLegalForm('S.A.')).toBe('s_a')
    expect(__testables.mapLegalForm('JDG')).toBe('jdg')
    expect(__testables.mapLegalForm('GmbH')).toBe('gmbh')
  })

  it('falls back to lowercase slug for unknown forms', () => {
    expect(__testables.mapLegalForm('Spółdzielnia')).toBe('sp_dzielnia')
    expect(__testables.mapLegalForm('Custom Form 42')).toBe('custom_form_42')
  })

  it('returns null for empty input', () => {
    expect(__testables.mapLegalForm(null)).toBeNull()
    expect(__testables.mapLegalForm('   ')).toBeNull()
  })
})

describe('mapEntityType', () => {
  it('maps known typPodmiotu values', () => {
    expect(__testables.mapEntityType('Firma')).toBe('organization')
    expect(__testables.mapEntityType('Osoba prywatna')).toBe('consumer')
  })

  it('returns null for unknown values', () => {
    expect(__testables.mapEntityType('Unknown')).toBeNull()
    expect(__testables.mapEntityType(null)).toBeNull()
  })
})

describe('splitDisplayName', () => {
  it('splits into first + last for two parts', () => {
    expect(__testables.splitDisplayName('Jan Kowalski')).toEqual({ firstName: 'Jan', lastName: 'Kowalski' })
  })

  it('handles single-name input', () => {
    expect(__testables.splitDisplayName('Madonna')).toEqual({ firstName: 'Madonna', lastName: null })
  })

  it('joins multi-word last name', () => {
    expect(__testables.splitDisplayName('Anna Maria von Habsburg')).toEqual({
      firstName: 'Anna',
      lastName: 'Maria von Habsburg',
    })
  })
})

describe('mapCompanyToPartner', () => {
  it('maps a basic ORGANIZATION row', () => {
    const plan = mapCompanyToPartner(buildCompany(), scope)
    expect(plan.skip).toBe(false)
    expect(plan.entity?.kind).toBe('company')
    expect(plan.entity?.displayName).toBe('Acme')
    expect(plan.entity?.metadata.external_id).toBe('cuid_test')
    expect(plan.entity?.metadata.source).toBe('erp_fromee')
    expect(plan.profile?.kind).toBe('company')
  })

  it('reclassifies PERSON+NIP as company+jdg (D2)', () => {
    const plan = mapCompanyToPartner(buildCompany({
      kind: 'PERSON',
      taxId: '5260250995',
      legalName: 'Jan Kowalski',
      displayName: 'Jan Kowalski JDG',
    }), scope)
    expect(plan.skip).toBe(false)
    expect(plan.entity?.kind).toBe('company')
    expect(plan.profile).toMatchObject({ kind: 'company', legalForm: 'jdg' })
  })

  it('keeps PERSON without NIP as person + warning', () => {
    const plan = mapCompanyToPartner(buildCompany({
      kind: 'PERSON',
      taxId: null,
      displayName: 'Jan Kowalski',
    }), scope)
    expect(plan.skip).toBe(false)
    expect(plan.entity?.kind).toBe('person')
    expect(plan.warnings.some((w) => w.includes('manual review'))).toBe(true)
    expect(plan.profile).toMatchObject({ kind: 'person', firstName: 'Jan', lastName: 'Kowalski' })
  })

  it('skips Formee self-reference (D13)', () => {
    const plan = mapCompanyToPartner(buildCompany({ displayName: 'Formee Sp. z o.o.' }), scope)
    expect(plan.skip).toBe(true)
    expect(plan.skipReason).toBe('formee-self')
  })

  it('skips test data (D12)', () => {
    expect(mapCompanyToPartner(buildCompany({ displayName: 'Test Customer 1' }), scope).skip).toBe(true)
    expect(mapCompanyToPartner(buildCompany({ displayName: 'smoke-fixture' }), scope).skip).toBe(true)
    // Case-insensitive
    expect(mapCompanyToPartner(buildCompany({ displayName: 'TEST_DATA' }), scope).skip).toBe(true)
  })

  it('skips when both displayName and legalName are missing', () => {
    const plan = mapCompanyToPartner(buildCompany({ displayName: null, legalName: '   ' }), scope)
    expect(plan.skip).toBe(true)
    expect(plan.skipReason).toBe('missing-display-name')
  })

  it('warns on tax ID mismatch (D5)', () => {
    const plan = mapCompanyToPartner(buildCompany({
      taxId: '5260250995',
      metadata: { taxId: '9999999999', legacyKlientFirmaId: '42' },
    }), scope)
    expect(plan.warnings.some((w) => w.includes('Tax ID mismatch'))).toBe(true)
    expect((plan.entity?.metadata.external_links as Record<string, unknown>).legacy_klient_firma_id).toBe('42')
  })

  it('extracts polish metadata into customer_companies columns (D5 chain)', () => {
    const plan = mapCompanyToPartner(buildCompany({
      metadata: {
        formaPrawna: 'Sp. z o.o.',
        typPodmiotu: 'Firma',
        pelnyAdresKRS: 'ul. Przykładowa 1, 00-001 Warszawa',
      },
    }), scope)
    expect(plan.profile).toMatchObject({
      kind: 'company',
      legalForm: 'sp_z_oo',
      entityType: 'organization',
      fullAddressKrs: 'ul. Przykładowa 1, 00-001 Warszawa',
    })
  })

  it('preserves isBlocked in metadata.is_blocked (G1 gap, Phase 4)', () => {
    const plan = mapCompanyToPartner(buildCompany({ isBlocked: true }), scope)
    expect(plan.entity?.metadata.is_blocked).toBe(true)
  })

  it('sanitizes whitespace in displayName', () => {
    const plan = mapCompanyToPartner(buildCompany({ displayName: '  Acme  \tSp.  z  o.o.  ' }), scope)
    expect(plan.entity?.displayName).toBe('Acme Sp. z o.o.')
  })

  it('sets external_links.erp_fromee_company_id', () => {
    const plan = mapCompanyToPartner(buildCompany({ id: 'cuid_xyz' }), scope)
    expect((plan.entity?.metadata.external_links as Record<string, unknown>).erp_fromee_company_id).toBe('cuid_xyz')
  })
})
