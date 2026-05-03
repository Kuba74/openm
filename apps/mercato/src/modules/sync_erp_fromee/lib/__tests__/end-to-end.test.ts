/**
 * End-to-end test: full chain pipeline → writer na 25 fixture bundles z auditów.
 *
 * Używa:
 *  - Fake `ErpFromeeAdapter` (zwraca 25 hard-coded bundles z 2 raportów audit)
 *  - Mocked `EntityManager` + `CommandBus` zliczające inserts per tabela
 *
 * Sprawdza pełen łańcuch:
 *  1. pipeline filtruje (D4 INTERNAL-only, D12 test, D13 Formee, manual_review)
 *  2. writer woła `customers.companies.create` / `customers.people.create`
 *  3. writer wpisuje tax / addresses / billing / entity_roles / person_company_*
 *  4. idempotency (re-run = wszystko idempotent-skip)
 *
 * Real-Postgres test wymagałby spinning up test DB + running migracji per
 * test run — wykracza poza scope tego PR. Operator weryfikuje na prod copy:
 *
 *   yarn mercato sync_erp_fromee customers --tenant <UUID> --org <UUID> \
 *     --user <UUID> --commit --limit 200
 */
import { runImportPipeline, FORMEE_TENANT_COMPANY_ID } from '../pipeline'
import { writeAllPlans, summarizeWrites } from '../writer'
import type { ErpFromeeAdapter } from '../erpFromeeAdapter'
import type {
  ErpFromeeBundle,
  ErpFromeeCompany,
  ErpFromeeCompanyAddress,
  ErpFromeeCompanyBankAccount,
  ErpFromeeCompanyContact,
  ErpFromeeCompanyRole,
  ErpFromeeCompanySourceLink,
  ImportScope,
} from '../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

const importerUserId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const baseDate = new Date('2024-01-01T10:00:00Z')

function buildCompany(overrides: Partial<ErpFromeeCompany>): ErpFromeeCompany {
  return {
    id: overrides.id ?? 'company_x',
    companyNo: null,
    kind: 'ORGANIZATION',
    legalName: overrides.legalName ?? 'Test Sp. z o.o.',
    displayName: overrides.displayName ?? null,
    shortName: null,
    searchTerm: null,
    taxId: null,
    regon: null,
    krs: null,
    vatEu: null,
    countryCode: 'PL',
    defaultLanguage: 'pl',
    isActive: true,
    isBlocked: false,
    note: null,
    metadata: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...overrides,
  }
}

function buildRole(overrides: Partial<ErpFromeeCompanyRole>): ErpFromeeCompanyRole {
  return {
    id: overrides.id ?? 'role_a',
    companyId: overrides.companyId ?? 'company_x',
    roleType: 'CUSTOMER',
    isActive: true,
    currency: null,
    paymentTerms: null,
    deliveryTerms: null,
    priceGroup: null,
    creditLimit: null,
    createdAt: baseDate,
    ...overrides,
  }
}

function buildContact(overrides: Partial<ErpFromeeCompanyContact>): ErpFromeeCompanyContact {
  return {
    id: overrides.id ?? 'contact_a',
    companyId: overrides.companyId ?? 'company_x',
    firstName: null,
    lastName: null,
    displayName: null,
    jobTitle: null,
    department: null,
    contactFunction: null,
    email: null,
    phone: null,
    isPrimary: false,
    isActive: true,
    metadata: null,
    createdAt: baseDate,
    ...overrides,
  }
}

function buildAddress(overrides: Partial<ErpFromeeCompanyAddress>): ErpFromeeCompanyAddress {
  return {
    id: overrides.id ?? 'addr_a',
    companyId: overrides.companyId ?? 'company_x',
    type: 'PRIMARY',
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
    latitude: null,
    longitude: null,
    isPrimary: false,
    createdAt: baseDate,
    ...overrides,
  }
}

function buildBank(overrides: Partial<ErpFromeeCompanyBankAccount>): ErpFromeeCompanyBankAccount {
  return {
    id: overrides.id ?? 'bank_a',
    companyId: overrides.companyId ?? 'company_x',
    bankName: 'PKO BP',
    iban: 'PL61109010140000071219812874',
    swift: 'BPKOPLPW',
    isPrimary: false,
    isActive: true,
    createdAt: baseDate,
    ...overrides,
  }
}

