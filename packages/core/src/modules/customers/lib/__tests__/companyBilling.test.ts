import { CustomerCompanyBilling } from '@open-mercato/core/modules/customers/data/entities'
import {
  DEFAULT_OFFER_VALIDITY_DAYS,
  getDefaultOfferValidityDays,
  getSalesOwner,
} from '../companyBilling'

type MockBilling = {
  organizationId: string
  tenantId: string
  entity: string
  salesOwnerUserId: string | null
  defaultOfferValidityDays: number | null
}

type Store = {
  billings: MockBilling[]
}

function createMockEm(store: Store) {
  const findOne = jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
    if (cls !== CustomerCompanyBilling) return null
    return store.billings.find((billing) =>
      billing.organizationId === where.organizationId &&
      billing.tenantId === where.tenantId &&
      billing.entity === where.entity,
    ) ?? null
  })
  return { findOne }
}

const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1' }

describe('getSalesOwner', () => {
  it('returns the configured sales owner when present', async () => {
    const store: Store = {
      billings: [
        {
          organizationId: SCOPE.organizationId,
          tenantId: SCOPE.tenantId,
          entity: 'company-1',
          salesOwnerUserId: 'user-42',
          defaultOfferValidityDays: 30,
        },
      ],
    }
    const em = createMockEm(store)
    const result = await getSalesOwner(em as never, 'company-1', SCOPE)
    expect(result).toBe('user-42')
  })

  it('returns null when no billing record exists', async () => {
    const em = createMockEm({ billings: [] })
    const result = await getSalesOwner(em as never, 'company-2', SCOPE)
    expect(result).toBeNull()
  })

  it('returns null when billing exists but sales owner is missing', async () => {
    const store: Store = {
      billings: [
        {
          organizationId: SCOPE.organizationId,
          tenantId: SCOPE.tenantId,
          entity: 'company-3',
          salesOwnerUserId: null,
          defaultOfferValidityDays: 30,
        },
      ],
    }
    const em = createMockEm(store)
    const result = await getSalesOwner(em as never, 'company-3', SCOPE)
    expect(result).toBeNull()
  })

  it('does not return billing rows from another tenant', async () => {
    const store: Store = {
      billings: [
        {
          organizationId: SCOPE.organizationId,
          tenantId: 'tenant-2',
          entity: 'company-4',
          salesOwnerUserId: 'user-other',
          defaultOfferValidityDays: 30,
        },
      ],
    }
    const em = createMockEm(store)
    const result = await getSalesOwner(em as never, 'company-4', SCOPE)
    expect(result).toBeNull()
  })
})

describe('getDefaultOfferValidityDays', () => {
  it('returns the stored validity days when present', async () => {
    const store: Store = {
      billings: [
        {
          organizationId: SCOPE.organizationId,
          tenantId: SCOPE.tenantId,
          entity: 'company-1',
          salesOwnerUserId: null,
          defaultOfferValidityDays: 45,
        },
      ],
    }
    const em = createMockEm(store)
    const result = await getDefaultOfferValidityDays(em as never, 'company-1', SCOPE)
    expect(result).toBe(45)
  })

  it('falls back to the default when no billing row exists', async () => {
    const em = createMockEm({ billings: [] })
    const result = await getDefaultOfferValidityDays(em as never, 'company-2', SCOPE)
    expect(result).toBe(DEFAULT_OFFER_VALIDITY_DAYS)
  })

  it('falls back to the default when the stored value is null', async () => {
    const store: Store = {
      billings: [
        {
          organizationId: SCOPE.organizationId,
          tenantId: SCOPE.tenantId,
          entity: 'company-3',
          salesOwnerUserId: null,
          defaultOfferValidityDays: null,
        },
      ],
    }
    const em = createMockEm(store)
    const result = await getDefaultOfferValidityDays(em as never, 'company-3', SCOPE)
    expect(result).toBe(DEFAULT_OFFER_VALIDITY_DAYS)
  })

  it('falls back to the default when the stored value is non-positive', async () => {
    const store: Store = {
      billings: [
        {
          organizationId: SCOPE.organizationId,
          tenantId: SCOPE.tenantId,
          entity: 'company-4',
          salesOwnerUserId: null,
          defaultOfferValidityDays: 0,
        },
      ],
    }
    const em = createMockEm(store)
    const result = await getDefaultOfferValidityDays(em as never, 'company-4', SCOPE)
    expect(result).toBe(DEFAULT_OFFER_VALIDITY_DAYS)
  })
})
