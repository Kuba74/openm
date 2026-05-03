import { CustomerAddress } from '@open-mercato/core/modules/customers/data/entities'
import { getDefaultOfferAddress } from '../primaryAddress'

type MockAddress = {
  id: string
  organizationId: string
  tenantId: string
  entity: string
  purpose: string
  isPrimary: boolean
  deletedAt: Date | null
}

type Store = {
  addresses: MockAddress[]
}

function createMockEm(store: Store) {
  const findOne = jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
    if (cls !== CustomerAddress) return null
    return store.addresses.find((address) =>
      address.entity === where.entity &&
      address.purpose === where.purpose &&
      address.isPrimary === where.isPrimary &&
      address.organizationId === where.organizationId &&
      address.tenantId === where.tenantId &&
      address.deletedAt === where.deletedAt,
    ) ?? null
  })
  return { findOne }
}

const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1' }
const ENTITY_ID = 'entity-1'

function makeAddress(
  overrides: Partial<MockAddress> & Pick<MockAddress, 'id' | 'purpose'>,
): MockAddress {
  return {
    organizationId: SCOPE.organizationId,
    tenantId: SCOPE.tenantId,
    entity: ENTITY_ID,
    isPrimary: true,
    deletedAt: null,
    ...overrides,
  }
}

describe('getDefaultOfferAddress', () => {
  it('returns the preferred-purpose primary address when present', async () => {
    const billing = makeAddress({ id: 'addr-billing', purpose: 'billing' })
    const office = makeAddress({ id: 'addr-office', purpose: 'office' })
    const em = createMockEm({ addresses: [billing, office] })

    const result = await getDefaultOfferAddress(em as never, ENTITY_ID, SCOPE)

    expect(result).toBe(billing)
  })

  it('falls back through the chain when the preferred purpose is missing', async () => {
    const office = makeAddress({ id: 'addr-office', purpose: 'office' })
    const home = makeAddress({ id: 'addr-home', purpose: 'home' })
    const em = createMockEm({ addresses: [office, home] })

    const result = await getDefaultOfferAddress(em as never, ENTITY_ID, SCOPE, 'billing')

    expect(result).toBe(office)
  })

  it('honors a non-default preferred purpose first', async () => {
    const billing = makeAddress({ id: 'addr-billing', purpose: 'billing' })
    const shipping = makeAddress({ id: 'addr-shipping', purpose: 'shipping' })
    const em = createMockEm({ addresses: [billing, shipping] })

    const result = await getDefaultOfferAddress(em as never, ENTITY_ID, SCOPE, 'shipping')

    expect(result).toBe(shipping)
  })

  it('returns null when no active primary address is found', async () => {
    const em = createMockEm({ addresses: [] })
    const result = await getDefaultOfferAddress(em as never, ENTITY_ID, SCOPE)
    expect(result).toBeNull()
  })

  it('skips soft-deleted primary addresses', async () => {
    const billing = makeAddress({
      id: 'addr-billing',
      purpose: 'billing',
      deletedAt: new Date(),
    })
    const office = makeAddress({ id: 'addr-office', purpose: 'office' })
    const em = createMockEm({ addresses: [billing, office] })

    const result = await getDefaultOfferAddress(em as never, ENTITY_ID, SCOPE)

    expect(result).toBe(office)
  })

  it('does not return primary addresses for another entity', async () => {
    const otherEntity = makeAddress({ id: 'addr-other', purpose: 'billing', entity: 'entity-2' })
    const em = createMockEm({ addresses: [otherEntity] })

    const result = await getDefaultOfferAddress(em as never, ENTITY_ID, SCOPE)

    expect(result).toBeNull()
  })

  it('does not return primary addresses from another tenant', async () => {
    const billing = makeAddress({ id: 'addr-billing', purpose: 'billing', tenantId: 'tenant-2' })
    const em = createMockEm({ addresses: [billing] })

    const result = await getDefaultOfferAddress(em as never, ENTITY_ID, SCOPE)

    expect(result).toBeNull()
  })
})