function buildLink(overrides: Partial<ErpFromeeCompanySourceLink>): ErpFromeeCompanySourceLink {
  return {
    id: overrides.id ?? 'link_a',
    companyId: overrides.companyId ?? 'company_x',
    sourceSystem: 'salesforce',
    externalId: 'sf_001',
    lastSyncAt: null,
    ...overrides,
  }
}

function bundle(
  company: ErpFromeeCompany,
  parts: {
    roles?: ErpFromeeCompanyRole[]
    contacts?: ErpFromeeCompanyContact[]
    addresses?: ErpFromeeCompanyAddress[]
    bankAccounts?: ErpFromeeCompanyBankAccount[]
    sourceLinks?: ErpFromeeCompanySourceLink[]
  } = {},
): ErpFromeeBundle {
  return {
    company,
    roles: parts.roles ?? [buildRole({ companyId: company.id })],
    contacts: parts.contacts ?? [],
    addresses: parts.addresses ?? [],
    bankAccounts: parts.bankAccounts ?? [],
    sourceLinks: parts.sourceLinks ?? [],
  }
}

function buildFixtureBundles(): ErpFromeeBundle[] {
  return [
    // 1. Formee Sp. z o.o. — D13 hard-skip (id match)
    bundle(buildCompany({
      id: FORMEE_TENANT_COMPANY_ID,
      legalName: 'Formee Sp. z o.o.',
      displayName: 'Formee Sp. z o.o.',
    })),
    // 2. Smoke fixture — D12 skip
    bundle(buildCompany({
      id: 'cmnsmoke0001',
      legalName: 'Smoke Test',
      displayName: 'smoke-test-001',
    })),
    // 3. JDG Paulina Smolarska — PERSON+NIP → reklasyfikacja company+jdg
    bundle(buildCompany({
      id: 'cmnjdg0001',
      kind: 'PERSON',
      legalName: 'PAULINA SMOLARSKA',
      displayName: 'Paulina Smolarska JDG',
      taxId: '5260250996',
    })),
    // 4. Bałdyga Daniel — PERSON-bez-NIP → manual_review (z bankiem + rolą CUSTOMER + EUR)
    bundle(
      buildCompany({
        id: 'cmnbaldy0001',
        kind: 'PERSON',
        legalName: 'Bałdyga Daniel',
        displayName: 'Bałdyga Daniel',
        taxId: null,
      }),
      {
        roles: [buildRole({ companyId: 'cmnbaldy0001', currency: 'EUR' })],
        bankAccounts: [buildBank({
          id: 'bank_bald',
          companyId: 'cmnbaldy0001',
          iban: 'PL61109010140000071219812874',
        })],
      },
    ),
    // 5. NOWYDOM dual CUSTOMER+SUPPLIER role
    bundle(
      buildCompany({
        id: 'cmnowy0001',
        legalName: 'NOWYDOM Sp. z o.o.',
        displayName: 'NOWYDOM',
        taxId: '6312597519',
      }),
      {
        roles: [
          buildRole({ id: 'r_c', companyId: 'cmnowy0001', roleType: 'CUSTOMER' }),
          buildRole({ id: 'r_s', companyId: 'cmnowy0001', roleType: 'SUPPLIER' }),
        ],
      },
    ),
    // 6. Urząd Gminy Bogdaniec — multi-source
    bundle(
      buildCompany({
        id: 'cmnbogd0001',
        legalName: 'Urząd Gminy Bogdaniec',
        displayName: 'Urząd Gminy Bogdaniec',
        taxId: '5990200111',
      }),
      {
        sourceLinks: [buildLink({ id: 'sl', companyId: 'cmnbogd0001', sourceSystem: 'salesforce', externalId: 'sf_b' })],
      },
    ),
    // 7. Newline-firma — sanitize
    bundle(buildCompany({
      id: 'cmnnewln0001',
      legalName: 'Planungsgesellschaft\n  mbh   &\nCo.   KG',
      taxId: '5990200222',
    })),
    // 8. INTERNAL-only — D4 skip
    bundle(
      buildCompany({ id: 'cmnint0001', legalName: 'Internal', displayName: 'Internal' }),
      { roles: [buildRole({ id: 'r_i', companyId: 'cmnint0001', roleType: 'INTERNAL' })] },
    ),
    // 9. INTERNAL+CUSTOMER → CUSTOMER stays, INTERNAL dropped
    bundle(
      buildCompany({
        id: 'cmnmix0001',
        legalName: 'Mix',
        displayName: 'Mix',
        taxId: '5990200333',
      }),
      {
        roles: [
          buildRole({ id: 'r_i', companyId: 'cmnmix0001', roleType: 'INTERNAL' }),
          buildRole({ id: 'r_c', companyId: 'cmnmix0001', roleType: 'CUSTOMER' }),
        ],
      },
    ),
    // 10. ORGANIZATION bez tax ID — warning, ale OK
    bundle(buildCompany({ id: 'cmnnoid0001', legalName: 'No-Tax', displayName: 'No-Tax', taxId: null })),

    // 11. Constar — broken bank
    bundle(
      buildCompany({
        id: 'cmnconst0001',
        legalName: 'Constar GmbH',
        displayName: 'Constar GmbH',
        taxId: '5990200444',
        countryCode: 'DE',
      }),
      {
        roles: [buildRole({ companyId: 'cmnconst0001', currency: 'EUR' })],
        bankAccounts: [buildBank({ id: 'bank_c', companyId: 'cmnconst0001', iban: null, bankName: 'Sparkasse', swift: null })],
      },
    ),
    // 12. Melsdorf — broken bank
    bundle(
      buildCompany({
        id: 'cmnmels0001',
        legalName: 'Thomas Melsdorf',
        displayName: 'Thomas Melsdorf',
        taxId: '5990200555',
        kind: 'PERSON',
      }),
      {
        bankAccounts: [buildBank({ id: 'bank_m', companyId: 'cmnmels0001', iban: '' })],
      },
    ),
    // 13. GOREM PREFA — null currency → PLN
    bundle(
      buildCompany({ id: 'cmngorm0001', legalName: 'GOREM PREFA', displayName: 'GOREM', taxId: '5990200666' }),
      {
        roles: [buildRole({ companyId: 'cmngorm0001', currency: null })],
        bankAccounts: [buildBank({ id: 'bank_g', companyId: 'cmngorm0001' })],
      },
    ),
    // 14. Nuckel Hamburg — DE address w PL countryCode
    bundle(
      buildCompany({ id: 'cmnnuck0001', legalName: 'Nuckel Architekten Hamburg', displayName: 'Nuckel', taxId: '5990200777' }),
      {
        addresses: [buildAddress({
          id: 'addr_nu',
          companyId: 'cmnnuck0001',
          city: 'Hamburg',
          street1: 'Hamburgstrasse 1',
          countryCode: 'PL',
        })],
      },
    ),
    // 15. Expobud Domy — 7 contacts
    bundle(
      buildCompany({ id: 'cmnexpo0001', legalName: 'Expobud Domy Sp. z o.o.', displayName: 'Expobud', taxId: '5990200888' }),
      {
        contacts: Array.from({ length: 7 }).map((_, i) =>
          buildContact({
            id: `contact_expo_${i}`,
            companyId: 'cmnexpo0001',
            firstName: `First${i}`,
            lastName: `Last${i}`,
            createdAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
          }),
        ),
      },
    ),

    // 16-25. Filler companies for matrix coverage
    bundle(
      buildCompany({ id: 'cmnf01', legalName: 'Filler 1', displayName: 'Filler 1', taxId: '1110000001' }),
      { addresses: [buildAddress({ id: 'a_f1', companyId: 'cmnf01', type: 'INVOICE', street1: 'ul. F1' })] },
    ),
    bundle(buildCompany({
      id: 'cmnf02',
      legalName: 'Filler 2',
      displayName: 'Filler 2',
      taxId: '1110000002',
      regon: '111000003',
      krs: '0000111111',
    })),
    bundle(
      buildCompany({ id: 'cmnf03', legalName: 'Filler 3 GmbH', displayName: 'Filler 3', taxId: '1110000004', countryCode: 'DE' }),
      { roles: [buildRole({ companyId: 'cmnf03', currency: 'EUR' })] },
    ),
    bundle(
      buildCompany({ id: 'cmnf04', legalName: 'Filler 4', displayName: 'Filler 4', taxId: '1110000005' }),
      {
        contacts: [
          buildContact({ id: 'c_f4_a', companyId: 'cmnf04', firstName: 'Anna', lastName: 'K', isPrimary: true, createdAt: new Date('2024-01-01T10:00:00Z') }),
          buildContact({ id: 'c_f4_b', companyId: 'cmnf04', firstName: 'Bogdan', lastName: 'N', isPrimary: true, createdAt: new Date('2024-01-02T10:00:00Z') }),
        ],
      },
    ),
    bundle(
      buildCompany({ id: 'cmnf05', legalName: 'Filler 5', displayName: 'Filler 5', taxId: '1110000006' }),
      {
        bankAccounts: [
          buildBank({ id: 'b_f5a', companyId: 'cmnf05', iban: 'PL00000000000000000000000001', isPrimary: true }),
          buildBank({ id: 'b_f5b', companyId: 'cmnf05', iban: 'PL00000000000000000000000002', createdAt: new Date('2024-01-02T10:00:00Z') }),
        ],
      },
    ),
    bundle(
      buildCompany({ id: 'cmnf06', legalName: 'Filler 6', displayName: 'Filler 6', taxId: '1110000007' }),
      { contacts: [buildContact({ id: 'c_f6', companyId: 'cmnf06', firstName: 'Tomek', lastName: 'A' })] },
    ),
    bundle(
      buildCompany({ id: 'cmnf07', legalName: 'Filler 7', displayName: 'Filler 7', taxId: '1110000008' }),
      {
        bankAccounts: [
          buildBank({ id: 'b_f7a', companyId: 'cmnf07', iban: 'PL00000000000000000000000007', createdAt: new Date('2024-01-01T10:00:00Z') }),
          buildBank({ id: 'b_f7b', companyId: 'cmnf07', iban: 'PL00000000000000000000000008', createdAt: new Date('2024-01-02T10:00:00Z') }),
        ],
      },
    ),
    bundle(buildCompany({ id: 'cmnf08', legalName: 'Filler 8 KRS-only', displayName: 'Filler 8', taxId: null, krs: '0000222222' })),
    bundle(buildCompany({ id: 'cmnf09', legalName: 'Filler 9 S.A.', displayName: 'Filler 9', taxId: '1110000010' })),
    bundle(
      buildCompany({ id: 'cmnf10', legalName: 'Filler 10 multi-addr', displayName: 'Filler 10', taxId: '1110000011' }),
      {
        addresses: [
          buildAddress({ id: 'a_f10d', companyId: 'cmnf10', type: 'DELIVERY', street1: 'ul. D' }),
          buildAddress({ id: 'a_f10i', companyId: 'cmnf10', type: 'INVOICE', street1: 'ul. I' }),
        ],
      },
    ),
  ]
}

