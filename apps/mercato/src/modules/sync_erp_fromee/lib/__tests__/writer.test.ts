/**
 * Unit testy writera. Używamy mocked EntityManager + CommandBus — nie
 * tykamy realnej bazy. Testy sprawdzają:
 *  - idempotency check (source = 'erp_fromee:<id>')
 *  - delegację do `customers.companies.create` / `customers.people.create`
 *  - bezpośrednie inserts dla taxIdentities / addresses / billing
 *  - skip-handling (plan-skip, manual-review, no-entity)
 *  - failure handling
 */
import {
  writeImportPlan,
  writeAllPlans,
  summarizeWrites,
  buildSourceKey,
  buildContactSourceKey,
  SOURCE_PREFIX,
} from '../writer'
import type { CompanyImportPlan } from '../pipeline'
import type { ImportScope } from '../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

type MockEm = {
  fork: () => MockEm
  findOne: jest.Mock
  create: jest.Mock
  flush: jest.Mock
  getReference: jest.Mock
  __created: { entityName: string; payload: Record<string, unknown> }[]
}

function makeEm(overrides: Partial<MockEm> = {}): MockEm {
  const created: { entityName: string; payload: Record<string, unknown> }[] = []
  const em: MockEm = {
    fork: () => em,
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((entity, payload) => {
      const entityName = typeof entity === 'function' ? (entity as { name?: string }).name ?? 'unknown' : String(entity)
      created.push({ entityName, payload })
      return payload
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity, id) => ({ __ref: id })),
    __created: created,
    ...overrides,
  }
  return em
}

function makeCommandBus(handlers: Record<string, (input: unknown) => unknown>) {
  return {
    execute: jest.fn().mockImplementation(async (commandId: string, options: { input: unknown; ctx: unknown }) => {
      const handler = handlers[commandId]
      if (!handler) throw new Error(`No mock handler for ${commandId}`)
      return { result: handler(options.input), logEntry: null }
    }),
  }
}

function buildPlan(overrides: Partial<CompanyImportPlan> = {}): CompanyImportPlan {
  return {
    externalCompanyId: 'company_x',
    status: 'imported',
    partner: {
      skip: false,
      warnings: [],
      entity: {
        externalId: 'company_x',
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        kind: 'company',
        displayName: 'Test Sp. z o.o.',
        description: null,
        primaryEmail: null,
        primaryPhone: null,
        isActive: true,
        metadata: {},
      },
      profile: {
        kind: 'company',
        legalName: 'Test Sp. z o.o.',
        brandName: null,
        legalForm: 'sp_z_oo',
        entityType: 'organization',
        fullAddressKrs: null,
      },
    },
    taxIdentities: { rows: [], warnings: [] },
    roles: { skip: false, rows: [], primaryLifecycleStage: 'customer', warnings: [] },
    contacts: { persons: [], profiles: [], links: [], roles: [], warnings: [] },
    addresses: { rows: [], warnings: [] },
    banks: { primary: null, skipped: [], warnings: [] },
    billing: { row: null, warnings: [] },
    metadata: {
      externalId: 'company_x',
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      metadata: {
        external_links: [],
        legacy_klient_firma_id: null,
        legacy_metadata: null,
        legacy_created_at: '2024-01-01T00:00:00.000Z',
        legacy_updated_at: '2024-01-01T00:00:00.000Z',
        legacy_source_system: 'erp_fromee',
      },
      warnings: [],
    },
    warnings: [],
    ...overrides,
  }
}

describe('buildSourceKey', () => {
  it('formats source key z prefiksem erp_fromee', () => {
    expect(buildSourceKey('cmnxxx')).toBe('erp_fromee:cmnxxx')
    expect(SOURCE_PREFIX).toBe('erp_fromee')
  })
})

