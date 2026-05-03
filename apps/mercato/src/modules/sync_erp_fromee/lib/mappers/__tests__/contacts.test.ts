import { mapContacts, __testables } from '../contacts'
import type { ErpFromeeCompanyContact, ImportScope } from '../../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

function buildContact(overrides: Partial<ErpFromeeCompanyContact> = {}): ErpFromeeCompanyContact {
  return {
    id: 'contact_a',
    companyId: 'company_x',
    firstName: 'Jan',
    lastName: 'Kowalski',
    displayName: null,
    jobTitle: null,
    department: null,
    contactFunction: null,
    email: null,
    phone: null,
    isPrimary: false,
    isActive: true,
    metadata: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('buildDisplayName', () => {
  it('uses explicit displayName when available', () => {
    expect(__testables.buildDisplayName(buildContact({ displayName: 'Custom Name' }))).toBe('Custom Name')
  })

  it('falls back to firstName + lastName', () => {
    expect(__testables.buildDisplayName(buildContact({ firstName: 'Anna', lastName: 'Nowak' })))
      .toBe('Anna Nowak')
  })

  it('handles single-name fallback', () => {
    expect(__testables.buildDisplayName(buildContact({ firstName: null, lastName: 'Solo' }))).toBe('Solo')
    expect(__testables.buildDisplayName(buildContact({ firstName: 'Solo', lastName: null }))).toBe('Solo')
  })

  it('returns null when no name available', () => {
    expect(__testables.buildDisplayName(buildContact({
      firstName: null, lastName: null, displayName: null,
    }))).toBeNull()
  })

  it('sanitizes whitespace', () => {
    expect(__testables.buildDisplayName(buildContact({ displayName: '  Jan  \tKowalski  ' })))
      .toBe('Jan Kowalski')
  })
})

describe('mapContactFunction (D8)', () => {
  it('maps known German values to openm slugs', () => {
    expect(__testables.mapContactFunction('Architekt')).toEqual({ value: 'architect', warning: null })
    expect(__testables.mapContactFunction('Verkauf')).toEqual({ value: 'sales', warning: null })
    expect(__testables.mapContactFunction('Buchhaltung')).toEqual({ value: 'accounting', warning: null })
  })

  it('returns null when input is null', () => {
    expect(__testables.mapContactFunction(null)).toEqual({ value: null, warning: null })
  })

  it('falls back to "other" with warning for unknown values', () => {
    const result = __testables.mapContactFunction('Sonderaufgaben')
    expect(result.value).toBe('other')
    expect(result.warning).toContain('Sonderaufgaben')
  })
})

describe('mapContacts', () => {
  it('returns empty plan for no contacts', () => {
    const plan = mapContacts({ companyId: 'company_x', contacts: [] }, scope)
    expect(plan.persons).toHaveLength(0)
    expect(plan.links).toHaveLength(0)
  })

  it('maps a single contact with email + phone', () => {
    const plan = mapContacts({
      companyId: 'company_x',
      contacts: [buildContact({
        firstName: 'Jan', lastName: 'Kowalski',
        email: 'jan@example.com', phone: '+48 600 100 200',
        isPrimary: true,
      })],
    }, scope)
    expect(plan.persons).toHaveLength(1)
    expect(plan.persons[0]).toMatchObject({
      displayName: 'Jan Kowalski',
      primaryEmail: 'jan@example.com',
      primaryPhone: '+48 600 100 200',
      isActive: true,
    })
    expect(plan.profiles[0]).toMatchObject({ firstName: 'Jan', lastName: 'Kowalski' })
    expect(plan.links[0]).toMatchObject({
      externalContactId: 'contact_a',
      externalCompanyId: 'company_x',
      isPrimary: true,
    })
  })

  it('auto-promotes earliest active contact when no primary flagged', () => {
    const plan = mapContacts({
      companyId: 'company_y',
      contacts: [
        buildContact({ id: 'c2', createdAt: new Date('2024-06-01T00:00:00Z') }),
        buildContact({ id: 'c1', createdAt: new Date('2024-01-01T00:00:00Z') }),
        buildContact({ id: 'c3', createdAt: new Date('2024-12-01T00:00:00Z') }),
      ],
    }, scope)
    const primaryLink = plan.links.find((l) => l.isPrimary)
    expect(primaryLink?.externalContactId).toBe('c1')
    expect(plan.warnings.some((w) => w.includes('auto-promoted'))).toBe(true)
  })

  it('first-wins on multi-primary (D6)', () => {
    const plan = mapContacts({
      companyId: 'company_z',
      contacts: [
        buildContact({ id: 'c2', isPrimary: true, createdAt: new Date('2024-06-01') }),
        buildContact({ id: 'c1', isPrimary: true, createdAt: new Date('2024-01-01') }),
        buildContact({ id: 'c3', isPrimary: true, createdAt: new Date('2024-12-01') }),
      ],
    }, scope)
    const primaries = plan.links.filter((l) => l.isPrimary)
    expect(primaries).toHaveLength(1)
    expect(primaries[0].externalContactId).toBe('c1')
    const warning = plan.warnings.find((w) => w.includes('demoted'))
    expect(warning).toBeDefined()
    expect(warning).toContain('c2')
    expect(warning).toContain('c3')
  })

  it('respects single explicit primary (no auto-promote, no warning)', () => {
    const plan = mapContacts({
      companyId: 'company_w',
      contacts: [
        buildContact({ id: 'c1', isPrimary: false }),
        buildContact({ id: 'c2', isPrimary: true }),
      ],
    }, scope)
    expect(plan.links.find((l) => l.isPrimary)?.externalContactId).toBe('c2')
    expect(plan.warnings.filter((w) => w.includes('auto-promoted') || w.includes('demoted'))).toHaveLength(0)
  })

  it('imports inactive contacts but does not promote them', () => {
    const plan = mapContacts({
      companyId: 'company_v',
      contacts: [
        buildContact({ id: 'c1', isActive: false, isPrimary: true }),
        buildContact({ id: 'c2', isActive: true }),
      ],
    }, scope)
    expect(plan.persons).toHaveLength(2)
    expect(plan.persons.find((p) => p.externalId === 'c1')?.isActive).toBe(false)
    expect(plan.links.find((l) => l.isPrimary)?.externalContactId).toBe('c2')
  })

  it('emits person_company_role for known contactFunction', () => {
    const plan = mapContacts({
      companyId: 'company_x',
      contacts: [buildContact({ contactFunction: 'Architekt' })],
    }, scope)
    expect(plan.roles).toHaveLength(1)
    expect(plan.roles[0]).toMatchObject({
      externalContactId: 'contact_a',
      externalCompanyId: 'company_x',
      roleValue: 'architect',
    })
  })

  it('emits role + warning for unmapped contactFunction', () => {
    const plan = mapContacts({
      companyId: 'company_x',
      contacts: [buildContact({ contactFunction: 'Sonderaufgaben' })],
    }, scope)
    expect(plan.roles[0].roleValue).toBe('other')
    expect(plan.warnings.some((w) => w.includes('Unmapped contactFunction'))).toBe(true)
  })

  it('skips contact with no name, with warning', () => {
    const plan = mapContacts({
      companyId: 'company_x',
      contacts: [
        buildContact({ id: 'c_named' }),
        buildContact({ id: 'c_blank', firstName: null, lastName: null, displayName: null }),
      ],
    }, scope)
    expect(plan.persons).toHaveLength(1)
    expect(plan.persons[0].externalId).toBe('c_named')
    expect(plan.warnings.some((w) => w.includes('no name available') && w.includes('c_blank'))).toBe(true)
  })

  it('preserves external_id refs in metadata', () => {
    const plan = mapContacts({
      companyId: 'company_xyz',
      contacts: [buildContact({ id: 'cont_abc' })],
    }, scope)
    const meta = plan.persons[0].metadata
    expect((meta.external_links as Record<string, unknown>).erp_fromee_contact_id).toBe('cont_abc')
    expect((meta.external_links as Record<string, unknown>).erp_fromee_company_id).toBe('company_xyz')
  })

  it('passes scope IDs through', () => {
    const plan = mapContacts({
      companyId: 'company_x',
      contacts: [buildContact()],
    }, scope)
    expect(plan.persons[0].organizationId).toBe(scope.organizationId)
    expect(plan.persons[0].tenantId).toBe(scope.tenantId)
    expect(plan.links[0].organizationId).toBe(scope.organizationId)
    expect(plan.links[0].tenantId).toBe(scope.tenantId)
  })

  it('handles contact without contactFunction (no role row, no warning)', () => {
    const plan = mapContacts({
      companyId: 'company_x',
      contacts: [buildContact({ contactFunction: null })],
    }, scope)
    expect(plan.roles).toHaveLength(0)
    expect(plan.warnings.filter((w) => w.includes('contactFunction'))).toHaveLength(0)
  })

  it('emits roles for all 10 known German contactFunctions', () => {
    const germanValues = [
      'Architekt', 'Statiker', 'Bauherr', 'Verkauf', 'Einkauf',
      'Buchhaltung', 'Qualität', 'Logistik', 'Technik', 'Sonstige',
    ]
    const plan = mapContacts({
      companyId: 'company_all',
      contacts: germanValues.map((fn, i) => buildContact({
        id: `c${i}`,
        contactFunction: fn,
        firstName: `Person${i}`,
        lastName: 'Test',
      })),
    }, scope)
    expect(plan.roles).toHaveLength(10)
    expect(plan.roles.map((r) => r.roleValue).sort()).toEqual([
      'accounting', 'architect', 'logistics', 'other', 'procurement',
      'project_owner', 'quality', 'sales', 'structural_engineer', 'technical',
    ])
    // No 'Unmapped' warnings (Sonstige is in the map → 'other')
    expect(plan.warnings.filter((w) => w.includes('Unmapped'))).toHaveLength(0)
  })
})