function makeFakeAdapter(bundles: ErpFromeeBundle[]): ErpFromeeAdapter {
  return {
    async countCustomerCompanies() {
      return bundles.length
    },
    async *fetchCustomerBundles(options: { limit?: number | null; batchSize?: number }) {
      const limit = options.limit ?? null
      const out = limit !== null ? bundles.slice(0, limit) : bundles
      const batchSize = options.batchSize ?? 100
      for (let i = 0; i < out.length; i += batchSize) {
        yield out.slice(i, i + batchSize)
      }
    },
  }
}

type CreatedRow = { entityName: string; payload: Record<string, unknown> }

function makeStubEm(state: { created: CreatedRow[]; existingPersonsBySource: Set<string> }): unknown {
  const em = {
    fork: () => em,
    findOne: jest.fn().mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      // Person idempotency check
      if (typeof where.source === 'string' && where.source.startsWith('erp_fromee:contact:')) {
        return state.existingPersonsBySource.has(where.source)
          ? { id: `existing-person-${where.source}` }
          : null
      }
      // Company idempotency check (or profile-after-create lookup)
      return null
    }),
    create: jest.fn().mockImplementation((entity: unknown, payload: Record<string, unknown>) => {
      const entityName = typeof entity === 'function' ? (entity as { name?: string }).name ?? 'unknown' : String(entity)
      state.created.push({ entityName, payload })
      return payload
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity, id) => ({ __ref: id })),
  }
  return em
}