describe('writeImportPlan — idempotency', () => {
  it('zwraca idempotent-skip jeśli entity już istnieje', async () => {
    const em = makeEm({
      findOne: jest.fn().mockResolvedValue({ id: 'existing-uuid' }),
    })
    const commandBus = makeCommandBus({})
    const result = await writeImportPlan(buildPlan(), scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    expect(result.status).toBe('idempotent-skip')
    expect(result.entityId).toBe('existing-uuid')
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('idempotency query używa source = erp_fromee:<externalId>', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    await writeImportPlan(buildPlan({ externalCompanyId: 'cmnabc123' }), scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: 'erp_fromee:cmnabc123',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
    )
  })
})

describe('writeImportPlan — skip handling', () => {
  it('plan-skip dla planów ze statusem skipped', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({})
    const result = await writeImportPlan(
      buildPlan({ status: 'skipped', skipReason: 'formee-self' }),
      scope,
      { em: em as never, commandBus: commandBus as never, container: { resolve: jest.fn() } },
    )
    expect(result.status).toBe('plan-skip')
    expect(result.reason).toBe('formee-self')
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('plan-skip dla planów ze statusem manual_review', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({})
    const result = await writeImportPlan(
      buildPlan({ status: 'manual_review', manualReviewReason: 'person-without-nip' }),
      scope,
      { em: em as never, commandBus: commandBus as never, container: { resolve: jest.fn() } },
    )
    expect(result.status).toBe('plan-skip')
    expect(result.reason).toBe('person-without-nip')
  })

  it('plan-skip gdy partner.entity brak', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({})
    const result = await writeImportPlan(
      buildPlan({
        partner: { skip: false, warnings: [] },
      }),
      scope,
      { em: em as never, commandBus: commandBus as never, container: { resolve: jest.fn() } },
    )
    expect(result.status).toBe('plan-skip')
    expect(result.reason).toBe('no-entity-row')
  })
})

describe('writeImportPlan — company creation', () => {
  it('woła customers.companies.create z legalName + brandName', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': (input) => {
        expect((input as Record<string, unknown>).legalName).toBe('Test Sp. z o.o.')
        expect((input as Record<string, unknown>).source).toBe('erp_fromee:company_x')
        expect((input as Record<string, unknown>).lifecycleStage).toBe('customer')
        return { entityId: 'new-uuid', companyId: 'profile-uuid' }
      },
    })
    const result = await writeImportPlan(buildPlan(), scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    expect(result.status).toBe('created')
    expect(result.entityId).toBe('new-uuid')
    expect(result.profileId).toBe('profile-uuid')
  })

  it('aktualizuje legal_form / entity_type / full_address_krs po command bus', async () => {
    const profileMock: Record<string, unknown> = {}
    const em = makeEm({
      findOne: jest.fn()
        .mockImplementationOnce(() => null)              // idempotency check
        .mockImplementationOnce(() => profileMock),       // post-create profile fetch
    })
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    await writeImportPlan(buildPlan(), scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    expect(profileMock.legalForm).toBe('sp_z_oo')
    expect(profileMock.entityType).toBe('organization')
  })
})

describe('writeImportPlan — person creation', () => {
  it('woła customers.people.create z firstName + lastName', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.people.create': (input) => {
        expect((input as Record<string, unknown>).firstName).toBe('Jan')
        expect((input as Record<string, unknown>).lastName).toBe('Kowalski')
        return { entityId: 'new-uuid', personId: 'profile-uuid' }
      },
    })
    const plan = buildPlan({
      partner: {
        skip: false,
        warnings: [],
        entity: {
          externalId: 'company_x',
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          kind: 'person',
          displayName: 'Jan Kowalski',
          description: null,
          primaryEmail: null,
          primaryPhone: null,
          isActive: true,
          metadata: {},
        },
        profile: { kind: 'person', firstName: 'Jan', lastName: 'Kowalski' },
      },
    })
    const result = await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    expect(result.status).toBe('created')
    expect(result.profileId).toBe('profile-uuid')
  })

  it('plan-skip gdy person bez firstName/lastName i displayName ma 1 słowo', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({})
    const plan = buildPlan({
      partner: {
        skip: false,
        warnings: [],
        entity: {
          externalId: 'company_x',
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          kind: 'person',
          displayName: 'Cher',
          description: null,
          primaryEmail: null,
          primaryPhone: null,
          isActive: true,
          metadata: {},
        },
        profile: { kind: 'person', firstName: null, lastName: null },
      },
    })
    const result = await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    expect(result.status).toBe('plan-skip')
    expect(result.reason).toBe('missing-name-parts')
  })
})

