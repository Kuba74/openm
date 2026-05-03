import { reclassifyJdgEntities } from '../jdgClassification'
import {
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerTaxIdentity,
} from '@open-mercato/core/modules/customers/data/entities'

type MockEntity = {
  id: string
  organizationId: string
  tenantId: string
  kind: 'person' | 'company'
  deletedAt: Date | null
  createdAt: Date
}

type MockTaxIdentity = {
  organizationId: string
  tenantId: string
  entity: MockEntity
  kind: string
  countryCode: string
  deletedAt: Date | null
}

type MockCompany = {
  organizationId: string
  tenantId: string
  entity: MockEntity
  legalForm: string | null
}

type Store = {
  entities: MockEntity[]
  taxIdentities: MockTaxIdentity[]
  companies: MockCompany[]
}

function createMockEm(store: Store) {
  const find = jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
    if (cls === CustomerEntity) {
      return store.entities.filter((entity) =>
        entity.organizationId === where.organizationId &&
        entity.tenantId === where.tenantId &&
        entity.kind === where.kind &&
        entity.deletedAt === where.deletedAt,
      )
    }
    return []
  })

  const findOne = jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
    if (cls === CustomerCompanyProfile) {
      return store.companies.find((company) =>
        company.organizationId === where.organizationId &&
        company.tenantId === where.tenantId &&
        company.entity === where.entity,
      ) ?? null
    }
    if (cls === CustomerTaxIdentity) {
      return store.taxIdentities.find((identity) =>
        identity.organizationId === where.organizationId &&
        identity.tenantId === where.tenantId &&
        identity.entity === where.entity &&
        identity.kind === where.kind &&
        identity.countryCode === where.countryCode &&
        identity.deletedAt === where.deletedAt,
      ) ?? null
    }
    return null
  })

  const persisted: unknown[] = []
  const persist = jest.fn((entity: unknown) => {
    persisted.push(entity)
  })

  const create = jest.fn((cls: unknown, data: Record<string, unknown>) => {
    if (cls === CustomerCompanyProfile) {
      const company: MockCompany = {
        organizationId: data.organizationId as string,
        tenantId: data.tenantId as string,
        entity: data.entity as MockEntity,
        legalForm: (data.legalForm as string | null) ?? null,
      }
      store.companies.push(company)
      return company
    }
    return data
  })

  const flush = jest.fn(async () => {
    persisted.length = 0
  })

  const transactional = jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => {
    return callback(em)
  })

  const em = { find, findOne, persist, create, flush, transactional }
  return em
}

function makeEntity(overrides: Partial<MockEntity> = {}): MockEntity {
  return {
    id: overrides.id ?? `entity-${Math.random().toString(36).slice(2, 10)}`,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    kind: 'person',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('reclassifyJdgEntities', () => {
  it('reclassifies a person entity that has a PL NIP into a JDG company', async () => {
    const personEntity = makeEntity({ id: 'p-1' })
    const store: Store = {
      entities: [personEntity],
      taxIdentities: [
        {
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          entity: personEntity,
          kind: 'NIP',
          countryCode: 'PL',
          deletedAt: null,
        },
      ],
      companies: [],
    }
    const em = createMockEm(store)

    const result = await reclassifyJdgEntities(em as never, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(result.considered).toBe(1)
    expect(result.reclassified).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.details).toEqual([
      { entityId: 'p-1', reason: 'reclassified' },
    ])
    expect(personEntity.kind).toBe('company')
    expect(store.companies).toHaveLength(1)
    expect(store.companies[0].legalForm).toBe('jdg')
    expect(store.companies[0].entity).toBe(personEntity)
  })

  it('skips a person entity that does not carry a PL NIP', async () => {
    const personEntity = makeEntity({ id: 'p-2' })
    const store: Store = {
      entities: [personEntity],
      taxIdentities: [],
      companies: [],
    }
    const em = createMockEm(store)

    const result = await reclassifyJdgEntities(em as never, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(result.considered).toBe(1)
    expect(result.reclassified).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.details).toEqual([{ entityId: 'p-2', reason: 'no-nip' }])
    expect(personEntity.kind).toBe('person')
    expect(store.companies).toHaveLength(0)
  })

  it('skips an entity that already has a customer_companies row', async () => {
    const personEntity = makeEntity({ id: 'p-3' })
    const store: Store = {
      entities: [personEntity],
      taxIdentities: [
        {
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          entity: personEntity,
          kind: 'NIP',
          countryCode: 'PL',
          deletedAt: null,
        },
      ],
      companies: [
        {
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          entity: personEntity,
          legalForm: 'sp_z_oo',
        },
      ],
    }
    const em = createMockEm(store)

    const result = await reclassifyJdgEntities(em as never, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(result.considered).toBe(1)
    expect(result.reclassified).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.details).toEqual([{ entityId: 'p-3', reason: 'already-company' }])
    expect(personEntity.kind).toBe('person')
    expect(store.companies).toHaveLength(1)
    expect(store.companies[0].legalForm).toBe('sp_z_oo')
  })

  it('is idempotent across repeated runs', async () => {
    const personEntity = makeEntity({ id: 'p-4' })
    const store: Store = {
      entities: [personEntity],
      taxIdentities: [
        {
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          entity: personEntity,
          kind: 'NIP',
          countryCode: 'PL',
          deletedAt: null,
        },
      ],
      companies: [],
    }
    const em = createMockEm(store)
    const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

    const firstRun = await reclassifyJdgEntities(em as never, scope)
    const secondRun = await reclassifyJdgEntities(em as never, scope)

    expect(firstRun.reclassified).toBe(1)
    expect(secondRun.considered).toBe(0)
    expect(secondRun.reclassified).toBe(0)
    expect(secondRun.skipped).toBe(0)
    expect(store.companies).toHaveLength(1)
  })

  it('does not cross tenant boundaries', async () => {
    const ownTenantEntity = makeEntity({ id: 'p-5', tenantId: 'tenant-1' })
    const otherTenantEntity = makeEntity({ id: 'p-6', tenantId: 'tenant-2' })
    const store: Store = {
      entities: [ownTenantEntity, otherTenantEntity],
      taxIdentities: [
        {
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          entity: ownTenantEntity,
          kind: 'NIP',
          countryCode: 'PL',
          deletedAt: null,
        },
        {
          organizationId: 'org-1',
          tenantId: 'tenant-2',
          entity: otherTenantEntity,
          kind: 'NIP',
          countryCode: 'PL',
          deletedAt: null,
        },
      ],
      companies: [],
    }
    const em = createMockEm(store)

    const result = await reclassifyJdgEntities(em as never, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(result.considered).toBe(1)
    expect(result.reclassified).toBe(1)
    expect(ownTenantEntity.kind).toBe('company')
    expect(otherTenantEntity.kind).toBe('person')
    expect(store.companies).toHaveLength(1)
    expect(store.companies[0].entity).toBe(ownTenantEntity)
  })
})
