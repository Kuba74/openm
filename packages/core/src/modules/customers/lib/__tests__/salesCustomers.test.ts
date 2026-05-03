import {
  CustomerEntity,
  CustomerEntityRole,
} from '@open-mercato/core/modules/customers/data/entities'
import { getSalesCustomers, isSalesCustomer } from '../salesCustomers'

type MockEntity = {
  id: string
  organizationId: string
  tenantId: string
  kind: 'person' | 'company'
  deletedAt: Date | null
}

type MockRole = {
  id: string
  entityType: string
  entityId: string
  organizationId: string
  tenantId: string
  roleType: string
  deletedAt: Date | null
}

type Store = {
  entities: MockEntity[]
  roles: MockRole[]
}

function matchesIn(filter: unknown, value: unknown): boolean {
  if (filter && typeof filter === 'object' && '$in' in (filter as Record<string, unknown>)) {
    const list = (filter as { $in: unknown[] }).$in
    return Array.isArray(list) && list.includes(value)
  }
  return false
}

function createMockEm(store: Store) {
  const find = jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
    if (cls === CustomerEntityRole) {
      return store.roles.filter((role) =>
        role.organizationId === where.organizationId &&
        role.tenantId === where.tenantId &&
        role.entityType === where.entityType &&
        role.deletedAt === where.deletedAt &&
        matchesIn(where.roleType, role.roleType),
      )
    }
    if (cls === CustomerEntity) {
      return store.entities.filter((entity) =>
        entity.organizationId === where.organizationId &&
        entity.tenantId === where.tenantId &&
        entity.deletedAt === where.deletedAt &&
        matchesIn(where.id, entity.id),
      )
    }
    return []
  })

  const findOne = jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
    if (cls === CustomerEntityRole) {
      return store.roles.find((role) =>
        role.organizationId === where.organizationId &&
        role.tenantId === where.tenantId &&
        role.entityId === where.entityId &&
        role.deletedAt === where.deletedAt &&
        matchesIn(where.roleType, role.roleType),
      ) ?? null
    }
    return null
  })

  return { find, findOne }
}

function makeEntity(overrides: Partial<MockEntity> = {}): MockEntity {
  return {
    id: overrides.id ?? `entity-${Math.random().toString(36).slice(2, 10)}`,
    organizationId: overrides.organizationId ?? 'org-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    kind: overrides.kind ?? 'company',
    deletedAt: overrides.deletedAt ?? null,
  }
}

function makeRole(overrides: Partial<MockRole> = {}): MockRole {
  return {
    id: overrides.id ?? `role-${Math.random().toString(36).slice(2, 10)}`,
    entityType: overrides.entityType ?? 'company',
    entityId: overrides.entityId ?? 'entity-1',
    organizationId: overrides.organizationId ?? 'org-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    roleType: overrides.roleType ?? 'customer',
    deletedAt: overrides.deletedAt ?? null,
  }
}

describe('getSalesCustomers', () => {
  it('returns an empty list when no roles match', async () => {
    const store: Store = { entities: [], roles: [] }
    const em = createMockEm(store)
    const result = await getSalesCustomers(em as never, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
    expect(result).toEqual([])
  })

  it('returns only entities flagged with the customer role', async () => {
    const customer = makeEntity({ id: 'company-customer' })
    const prospect = makeEntity({ id: 'company-prospect' })
    const supplier = makeEntity({ id: 'company-supplier' })
    const store: Store = {
      entities: [customer, prospect, supplier],
      roles: [
        makeRole({ entityId: customer.id, roleType: 'customer' }),
        makeRole({ entityId: prospect.id, roleType: 'prospect' }),
        makeRole({ entityId: supplier.id, roleType: 'supplier' }),
      ],
    }
    const em = createMockEm(store)

    const result = await getSalesCustomers(em as never, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(result.map((entity) => entity.id)).toEqual([customer.id])
  })

  it('includes prospects when includeProspects is true', async () => {
    const customer = makeEntity({ id: 'company-customer' })
    const prospect = makeEntity({ id: 'company-prospect' })
    const supplier = makeEntity({ id: 'company-supplier' })
    const store: Store = {
      entities: [customer, prospect, supplier],
      roles: [
        makeRole({ entityId: customer.id, roleType: 'customer' }),
        makeRole({ entityId: prospect.id, roleType: 'prospect' }),
        makeRole({ entityId: supplier.id, roleType: 'supplier' }),
      ],
    }
    const em = createMockEm(store)

    const result = await getSalesCustomers(em as never, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      includeProspects: true,
    })

    expect(result.map((entity) => entity.id).sort()).toEqual([customer.id, prospect.id].sort())
  })

  it('excludes soft-deleted roles', async () => {
    const customer = makeEntity({ id: 'company-customer' })
    const store: Store = {
      entities: [customer],
      roles: [
        makeRole({ entityId: customer.id, roleType: 'customer', deletedAt: new Date() }),
      ],
    }
    const em = createMockEm(store)

    const result = await getSalesCustomers(em as never, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(result).toEqual([])
  })

  it('isolates results across tenants', async () => {
    const ownTenant = makeEntity({ id: 'company-own', tenantId: 'tenant-1' })
    const otherTenant = makeEntity({ id: 'company-other', tenantId: 'tenant-2' })
    const store: Store = {
      entities: [ownTenant, otherTenant],
      roles: [
        makeRole({ entityId: ownTenant.id, tenantId: 'tenant-1' }),
        makeRole({ entityId: otherTenant.id, tenantId: 'tenant-2' }),
      ],
    }
    const em = createMockEm(store)

    const result = await getSalesCustomers(em as never, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(result.map((entity) => entity.id)).toEqual([ownTenant.id])
  })

  it('deduplicates when the same entity has multiple matching roles', async () => {
    const customer = makeEntity({ id: 'company-multi' })
    const store: Store = {
      entities: [customer],
      roles: [
        makeRole({ id: 'role-1', entityId: customer.id, roleType: 'customer' }),
        makeRole({ id: 'role-2', entityId: customer.id, roleType: 'prospect' }),
      ],
    }
    const em = createMockEm(store)

    const result = await getSalesCustomers(em as never, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      includeProspects: true,
    })

    expect(result.map((entity) => entity.id)).toEqual([customer.id])
  })
})

describe('isSalesCustomer', () => {
  it('returns true when an active customer role exists', async () => {
    const store: Store = {
      entities: [],
      roles: [makeRole({ entityId: 'entity-1', roleType: 'customer' })],
    }
    const em = createMockEm(store)

    const result = await isSalesCustomer(em as never, 'entity-1', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(result).toBe(true)
  })

  it('returns false when only a prospect role exists and prospects are excluded', async () => {
    const store: Store = {
      entities: [],
      roles: [makeRole({ entityId: 'entity-1', roleType: 'prospect' })],
    }
    const em = createMockEm(store)

    const result = await isSalesCustomer(em as never, 'entity-1', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(result).toBe(false)
  })

  it('returns true when prospects are included and a prospect role exists', async () => {
    const store: Store = {
      entities: [],
      roles: [makeRole({ entityId: 'entity-1', roleType: 'prospect' })],
    }
    const em = createMockEm(store)

    const result = await isSalesCustomer(em as never, 'entity-1', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      includeProspects: true,
    })

    expect(result).toBe(true)
  })

  it('returns false for a soft-deleted role', async () => {
    const store: Store = {
      entities: [],
      roles: [makeRole({ entityId: 'entity-1', roleType: 'customer', deletedAt: new Date() })],
    }
    const em = createMockEm(store)

    const result = await isSalesCustomer(em as never, 'entity-1', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(result).toBe(false)
  })
})