describe('writeImportPlan — tax identities + addresses + billing', () => {
  it('emituje tax identity rows przez em.create', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      taxIdentities: {
        rows: [
          {
            externalId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            countryCode: 'PL',
            kind: 'nip',
            value: '5260250996',
            isPrimary: true,
          },
        ],
        warnings: [],
      },
    })
    await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    const taxCreate = em.__created.find((c) => c.entityName === 'CustomerTaxIdentity')
    expect(taxCreate).toBeDefined()
    expect(taxCreate?.payload).toMatchObject({ kind: 'nip', value: '5260250996', isPrimary: true })
  })

  it('emituje address rows przez em.create i pomija te bez street1', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      addresses: {
        rows: [
          {
            externalAddressId: 'addr_a',
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            addressType: 'office',
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
            isPrimary: true,
          },
          {
            externalAddressId: 'addr_b',
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            addressType: 'billing',
            label: null,
            attentionOf: null,
            name1: null,
            name2: null,
            street1: null,
            street2: null,
            postalCode: null,
            city: null,
            region: null,
            countryCode: 'PL',
            isPrimary: false,
          },
        ],
        warnings: [],
      },
    })
    const result = await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    const addressCreates = em.__created.filter((c) => c.entityName === 'CustomerAddress')
    expect(addressCreates).toHaveLength(1)
    expect(addressCreates[0].payload).toMatchObject({ addressLine1: 'ul. Testowa 1', city: 'Warszawa' })
    expect(result.warnings.some((w) => w.includes('address_line1 required'))).toBe(true)
  })

  it('emituje billing row tylko dla company kind', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      billing: {
        row: {
          externalCompanyId: 'company_x',
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          bankName: 'PKO BP',
          bankAccountMasked: 'PL61 ******* 2874',
          paymentTerms: 'NET 14',
          preferredCurrency: 'PLN',
          salesOwnerUserId: null,
          defaultOfferValidityDays: 30,
          legacyExtras: {
            delivery_terms: null,
            price_group: null,
            credit_limit: null,
            primary_bank_external_id: null,
          },
        },
        warnings: [],
      },
    })
    await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    const billingCreate = em.__created.find((c) => c.entityName === 'CustomerCompanyBilling')
    expect(billingCreate).toBeDefined()
    expect(billingCreate?.payload).toMatchObject({
      bankName: 'PKO BP',
      preferredCurrency: 'PLN',
      defaultOfferValidityDays: 30,
    })
  })
})

describe('writeImportPlan — failure handling', () => {
  it('zwraca status=failed gdy command bus rzuca', async () => {
    const em = makeEm()
    const commandBus = {
      execute: jest.fn().mockRejectedValue(new Error('NIP duplicate')),
    }
    const result = await writeImportPlan(buildPlan(), scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('NIP duplicate')
  })
})

describe('writeAllPlans + summarizeWrites', () => {
  it('agreguje statystyki', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'uuid', companyId: 'pid' }),
    })
    const plans: CompanyImportPlan[] = [
      buildPlan({ externalCompanyId: 'a' }),
      buildPlan({ externalCompanyId: 'b', status: 'skipped', skipReason: 'formee-self' }),
      buildPlan({ externalCompanyId: 'c', status: 'manual_review', manualReviewReason: 'person-without-nip' }),
    ]
    const out = await writeAllPlans(plans, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    expect(out.summary.total).toBe(3)
    expect(out.summary.created).toBe(1)
    expect(out.summary.planSkip).toBe(2)
    expect(out.summary.byReason['formee-self']).toBe(1)
    expect(out.summary.byReason['person-without-nip']).toBe(1)
  })

  it('summarizeWrites jest pure function', () => {
    const summary = summarizeWrites([
      { externalCompanyId: 'a', status: 'created', warnings: [] },
      { externalCompanyId: 'b', status: 'idempotent-skip', reason: 'already imported', warnings: [] },
      { externalCompanyId: 'c', status: 'failed', error: 'boom', warnings: [] },
    ])
    expect(summary.created).toBe(1)
    expect(summary.idempotentSkip).toBe(1)
    expect(summary.failed).toBe(1)
  })
})