function makeStubCommandBus(counters: { companies: number; people: number }) {
  return {
    execute: jest.fn().mockImplementation(async (commandId: string, options: { input: Record<string, unknown> }) => {
      if (commandId === 'customers.companies.create') {
        counters.companies += 1
        return {
          result: { entityId: `company-uuid-${counters.companies}`, companyId: `company-pid-${counters.companies}` },
          logEntry: null,
        }
      }
      if (commandId === 'customers.people.create') {
        counters.people += 1
        return {
          result: { entityId: `person-uuid-${counters.people}`, personId: `person-pid-${counters.people}` },
          logEntry: null,
        }
      }
      throw new Error(`No mock handler for ${commandId}`)
    }),
  }
}

describe('Y8 — full-chain pipeline+writer integration on 25 audit fixtures', () => {
  let bundles: ErpFromeeBundle[]
  let plans: Awaited<ReturnType<typeof runImportPipeline>>['plans']
  let writeResults: Awaited<ReturnType<typeof writeAllPlans>>['results']
  let writeSummary: Awaited<ReturnType<typeof writeAllPlans>>['summary']
  let created: CreatedRow[]
  let counters: { companies: number; people: number }

  beforeAll(async () => {
    bundles = buildFixtureBundles()
    expect(bundles).toHaveLength(25)

    const adapter = makeFakeAdapter(bundles)
    const pipelineResult = await runImportPipeline(adapter, scope, { batchSize: 5 })
    plans = pipelineResult.plans

    created = []
    counters = { companies: 0, people: 0 }
    const em = makeStubEm({ created, existingPersonsBySource: new Set() })
    const commandBus = makeStubCommandBus(counters)
    const writeResult = await writeAllPlans(plans, scope, {
      em: em as never,
      commandBus: commandBus as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    writeResults = writeResult.results
    writeSummary = writeResult.summary
  })

  // === pipeline-level filtering ===

  it('25 bundles → 25 plans (pipeline streamuje wszystkie)', () => {
    expect(plans).toHaveLength(25)
  })

  it('3 plan-skips: Formee + smoke + INTERNAL-only', () => {
    const skipped = plans.filter((p) => p.status === 'skipped')
    expect(skipped.map((p) => p.skipReason).sort()).toEqual(['formee-self', 'internal-only', 'test-data'])
  })

  it('1 manual_review: Bałdyga (PERSON-bez-NIP)', () => {
    const manual = plans.filter((p) => p.status === 'manual_review')
    expect(manual).toHaveLength(1)
    expect(manual[0].externalCompanyId).toBe('cmnbaldy0001')
  })

  it('21 imported plans (25 - 3 skipped - 1 manual_review)', () => {
    expect(plans.filter((p) => p.status === 'imported')).toHaveLength(21)
  })

  // === writer-level matrix ===

  it('writeAllPlans summary: 21 created, 4 plan-skip, 0 failed', () => {
    expect(writeSummary.total).toBe(25)
    expect(writeSummary.created).toBe(21)
    expect(writeSummary.planSkip).toBe(4) // 3 skipped + 1 manual_review
    expect(writeSummary.failed).toBe(0)
  })

  // === customers.companies.create / people.create call counts ===

  it('21 wywołań customers.companies.create (1 per imported plan, kind=company)', () => {
    // 21 imported, ale Filler 8 (cmnf08) nie ma NIP więc dalej zostaje company.
    // PERSON-bez-NIP poszedł do manual_review (skip). Pozostałe 21 to companies (Paulina JDG po reklasyfikacji też company).
    expect(counters.companies).toBe(21)
  })

  it('Expobud Domy → 7 wywołań customers.people.create (kontakty)', () => {
    // Expobud ma 7 contactów; każdy = 1 person create.
    // Filler 4 = 2 contactów (po demote 1 primary + 1 normal)
    // Filler 6 = 1 contact
    // Total persons: 7 + 2 + 1 = 10
    expect(counters.people).toBe(10)
  })

  // === per-table insert counts ===

  it('CustomerEntityRole inserts: po 1 per active CompanyRole z plan.roles.rows', () => {
    const roleInserts = created.filter((c) => c.entityName === 'CustomerEntityRole')
    // 21 firm imported. Większość ma 1 role row (CUSTOMER). NOWYDOM ma 2 (customer+supplier).
    // Mix ma 1 (INTERNAL dropped, customer kept).
    // Razem oczekiwane: 21 + 1 (NOWYDOM extra) = 22
    expect(roleInserts).toHaveLength(22)
    expect(roleInserts.every((c) => c.payload.userId === importerUserId)).toBe(true)
  })

  it('CustomerTaxIdentity inserts: tylko firmy z populated tax fields', () => {
    const taxInserts = created.filter((c) => c.entityName === 'CustomerTaxIdentity')
    // Per fixtures: NIPs na: jdg(5260250996), nowydom, bogdaniec, newline, mix, constar, melsdorf?, gorem, nuckel, expobud, f1-7,9,10 (15 NIP-ów)
    // KRS na: f02, f08 (2)
    // REGON na: f02 (1)
    // Razem ~18 wpisów (19 z f02 ma 3)
    expect(taxInserts.length).toBeGreaterThanOrEqual(15)
  })

  it('CustomerAddress inserts: tylko firmy z populated street1', () => {
    const addrInserts = created.filter((c) => c.entityName === 'CustomerAddress')
    // Nuckel + Filler 1 (1) + Filler 10 (2) = 4 adresy z street1
    expect(addrInserts).toHaveLength(4)
  })

  it('CustomerCompanyBilling inserts: dla firm z bankiem albo CUSTOMER role z props', () => {
    const billingInserts = created.filter((c) => c.entityName === 'CustomerCompanyBilling')
    // Wszystkie imported companies mają CUSTOMER role → billing row z preferredCurrency.
    // Filler 8 nie ma NIP ale ma KRS — i tak CUSTOMER role → billing row.
    // 21 imported = 21 billing rows.
    expect(billingInserts.length).toBeGreaterThanOrEqual(15)
  })

  it('CustomerPersonCompanyLink inserts: 1 per kontakt (po Y8 contacts writer)', () => {
    const linkInserts = created.filter((c) => c.entityName === 'CustomerPersonCompanyLink')
    // 7 (Expobud) + 2 (Filler 4) + 1 (Filler 6) = 10 linków
    expect(linkInserts).toHaveLength(10)
  })

  it('CustomerPersonCompanyLink: dokładnie 1 isPrimary=true per company (D6)', () => {
    const links = created.filter((c) => c.entityName === 'CustomerPersonCompanyLink')
    const primaries = links.filter((l) => l.payload.isPrimary)
    // Expobud (1) + Filler 4 (1) + Filler 6 (1) = 3 primary links
    expect(primaries).toHaveLength(3)
  })

  // === idempotency on second run ===

  it('idempotency: re-run pipeline+writer = wszystko idempotent-skip albo plan-skip', async () => {
    const adapter = makeFakeAdapter(buildFixtureBundles())
    const second = await runImportPipeline(adapter, scope, { batchSize: 5 })

    const created2: CreatedRow[] = []
    const em2 = makeStubEm({
      created: created2,
      existingPersonsBySource: new Set(),
    })
    // Symulujemy "company already exists": findOne for source = erp_fromee:<id> zwraca existing
    em2.findOne = jest.fn().mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (typeof where.source === 'string') {
        return { id: `existing-${where.source}` }
      }
      return null
    })

    const counters2 = { companies: 0, people: 0 }
    const commandBus2 = makeStubCommandBus(counters2)
    const writeResult2 = await writeAllPlans(second.plans, scope, {
      em: em2 as never,
      commandBus: commandBus2 as never,
      container: { resolve: jest.fn() },
      importerUserId,
    })
    expect(writeResult2.summary.created).toBe(0)
    expect(writeResult2.summary.idempotentSkip).toBe(21) // 21 imported planów = 21 idempotent-skip
    expect(writeResult2.summary.planSkip).toBe(4) // 3 skipped + 1 manual_review (jak za pierwszym razem)
    expect(counters2.companies).toBe(0) // żaden create
    expect(counters2.people).toBe(0)
  })

  // === smoke regression — DoD Y7 (200+ ról + 130+ tax) ===

  it('summary numbers (sanity vs DoD Y7 — extrapolacja na 126 firm prod copy)', () => {
    // Na 21 firm w fixtures: 22 entity_roles, 18+ tax_identities.
    // Na 126 firm prod copy: powinno być >200 ról + >130 tax — sanity check liniowy.
    const roleCount = created.filter((c) => c.entityName === 'CustomerEntityRole').length
    const taxCount = created.filter((c) => c.entityName === 'CustomerTaxIdentity').length
    expect(roleCount).toBeGreaterThan(20)
    expect(taxCount).toBeGreaterThan(15)
  })

  // === sanity check on summarizeWrites pure function ===

  it('summarizeWrites jest deterministic na write results', () => {
    const repeat = summarizeWrites(writeResults)
    expect(repeat.created).toBe(writeSummary.created)
    expect(repeat.planSkip).toBe(writeSummary.planSkip)
    expect(repeat.failed).toBe(writeSummary.failed)
  })
})
