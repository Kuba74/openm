import {
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '@open-mercato/core/modules/customers/data/entities'
import { getPrimaryContact, getPrimaryContactCard } from '../primaryContact'

type MockEntity = {
  id: string
  organizationId: string
  tenantId: string
  displayName?: string
  primaryEmail?: string | null
  primaryPhone?: string | null
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
  firstName?: string | null
  lastName?: string | null
  preferredName?: string | null
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

function makePerson(id: string, overrides?: Partial<MockEntity>): MockEntity {
  return {
    id,
    organizationId: SCOPE.organizationId,
    tenantId: SCOPE.tenantId,
    displayName: id,
    primaryEmail: null,
    primaryPhone: null,
    ...overrides,
  }
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

describe('getPrimaryContactCard', () => {
  it('returns id, composed name, email and phone for the primary contact', async () => {
    const person = makePerson('person-1', {
      displayName: 'Anna Kowalska',
      primaryEmail: 'anna@example.com',
      primaryPhone: '+48-600-100-200',
    })
    const profile: MockProfile = {
      id: 'profile-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      entity: person,
      firstName: 'Anna',
      lastName: 'Kowalska',
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

    const result = await getPrimaryContactCard(em as never, 'company-1', SCOPE)

    expect(result).toEqual({
      id: 'person-1',
      displayName: 'Anna Kowalska',
      email: 'anna@example.com',
      phone: '+48-600-100-200',
    })
  })

  it('prefers preferredName over firstName when composing the display name', async () => {
    const person = makePerson('person-2', { displayName: 'Krzysztof Nowak' })
    const profile: MockProfile = {
      id: 'profile-2',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      entity: person,
      firstName: 'Krzysztof',
      preferredName: 'Krzyś',
      lastName: 'Nowak',
    }
    const store: Store = {
      links: [
        {
          id: 'link-2',
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

    const result = await getPrimaryContactCard(em as never, 'company-1', SCOPE)
    expect(result?.displayName).toBe('Krzyś Nowak')
  })

  it('falls back to entity displayName when the profile has no name parts', async () => {
    const person = makePerson('person-3', { displayName: 'Acme Owner' })
    const profile: MockProfile = {
      id: 'profile-3',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      entity: person,
      firstName: null,
      lastName: null,
      preferredName: null,
    }
    const store: Store = {
      links: [
        {
          id: 'link-3',
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

    const result = await getPrimaryContactCard(em as never, 'company-1', SCOPE)
    expect(result?.displayName).toBe('Acme Owner')
  })

  it('falls back to entity displayName when no profile exists', async () => {
    const person = makePerson('person-4', {
      displayName: 'Solo Contact',
      primaryEmail: 'solo@example.com',
    })
    const store: Store = {
      links: [
        {
          id: 'link-4',
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

    const result = await getPrimaryContactCard(em as never, 'company-1', SCOPE)
    expect(result).toEqual({
      id: 'person-4',
      displayName: 'Solo Contact',
      email: 'solo@example.com',
      phone: null,
    })
  })

  it('returns null when no primary link exists', async () => {
    const person = makePerson('person-5')
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

    const result = await getPrimaryContactCard(em as never, 'company-1', SCOPE)
    expect(result).toBeNull()
  })

  it('returns null for soft-deleted primary links', async () => {
    const person = makePerson('person-6')
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

    const result = await getPrimaryContactCard(em as never, 'company-1', SCOPE)
    expect(result).toBeNull()
  })

  it('does not cross tenant boundary', async () => {
    const person = makePerson('person-7', {
      tenantId: 'tenant-2',
      organizationId: SCOPE.organizationId,
    })
    const store: Store = {
      links: [
        {
          id: 'link-7',
          organizationId: SCOPE.organizationId,
          tenantId: 'tenant-2',
          isPrimary: true,
          deletedAt: null,
          company: 'company-1',
          person,
        },
      ],
      profiles: [],
    }
    const em = createMockEm(store)

    const result = await getPrimaryContactCard(em as never, 'company-1', SCOPE)
    expect(result).toBeNull()
  })
})