describe('Bug E — entity_roles persistence', () => {
  const importerUserId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  it('zapisuje customer_entity_roles dla każdego role row gdy importerUserId to UUID', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      roles: {
        skip: false,
        rows: [
          {
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            entityType: 'company',
            roleType: 'customer',
          },
          {
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            entityType: 'company',
            roleType: 'supplier',
          },
        ],
        primaryLifecycleStage: 'customer',
        warnings: [],
      },
    })
    await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    const roleCreates = em.__created.filter((c) => c.entityName === 'CustomerEntityRole')
    expect(roleCreates).toHaveLength(2)
    expect(roleCreates.map((c) => c.payload.roleType).sort()).toEqual(['customer', 'supplier'])
    expect(roleCreates.every((c) => c.payload.userId === importerUserId)).toBe(true)
    expect(roleCreates.every((c) => c.payload.entityId === 'new-uuid')).toBe(true)
  })

  it('pomija entity_roles + warning gdy importerUserId nie jest UUIDem', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      roles: {
        skip: false,
        rows: [
          {
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            entityType: 'company',
            roleType: 'customer',
          },
        ],
        primaryLifecycleStage: 'customer',
        warnings: [],
      },
    })
    const result = await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId: 'erp-fromee-import',
    })
    const roleCreates = em.__created.filter((c) => c.entityName === 'CustomerEntityRole')
    expect(roleCreates).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('importerUserId not a UUID'))).toBe(true)
  })

  it('pomija entity_roles + warning gdy importerUserId nie podany', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      roles: {
        skip: false,
        rows: [
          {
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            entityType: 'company',
            roleType: 'customer',
          },
        ],
        primaryLifecycleStage: 'customer',
        warnings: [],
      },
    })
    const result = await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
    })
    const roleCreates = em.__created.filter((c) => c.entityName === 'CustomerEntityRole')
    expect(roleCreates).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('--user'))).toBe(true)
  })

  it('failure pojedynczego role row nie blokuje pozostałych', async () => {
    let flushCount = 0
    const em = makeEm({
      flush: jest.fn().mockImplementation(async () => {
        flushCount += 1
        if (flushCount === 3) throw new Error('unique violation')
      }),
    })
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      roles: {
        skip: false,
        rows: [
          { externalCompanyId: 'company_x', organizationId: scope.organizationId, tenantId: scope.tenantId, entityType: 'company', roleType: 'customer' },
          { externalCompanyId: 'company_x', organizationId: scope.organizationId, tenantId: scope.tenantId, entityType: 'company', roleType: 'supplier' },
          { externalCompanyId: 'company_x', organizationId: scope.organizationId, tenantId: scope.tenantId, entityType: 'company', roleType: 'prospect' },
        ],
        primaryLifecycleStage: 'customer',
        warnings: [],
      },
    })
    const result = await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    expect(result.status).toBe('created')
    expect(result.warnings.some((w) => w.includes('Failed entity role') && w.includes('unique violation'))).toBe(true)
  })
})

