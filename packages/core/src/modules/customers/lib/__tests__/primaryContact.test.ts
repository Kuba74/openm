import {
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '@open-mercato/core/modules/customers/data/entities'
import { getPrimaryContact } from '../primaryContact'

type MockEntity = {
  id: string
  organizationId: string
  tenantId: string
}

type MockLink = {
  id: string
  organizationId: string
  tenantId: string
  isPrimary: boolean
  deletedAt: Date | null
  company: string | MockEntity
  person: MockEntity
}

type MockProfile = {
  id: string
  organizationId: string
  tenantId: string
  entity: MockEntity
  firstName: string
}

type Store = {
  links: MockLink[]
  profiles: MockProfile[]
}

function createMockEm(store: Store) {
  const findOne = jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
    if (cls === CustomerPersonCompanyLink) {
      return store.links.find((link) =>
        ((typeof link.company === 'string' ? link.company : link.company.id) === where.company) &&
        link.organizationId === where.organizationId &&
        link.tenantId === where.tenantId &&
        link.isPrimary === where.isPrimary &&
        link.deletedAt === where.deletedAt,
      ) ?? null
    }
    if (cls === CustomerPersonProfile) {
      return store.profiles.find((profile) =>
        profile.entity.id === (where.entity as MockEntity)?.id &&
        profile.organizationId === where.organizationId &&
        profile.tenantId === where.tenantId,
      ) ?? null
    }
    return null
  })

  return { findOne }
}

const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1' }

function makePerson(id: string): MockEntity {
  return { id, organizationId: SCOPE.organizationId, tenantId: SCOPE.tenantId }
}

describe('getPrimaryContact', () => {
  it('returns the person profile linked as primary contact for the company', async () => {
    const person = makePerson('person-1')
    const profile: MockProfile = {
      id: 'profile-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      entity: person,
      firstName: 'Anna',
    }
    const store: Store = {
      links: [
        {
          id: 'link-1',
          organizationId: SCOPE.organizationId,
          tenantId: SCOPE.tenantId,
          isPrimary: true,
          deletedAt: null,
          company: 'company-1',
          person,
        },
      ],
      profiles: [profile],
    }
    const em = createMockEm(store)

    const result = await getPrimaryContact(em as never, 'company-1', SCOPE)

    expect(result).toBe(profile)
  })

  it('returns null when no primary link exists', async () => {
    const person = makePerson('person-1')
    const store: Store = {
      links: [
        {
          id: 'link-secondary',
          organizationId: SCOPE.organizationId,
          tenantId: SCOPE.tenantId,
          isPrimary: false,
          deletedAt: null,
          company: 'company-1',
          person,
        },
      ],
      profiles: [],
    }
    const em = createMockEm(store)

    const result = await getPrimaryContact(em as never, 'company-1', SCOPE)
    expect(result).toBeNull()
  })

  it('returns null when the primary link is soft-deleted', async () => {
    const person = makePerson('person-1')
    const store: Store = {
      links: [
        {
          id: 'link-deleted',
          organizationId: SCOPE.organizationId,
          tenantId: SCOPE.tenantId,
          isPrimary: true,
          deletedAt: new Date(),
          company: 'company-1',
          person,
        },
      ],
      profiles: [],
    }
    const em = createMockEm(store)

    const result = await getPrimaryContact(em as never, 'company-1', SCOPE)
    expect(result).toBeNull()
  })

  it('returns null when the primary link references a person without a profile', async () => {
    const person = makePerson('person-orphan')
    const store: Store = {
      links: [
        {
          id: 'link-1',
          organizationId: SCOPE.organizationId,
          tenantId: SCOPE.tenantId,
          isPrimary: true,
          deletedAt: null,
          company: 'company-1',
          person,
        },
      ],
      profiles: [],
    }
    const em = createMockEm(store)

    const result = await getPrimaryContact(em as never, 'company-1', SCOPE)
    expect(result).toBeNull()
  })

  it('does not return primaries from another tenant', async () => {
    const person = makePerson('person-other')
    const profile: MockProfile = {
      id: 'profile-other',
      organizationId: SCOPE.organizationId,
      tenantId: 'tenant-2',
      entity: person,
      firstName: 'Other',
    }
    const store: Store = {
      links: [
        {
          id: 'link-other',
          organizationId: SCOPE.organizationId,
          tenantId: 'tenant-2',
          isPrimary: true,
          deletedAt: null,
          company: 'company-1',
          person,
        },
      ],
      profiles: [profile],
    }
    const em = createMockEm(store)

    const result = await getPrimaryContact(em as never, 'company-1', SCOPE)
    expect(result).toBeNull()
  })
})
