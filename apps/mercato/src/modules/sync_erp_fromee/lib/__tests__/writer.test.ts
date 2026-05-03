/**
 * Unit testy writera. Używamy mocked EntityManager + CommandBus — nie
 * tykamy realnej bazy. Testy sprawdzają:
 *  - idempotency check (source = 'erp_fromee:<id>')
 *  - delegację do `customers.companies.create` / `customers.people.create`
 *  - bezpośrednie inserts dla taxIdentities / addresses / billing
 *  - skip-handling (plan-skip, manual-review, no-entity)
 *  - failure handling
 */
import { writeImportPlan, writeAllPlans, summarizeWrites, buildSourceKey, SOURCE_PREFIX } from '../writer'
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