describe('Bug F — tax identity normalization + isolated flushes', () => {
  const importerUserId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  it('normalizuje NIP "631-259-75-19" → "6312597519" przed inserttem', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      taxIdentities: {
        rows: [
          {
            externalId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            countryCode: 'PL',
            kind: 'nip',
            value: '631-259-75-19',
            isPrimary: true,
          },
        ],
        warnings: [],
      },
    })
    await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    const taxCreate = em.__created.find((c) => c.entityName === 'CustomerTaxIdentity')
    expect(taxCreate?.payload.value).toBe('6312597519')
  })

  it('failure jednego tax row nie usuwa pozostałych (Bug F regression)', async () => {
    let flushCount = 0
    const em = makeEm({
      flush: jest.fn().mockImplementation(async () => {
        flushCount += 1
        // Pierwszy flush = entity profile update; drugi flush = tax row #1 → fail
        if (flushCount === 2) throw new Error('unique violation')
      }),
    })
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      taxIdentities: {
        rows: [
          { externalId: 'company_x', organizationId: scope.organizationId, tenantId: scope.tenantId, countryCode: 'PL', kind: 'nip', value: '6312597519', isPrimary: true },
          { externalId: 'company_x', organizationId: scope.organizationId, tenantId: scope.tenantId, countryCode: 'PL', kind: 'krs', value: '0000123456', isPrimary: false },
        ],
        warnings: [],
      },
    })
    const result = await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    expect(result.status).toBe('created')
    expect(result.warnings.some((w) => w.includes('Failed tax identity') && w.includes('unique violation'))).toBe(true)
  })

  it('puste tax value po normalizacji jest pomijane z warningiem', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      taxIdentities: {
        rows: [
          { externalId: 'company_x', organizationId: scope.organizationId, tenantId: scope.tenantId, countryCode: 'PL', kind: 'nip', value: '---', isPrimary: true },
        ],
        warnings: [],
      },
    })
    const result = await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    const taxCreates = em.__created.filter((c) => c.entityName === 'CustomerTaxIdentity')
    expect(taxCreates).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('empty after normalization'))).toBe(true)
  })

  it('failure address row nie kasuje innych ancillary inserts (regression)', async () => {
    const created: { entityName: string; payload: Record<string, unknown> }[] = []
    const em: MockEm = {
      fork: () => em,
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((entity, payload) => {
        const entityName = typeof entity === 'function' ? (entity as { name?: string }).name ?? 'unknown' : String(entity)
        created.push({ entityName, payload })
        return payload
      }),
      flush: jest.fn().mockImplementation(async () => {
        // Fail flush WHEN ostatni create był CustomerAddress
        const last = created[created.length - 1]
        if (last?.entityName === 'CustomerAddress') {
          throw new Error('address constraint')
        }
      }),
      getReference: jest.fn().mockImplementation((_entity, id) => ({ __ref: id })),
      __created: created,
    }
    const commandBus = makeCommandBus({
      'customers.companies.create': () => ({ entityId: 'new-uuid', companyId: 'profile-uuid' }),
    })
    const plan = buildPlan({
      addresses: {
        rows: [
          {
            externalAddressId: 'addr_a',
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            addressType: 'office',
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
            isPrimary: true,
          },
        ],
        warnings: [],
      },
      billing: {
        row: {
          externalCompanyId: 'company_x',
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          bankName: 'PKO',
          bankAccountMasked: 'PL61 ********** 2874',
          paymentTerms: null,
          preferredCurrency: 'PLN',
          salesOwnerUserId: null,
          defaultOfferValidityDays: 30,
          legacyExtras: { delivery_terms: null, price_group: null, credit_limit: null, primary_bank_external_id: null },
        },
        warnings: [],
      },
    })
    const result = await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    expect(result.status).toBe('created')
    expect(result.warnings.some((w) => w.includes('Failed address'))).toBe(true)
    // Billing wciąż ląduje (mimo że address failed)
    const billingCreates = em.__created.filter((c) => c.entityName === 'CustomerCompanyBilling')
    expect(billingCreates).toHaveLength(1)
  })
})

describe('Y8 — contacts writer (persons + links + roles)', () => {
  const importerUserId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  function buildContactsPlan(): CompanyImportPlan {
    return buildPlan({
      contacts: {
        persons: [
          {
            externalId: 'contact_1',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            displayName: 'Jan Kowalski',
            primaryEmail: 'jan@example.com',
            primaryPhone: null,
            isActive: true,
            metadata: {},
          },
          {
            externalId: 'contact_2',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            displayName: 'Anna Nowak',
            primaryEmail: null,
            primaryPhone: null,
            isActive: true,
            metadata: {},
          },
        ],
        profiles: [
          { externalId: 'contact_1', firstName: 'Jan', lastName: 'Kowalski', jobTitle: null, department: null },
          { externalId: 'contact_2', firstName: null, lastName: null, jobTitle: 'Architekt', department: null },
        ],
        links: [
          {
            externalContactId: 'contact_1',
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            isPrimary: true,
          },
          {
            externalContactId: 'contact_2',
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            isPrimary: false,
          },
        ],
        roles: [
          {
            externalContactId: 'contact_1',
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            roleValue: 'sales',
          },
          {
            externalContactId: 'contact_2',
            externalCompanyId: 'company_x',
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            roleValue: 'architect',
          },
        ],
        warnings: [],
      },
    })
  }

  it('buildContactSourceKey formats z prefiksem erp_fromee:contact:', () => {
    expect(buildContactSourceKey('contact_xxx')).toBe('erp_fromee:contact:contact_xxx')
  })

  it('woła customers.people.create per contact, każdy z source = erp_fromee:contact:<id>', async () => {
    const em = makeEm()
    let personCounter = 0
    const peopleCreated: Record<string, unknown>[] = []
    const commandBus = {
      execute: jest.fn().mockImplementation(async (commandId: string, options: { input: Record<string, unknown> }) => {
        if (commandId === 'customers.companies.create') {
          return { result: { entityId: 'company-uuid', companyId: 'profile-uuid' }, logEntry: null }
        }
        if (commandId === 'customers.people.create') {
          peopleCreated.push(options.input)
          personCounter += 1
          return { result: { entityId: `person-uuid-${personCounter}`, personId: `pp-${personCounter}` }, logEntry: null }
        }
        throw new Error(`No mock for ${commandId}`)
      }),
    }
    await writeImportPlan(buildContactsPlan(), scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    expect(peopleCreated).toHaveLength(2)
    expect(peopleCreated[0].source).toBe('erp_fromee:contact:contact_1')
    expect(peopleCreated[0].firstName).toBe('Jan')
    expect(peopleCreated[0].lastName).toBe('Kowalski')
    // Contact 2 — fallback split z displayName
    expect(peopleCreated[1].firstName).toBe('Anna')
    expect(peopleCreated[1].lastName).toBe('Nowak')
    expect(peopleCreated[1].source).toBe('erp_fromee:contact:contact_2')
  })

  it('zapisuje customer_person_company_links per link row', async () => {
    const em = makeEm()
    let personCounter = 0
    const commandBus = {
      execute: jest.fn().mockImplementation(async (commandId: string) => {
        if (commandId === 'customers.companies.create') {
          return { result: { entityId: 'company-uuid', companyId: 'profile-uuid' }, logEntry: null }
        }
        personCounter += 1
        return { result: { entityId: `person-uuid-${personCounter}`, personId: `pp-${personCounter}` }, logEntry: null }
      }),
    }
    await writeImportPlan(buildContactsPlan(), scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    const linkCreates = em.__created.filter((c) => c.entityName === 'CustomerPersonCompanyLink')
    expect(linkCreates).toHaveLength(2)
    expect(linkCreates.filter((c) => c.payload.isPrimary)).toHaveLength(1)
  })

  it('zapisuje customer_person_company_roles per role row z mapper-derived roleValue', async () => {
    const em = makeEm()
    let personCounter = 0
    const commandBus = {
      execute: jest.fn().mockImplementation(async (commandId: string) => {
        if (commandId === 'customers.companies.create') {
          return { result: { entityId: 'company-uuid', companyId: 'profile-uuid' }, logEntry: null }
        }
        personCounter += 1
        return { result: { entityId: `person-uuid-${personCounter}`, personId: `pp-${personCounter}` }, logEntry: null }
      }),
    }
    await writeImportPlan(buildContactsPlan(), scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    const roleCreates = em.__created.filter((c) => c.entityName === 'CustomerPersonCompanyRole')
    expect(roleCreates).toHaveLength(2)
    expect(roleCreates.map((c) => c.payload.roleValue).sort()).toEqual(['architect', 'sales'])
  })

  it('idempotency: jeśli person już istnieje (po source key), pomija create + linkuje do istniejącego', async () => {
    const em = makeEm({
      // findOne: pierwszy zwrot (entity check) = null; następne (person idempotency) zwracają existing
      findOne: jest.fn().mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
        if (typeof where.source === 'string' && where.source.startsWith('erp_fromee:contact:')) {
          return { id: `existing-person-${where.source}` }
        }
        return null
      }),
    })
    const peopleCreated: Record<string, unknown>[] = []
    const commandBus = {
      execute: jest.fn().mockImplementation(async (commandId: string, options: { input: Record<string, unknown> }) => {
        if (commandId === 'customers.companies.create') {
          return { result: { entityId: 'company-uuid', companyId: 'profile-uuid' }, logEntry: null }
        }
        peopleCreated.push(options.input)
        return { result: { entityId: 'never-called', personId: 'never' }, logEntry: null }
      }),
    }
    await writeImportPlan(buildContactsPlan(), scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    expect(peopleCreated).toHaveLength(0) // żaden create — wszystkie idempotent-skip
    // Linki nadal lądują (do existing person ID)
    const linkCreates = em.__created.filter((c) => c.entityName === 'CustomerPersonCompanyLink')
    expect(linkCreates).toHaveLength(2)
  })

  it('skip contact + warning gdy displayName ma 1 słowo i brak first/last w profile', async () => {
    const em = makeEm()
    const commandBus = {
      execute: jest.fn().mockImplementation(async (commandId: string) => {
        if (commandId === 'customers.companies.create') {
          return { result: { entityId: 'company-uuid', companyId: 'profile-uuid' }, logEntry: null }
        }
        return { result: { entityId: 'p-uuid', personId: 'pp' }, logEntry: null }
      }),
    }
    const plan = buildPlan({
      contacts: {
        persons: [{
          externalId: 'contact_x',
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          displayName: 'Madonna',
          primaryEmail: null,
          primaryPhone: null,
          isActive: true,
          metadata: {},
        }],
        profiles: [{ externalId: 'contact_x', firstName: null, lastName: null, jobTitle: null, department: null }],
        links: [{ externalContactId: 'contact_x', externalCompanyId: 'company_x', organizationId: scope.organizationId, tenantId: scope.tenantId, isPrimary: true }],
        roles: [],
        warnings: [],
      },
    })
    const result = await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    expect(result.warnings.some((w) => w.includes('cannot derive firstName + lastName'))).toBe(true)
    // Skip propaguje się: link/role do tego contactu też nie powstaje
    const linkCreates = em.__created.filter((c) => c.entityName === 'CustomerPersonCompanyLink')
    expect(linkCreates).toHaveLength(0)
  })

  it('failure jednego contact create nie blokuje pozostałych', async () => {
    const em = makeEm()
    let personCounter = 0
    const commandBus = {
      execute: jest.fn().mockImplementation(async (commandId: string, options: { input: Record<string, unknown> }) => {
        if (commandId === 'customers.companies.create') {
          return { result: { entityId: 'company-uuid', companyId: 'profile-uuid' }, logEntry: null }
        }
        personCounter += 1
        if (personCounter === 1) throw new Error('email duplicate')
        return { result: { entityId: `person-uuid-${personCounter}`, personId: `pp-${personCounter}` }, logEntry: null }
      }),
    }
    const result = await writeImportPlan(buildContactsPlan(), scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    expect(result.status).toBe('created')
    expect(result.warnings.some((w) => w.includes('Failed contact contact_1') && w.includes('email duplicate'))).toBe(true)
    // Drugi contact nadal trafia
    const linkCreates = em.__created.filter((c) => c.entityName === 'CustomerPersonCompanyLink')
    expect(linkCreates).toHaveLength(1) // tylko contact_2
  })

  it('pomija contacts gdy plan.partner.entity.kind === "person" (kontakty są tylko dla firm)', async () => {
    const em = makeEm()
    const commandBus = makeCommandBus({
      'customers.people.create': () => ({ entityId: 'p-uuid', personId: 'pp' }),
    })
    const plan = buildPlan({
      partner: {
        skip: false,
        warnings: [],
        entity: {
          externalId: 'company_x',
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          kind: 'person',
          displayName: 'Jan Kowalski',
          description: null,
          primaryEmail: null,
          primaryPhone: null,
          isActive: true,
          metadata: {},
        },
        profile: { kind: 'person', firstName: 'Jan', lastName: 'Kowalski' },
      },
      contacts: {
        persons: [{ externalId: 'c1', organizationId: scope.organizationId, tenantId: scope.tenantId, displayName: 'X Y', primaryEmail: null, primaryPhone: null, isActive: true, metadata: {} }],
        profiles: [{ externalId: 'c1', firstName: 'X', lastName: 'Y', jobTitle: null, department: null }],
        links: [{ externalContactId: 'c1', externalCompanyId: 'company_x', organizationId: scope.organizationId, tenantId: scope.tenantId, isPrimary: true }],
        roles: [],
        warnings: [],
      },
    })
    await writeImportPlan(plan, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    const linkCreates = em.__created.filter((c) => c.entityName === 'CustomerPersonCompanyLink')
    expect(linkCreates).toHaveLength(0) // person-kind partner → contacts skipped
  })
})
