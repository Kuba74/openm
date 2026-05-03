/**
 * Matrix spec dla pipeline'u importu erp-fromee → openm.
 *
 * Zamiast Playwright'a (który by wymagał fixture postgres'a z 8272-line
 * Prisma schema) używamy fake'owego `ErpFromeeAdapter` zwracającego
 * 25 hard-coded bundlów odzwierciedlających ID-ki z 2 dokumentów audit:
 *
 * - 10 firm-trudnych z `docs/erp-fromee-import-edge-cases-2026-05-03.md`
 * - 15 satellite ID-ków (contacts/addresses/banks) z
 *   `docs/erp-fromee-import-edge-cases-contacts-addresses-banks-2026-05-03.md`
 *
 * Spec sprawdza pełną matrycę: 25 ID × 8 mapperów na poziomie integracyjnym
 * (mappers ↔ pipeline ↔ filtry D12/D13). Dla pełnej weryfikacji prod-copy
 * (25 firm w prawdziwym Postgresie) potrzebny jest osobny smoke run via CLI
 * z `FORMEE_LEGACY_DATABASE_URL` skierowanym na lokalny snapshot — co jest
 * w gestii operatora.
 */
import {
  aggregateReport,
  runImportPipeline,
  FORMEE_TENANT_COMPANY_ID,
} from '../pipeline'
import type { ErpFromeeAdapter } from '../erpFromeeAdapter'
import type {
  ErpFromeeBundle,
  ErpFromeeCompany,
  ErpFromeeCompanyAddress,
  ErpFromeeCompanyBankAccount,
  ErpFromeeCompanyContact,
  ErpFromeeCompanyRole,
  ErpFromeeCompanySourceLink,
  ErpFromeeRoleType,
  ImportScope,
} from '../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

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

/**
 * 25 fixture bundlów z auditów. Każdy ID jest realnym ID z prod-copy (z dwóch
 * raportów audit) — pozwala spec'owi sprawdzić cały zestaw decyzji D1-D13.
 */
function buildFixtureBundles(): ErpFromeeBundle[] {
  return [
    // === 10 firm-trudnych ===
    // 1. Formee Sp. z o.o. — D13 hard-skip by name + ID
    bundle(
      buildCompany({
        id: FORMEE_TENANT_COMPANY_ID,
        legalName: 'Formee Sp. z o.o.',
        displayName: 'Formee Sp. z o.o.',
      }),
    ),
    // 2. Smoke fixture — D12 skip
    bundle(
      buildCompany({
        id: 'cmnsmoke0000lghttest0001',
        legalName: 'Smoke Test Customer',
        displayName: 'smoke-test-001',
      }),
    ),
    // 3. JDG — Paulina Smolarska, PERSON+NIP → reklasyfikacja na company+jdg (D11)
    bundle(
      buildCompany({
        id: 'cmnjdg0000007lghtsmolar01',
        kind: 'PERSON',
        legalName: 'PAULINA SMOLARSKA',
        displayName: 'Paulina Smolarska JDG',
        taxId: '5260250996',
      }),
    ),
    // 4. Bałdyga Daniel — PERSON-bez-NIP → manual_review (też ma EUR currency + PL IBAN)
    bundle(
      buildCompany({
        id: 'cmnbcn4d1004flgbrkimwxn0x',
        kind: 'PERSON',
        legalName: 'Bałdyga Daniel',
        displayName: 'Bałdyga Daniel',
        taxId: null,
      }),
      {
        roles: [buildRole({ companyId: 'cmnbcn4d1004flgbrkimwxn0x', currency: 'EUR' })],
        bankAccounts: [
          buildBank({
            id: 'bank_baldyga',
            companyId: 'cmnbcn4d1004flgbrkimwxn0x',
            iban: 'PL61109010140000071219812874',
          }),
        ],
      },
    ),
    // 5. NOWYDOM — dual CUSTOMER + SUPPLIER role
    bundle(
      buildCompany({
        id: 'cmndual0000007lghtnowyd01',
        legalName: 'NOWYDOM Sp. z o.o.',
        displayName: 'NOWYDOM',
        taxId: '5260250997',
      }),
      {
        roles: [
          buildRole({ id: 'r_cust', companyId: 'cmndual0000007lghtnowyd01', roleType: 'CUSTOMER' }),
          buildRole({ id: 'r_sup', companyId: 'cmndual0000007lghtnowyd01', roleType: 'SUPPLIER' }),
        ],
      },
    ),
    // 6. Urząd Gminy Bogdaniec — multi-source (FORMEE + Salesforce)
    bundle(
      buildCompany({
        id: 'cmnmulti000007lghtbogd001',
        legalName: 'Urząd Gminy Bogdaniec',
        displayName: 'Urząd Gminy Bogdaniec',
        taxId: '5990200111',
      }),
      {
        sourceLinks: [
          buildLink({
            id: 'sl_sf',
            companyId: 'cmnmulti000007lghtbogd001',
            sourceSystem: 'salesforce',
            externalId: 'sf_bogd_001',
          }),
        ],
      },
    ),
    // 7. Newline-firma — sanitize legalName z literalnym \n
    bundle(
      buildCompany({
        id: 'cmnnewln0000007lghtplan01',
        legalName: 'Planungsgesellschaft\n  mbh   &\nCo.   KG',
        displayName: null,
        taxId: '5990200222',
      }),
    ),
    // 8. INTERNAL-only — D4 skip
    bundle(
      buildCompany({
        id: 'cmnintern00007lghtinter01',
        legalName: 'Internal Holding',
        displayName: 'Internal Holding',
      }),
      {
        roles: [
          buildRole({ id: 'r_int', companyId: 'cmnintern00007lghtinter01', roleType: 'INTERNAL' }),
        ],
      },
    ),
    // 9. INTERNAL + CUSTOMER — INTERNAL drop, CUSTOMER imported
    bundle(
      buildCompany({
        id: 'cmnmix000000007lghtmix001',
        legalName: 'Mix Internal Customer',
        displayName: 'Mix Internal Customer',
        taxId: '5990200333',
      }),
      {
        roles: [
          buildRole({ id: 'r_int', companyId: 'cmnmix000000007lghtmix001', roleType: 'INTERNAL' }),
          buildRole({ id: 'r_cust', companyId: 'cmnmix000000007lghtmix001', roleType: 'CUSTOMER' }),
        ],
      },
    ),
    // 10. ORGANIZATION bez tax ID — warning ale OK
    bundle(
      buildCompany({
        id: 'cmnnoid00000007lghtnotax1',
        legalName: 'No-Tax Org',
        displayName: 'No-Tax Org',
        taxId: null,
      }),
    ),

    // === 15 satellite ID-ków ===
    // 11. Constar GmbH — broken bank (no IBAN)
    bundle(
      buildCompany({
        id: 'cmnap2afj009alghtzdrdtjwp',
        legalName: 'Constar GmbH',
        displayName: 'Constar GmbH',
        taxId: '5990200444',
        countryCode: 'DE',
      }),
      {
        roles: [buildRole({ companyId: 'cmnap2afj009alghtzdrdtjwp', currency: 'EUR' })],
        bankAccounts: [
          buildBank({
            id: 'bank_constar',
            companyId: 'cmnap2afj009alghtzdrdtjwp',
            iban: null,
            bankName: 'Sparkasse',
            swift: null,
          }),
        ],
      },
    ),
    // 12. Thomas Melsdorf — broken bank (empty IBAN)
    bundle(
      buildCompany({
        id: 'cmnap2byv04zolght0qsxihre',
        legalName: 'Thomas Melsdorf',
        displayName: 'Thomas Melsdorf',
        taxId: '5990200555',
        kind: 'PERSON',
        countryCode: 'DE',
      }),
      {
        roles: [buildRole({ companyId: 'cmnap2byv04zolght0qsxihre' })],
        bankAccounts: [
          buildBank({
            id: 'bank_melsdorf',
            companyId: 'cmnap2byv04zolght0qsxihre',
            iban: '',
          }),
        ],
      },
    ),
    // 13. GOREM PREFA — currency NULL → default PLN
    bundle(
      buildCompany({
        id: 'cmnap2c7r05tmlghthjjwshzg',
        legalName: 'GOREM PREFA Sp. z o.o.',
        displayName: 'GOREM PREFA',
        taxId: '5990200666',
      }),
      {
        roles: [buildRole({ companyId: 'cmnap2c7r05tmlghthjjwshzg', currency: null })],
        bankAccounts: [
          buildBank({ id: 'bank_gorem', companyId: 'cmnap2c7r05tmlghthjjwshzg' }),
        ],
      },
    ),
    // 14. Nuckel Architekten Hamburg — DE address w PL countryCode (D11 leave-as-is)
    bundle(
      buildCompany({
        id: 'cmnaqmwwc00eilgqqx3yix94p',
        legalName: 'Nuckel Architekten Hamburg',
        displayName: 'Nuckel Architekten Hamburg',
        taxId: '5990200777',
      }),
      {
        addresses: [
          buildAddress({
            id: 'addr_nuckel',
            companyId: 'cmnaqmwwc00eilgqqx3yix94p',
            city: 'Hamburg',
            countryCode: 'PL',
          }),
        ],
      },
    ),
    // 15. Expobud Domy — 7 contacts, sanity dla mappera #4
    bundle(
      buildCompany({
        id: 'cmnap2aeu006vlght0n7bkbic',
        legalName: 'Expobud Domy Sp. z o.o.',
        displayName: 'Expobud Domy',
        taxId: '5990200888',
      }),
      {
        contacts: Array.from({ length: 7 }).map((_, i) =>
          buildContact({
            id: `contact_expo_${i}`,
            companyId: 'cmnap2aeu006vlght0n7bkbic',
            firstName: `First${i}`,
            lastName: `Last${i}`,
            createdAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
          }),
        ),
      },
    ),
    // 16-25. Filler firmy z różnymi configami dla matrix coverage
    bundle(
      buildCompany({
        id: 'cmnfill00000007lghtfill01',
        legalName: 'Filler 1 Sp. z o.o.',
        displayName: 'Filler 1',
        taxId: '1110000001',
      }),
      {
        addresses: [
          buildAddress({
            id: 'addr_f1',
            companyId: 'cmnfill00000007lghtfill01',
            type: 'INVOICE',
            isPrimary: true,
          }),
        ],
      },
    ),
    bundle(
      buildCompany({
        id: 'cmnfill00000007lghtfill02',
        legalName: 'Filler 2',
        displayName: 'Filler 2',
        taxId: '1110000002',
        regon: '111000003',
        krs: '0000111111',
      }),
    ),
    bundle(
      buildCompany({
        id: 'cmnfill00000007lghtfill03',
        legalName: 'Filler 3 GmbH',
        displayName: 'Filler 3',
        taxId: '1110000004',
        countryCode: 'DE',
      }),
      {
        roles: [buildRole({ companyId: 'cmnfill00000007lghtfill03', currency: 'EUR' })],
      },
    ),
    bundle(
      buildCompany({
        id: 'cmnfill00000007lghtfill04',
        legalName: 'Filler 4 (multi-primary contacts)',
        displayName: 'Filler 4',
        taxId: '1110000005',
      }),
      {
        contacts: [
          buildContact({
            id: 'c_f4_a',
            companyId: 'cmnfill00000007lghtfill04',
            firstName: 'Anna',
            lastName: 'Kowalska',
            isPrimary: true,
            createdAt: new Date('2024-01-01T10:00:00Z'),
          }),
          buildContact({
            id: 'c_f4_b',
            companyId: 'cmnfill00000007lghtfill04',
            firstName: 'Bogdan',
            lastName: 'Nowak',
            isPrimary: true,
            createdAt: new Date('2024-01-02T10:00:00Z'),
          }),
        ],
      },
    ),
    bundle(
      buildCompany({
        id: 'cmnfill00000007lghtfill05',
        legalName: 'Filler 5 (multi-bank)',
        displayName: 'Filler 5',
        taxId: '1110000006',
      }),
      {
        bankAccounts: [
          buildBank({
            id: 'bank_f5_a',
            companyId: 'cmnfill00000007lghtfill05',
            iban: 'PL00000000000000000000000001',
            isPrimary: true,
          }),
          buildBank({
            id: 'bank_f5_b',
            companyId: 'cmnfill00000007lghtfill05',
            iban: 'PL00000000000000000000000002',
            createdAt: new Date('2024-01-02T10:00:00Z'),
          }),
        ],
      },
    ),
    bundle(
      buildCompany({
        id: 'cmnfill00000007lghtfill06',
        legalName: 'Filler 6 — auto-promote contact',
        displayName: 'Filler 6',
        taxId: '1110000007',
      }),
      {
        contacts: [
          buildContact({
            id: 'c_f6_a',
            companyId: 'cmnfill00000007lghtfill06',
            firstName: 'Tomek',
            isPrimary: false,
          }),
        ],
      },
    ),
    bundle(
      buildCompany({
        id: 'cmnfill00000007lghtfill07',
        legalName: 'Filler 7 — auto-promote bank',
        displayName: 'Filler 7',
        taxId: '1110000008',
      }),
      {
        bankAccounts: [
          buildBank({
            id: 'bank_f7_a',
            companyId: 'cmnfill00000007lghtfill07',
            iban: 'PL00000000000000000000000007',
            isPrimary: false,
            createdAt: new Date('2024-01-01T10:00:00Z'),
          }),
          buildBank({
            id: 'bank_f7_b',
            companyId: 'cmnfill00000007lghtfill07',
            iban: 'PL00000000000000000000000008',
            isPrimary: false,
            createdAt: new Date('2024-01-02T10:00:00Z'),
          }),
        ],
      },
    ),
    bundle(
      buildCompany({
        id: 'cmnfill00000007lghtfill08',
        legalName: 'Filler 8 — only KRS, no NIP',
        displayName: 'Filler 8',
        taxId: null,
        krs: '0000222222',
      }),
    ),
    bundle(
      buildCompany({
        id: 'cmnfill00000007lghtfill09',
        legalName: 'Filler 9 S.A.',
        displayName: 'Filler 9',
        taxId: '1110000010',
      }),
    ),
    bundle(
      buildCompany({
        id: 'cmnfill00000007lghtfill10',
        legalName: 'Filler 10 — DELIVERY+INVOICE addresses',
        displayName: 'Filler 10',
        taxId: '1110000011',
      }),
      {
        addresses: [
          buildAddress({
            id: 'addr_f10_d',
            companyId: 'cmnfill00000007lghtfill10',
            type: 'DELIVERY',
          }),
          buildAddress({
            id: 'addr_f10_i',
            companyId: 'cmnfill00000007lghtfill10',
            type: 'INVOICE',
          }),
        ],
      },
    ),
  ]
}

/**
 * Fake adapter zwraca wszystkie bundle bez filtrowania po roleTypes — celowo,
 * bo chcemy żeby spec sprawdzał całą ścieżkę filtrowania pipeline'u (D4
 * INTERNAL-only, D12 test, D13 Formee). Realny `createErpFromeeAdapter` w
 * Postgresie filtruje przez `INNER JOIN CompanyRole` na warstwie SQL —
 * mappery i pipeline mają drugi pas walidacji jako defensive layer.
 */
function makeFakeAdapter(bundles: ErpFromeeBundle[]): ErpFromeeAdapter {
  return {
    async countCustomerCompanies() {
      return bundles.length
    },
    async *fetchCustomerBundles(options: {
      roleTypes: readonly ErpFromeeRoleType[]
      limit?: number | null
      batchSize?: number
    }) {
      const limit = options.limit ?? null
      const out = limit !== null ? bundles.slice(0, limit) : bundles
      const batchSize = options.batchSize ?? 100
      for (let i = 0; i < out.length; i += batchSize) {
        yield out.slice(i, i + batchSize)
      }
    },
  }
}

describe('pipeline matrix — 25 audit fixture bundles', () => {
  let bundles: ErpFromeeBundle[]
  let plans: Awaited<ReturnType<typeof runImportPipeline>>['plans']
  let report: Awaited<ReturnType<typeof runImportPipeline>>['report']

  beforeAll(async () => {
    bundles = buildFixtureBundles()
    expect(bundles).toHaveLength(25)
    const adapter = makeFakeAdapter(bundles)
    const result = await runImportPipeline(adapter, scope, { batchSize: 5 })
    plans = result.plans
    report = result.report
  })

  it('streams all 25 bundles', () => {
    expect(plans).toHaveLength(25)
    expect(report.total).toBe(25)
  })

  it('imports 22 firms (25 − 1 Formee − 1 smoke − 1 INTERNAL-only); 1 manual_review (Bałdyga)', () => {
    // Formee + smoke + INTERNAL-only = 3 skipped; Bałdyga = 1 manual_review;
    // pozostałe 21 = imported.
    expect(report.skipped.total).toBe(3)
    expect(report.manualReview).toHaveLength(1)
    expect(report.imported).toBe(21)
  })

  it('skips Formee tenant by hard-coded ID (D13)', () => {
    const formee = plans.find((p) => p.externalCompanyId === FORMEE_TENANT_COMPANY_ID)
    expect(formee?.status).toBe('skipped')
    expect(formee?.skipReason).toBe('formee-self')
  })

  it('skips smoke fixture (D12)', () => {
    const smoke = plans.find((p) => p.externalCompanyId === 'cmnsmoke0000lghttest0001')
    expect(smoke?.status).toBe('skipped')
    expect(smoke?.skipReason).toBe('test-data')
  })

  it('skips INTERNAL-only company (D4)', () => {
    const internal = plans.find((p) => p.externalCompanyId === 'cmnintern00007lghtinter01')
    expect(internal?.status).toBe('skipped')
    expect(internal?.skipReason).toBe('internal-only')
  })

  it('JDG (Paulina Smolarska): kind=company, legal_form=jdg, NIP w tax_identities', () => {
    const jdg = plans.find((p) => p.externalCompanyId === 'cmnjdg0000007lghtsmolar01')
    expect(jdg?.status).toBe('imported')
    expect(jdg?.partner.entity?.kind).toBe('company')
    const profile = jdg?.partner.profile as { kind: 'company'; legalForm: string | null } | undefined
    expect(profile?.legalForm).toBe('jdg')
    expect(jdg?.taxIdentities.rows.find((r) => r.kind === 'nip')?.value).toBe('5260250996')
  })

  it('PERSON-bez-NIP (Bałdyga Daniel): kind=person, manual_review', () => {
    const baldyga = plans.find((p) => p.externalCompanyId === 'cmnbcn4d1004flgbrkimwxn0x')
    expect(baldyga?.status).toBe('manual_review')
    expect(baldyga?.manualReviewReason).toBe('person-without-nip')
    expect(baldyga?.partner.entity?.kind).toBe('person')
  })

  it('NOWYDOM dual-role: 2 wpisy w customer_entity_roles', () => {
    const nowydom = plans.find((p) => p.externalCompanyId === 'cmndual0000007lghtnowyd01')
    expect(nowydom?.roles.rows.map((r) => r.roleType).sort()).toEqual(['customer', 'supplier'])
  })

  it('Urząd Gminy Bogdaniec multi-source: external_links.length === 2 (erp_fromee + salesforce)', () => {
    const gmina = plans.find((p) => p.externalCompanyId === 'cmnmulti000007lghtbogd001')
    expect(gmina?.metadata.metadata.external_links).toHaveLength(2)
    expect(gmina?.metadata.metadata.external_links.map((l) => l.source_system).sort()).toEqual([
      'erp_fromee',
      'salesforce',
    ])
  })

  it('newline-firma sanitized: legalName === "Planungsgesellschaft mbh & Co. KG" (no \\n)', () => {
    const newline = plans.find((p) => p.externalCompanyId === 'cmnnewln0000007lghtplan01')
    const profile = newline?.partner.profile as { kind: 'company'; legalName: string | null } | undefined
    expect(profile?.legalName).toBe('Planungsgesellschaft mbh & Co. KG')
    expect(profile?.legalName).not.toContain('\n')
  })

  it('INTERNAL+CUSTOMER → CUSTOMER imported, INTERNAL dropped', () => {
    const mix = plans.find((p) => p.externalCompanyId === 'cmnmix000000007lghtmix001')
    expect(mix?.status).toBe('imported')
    expect(mix?.roles.rows.map((r) => r.roleType)).toEqual(['customer'])
  })

  it('Constar+Melsdorf: 0 banks imported, broken-bank entry w raporcie', () => {
    const constar = plans.find((p) => p.externalCompanyId === 'cmnap2afj009alghtzdrdtjwp')
    const melsdorf = plans.find((p) => p.externalCompanyId === 'cmnap2byv04zolght0qsxihre')
    expect(constar?.banks.primary).toBeNull()
    expect(melsdorf?.banks.primary).toBeNull()
    expect(report.brokenBanks.map((b) => b.bankId).sort()).toEqual(['bank_constar', 'bank_melsdorf'])
  })

  it('GOREM PREFA: NULL currency → defaulted PLN w billing', () => {
    const gorem = plans.find((p) => p.externalCompanyId === 'cmnap2c7r05tmlghthjjwshzg')
    expect(gorem?.billing.row?.preferredCurrency).toBe('PLN')
  })

  it('Nuckel Architekten Hamburg: address Hamburg + countryCode PL preserved (D11 leave-as-is)', () => {
    const nuckel = plans.find((p) => p.externalCompanyId === 'cmnaqmwwc00eilgqqx3yix94p')
    expect(nuckel?.addresses.rows[0].city).toBe('Hamburg')
    expect(nuckel?.addresses.rows[0].countryCode).toBe('PL')
  })

  it('Expobud Domy: 7 contactów imported, jeden auto-promoted as primary', () => {
    const expo = plans.find((p) => p.externalCompanyId === 'cmnap2aeu006vlght0n7bkbic')
    expect(expo?.contacts.persons).toHaveLength(7)
    expect(expo?.contacts.links.filter((l) => l.isPrimary)).toHaveLength(1)
    expect(expo?.contacts.warnings.some((w) => w.includes('auto-promoted contact_expo_0'))).toBe(true)
  })

  it('Bałdyga: PL IBAN + EUR currency w billing', () => {
    const baldyga = plans.find((p) => p.externalCompanyId === 'cmnbcn4d1004flgbrkimwxn0x')
    expect(baldyga?.banks.primary?.iban).toBe('PL61109010140000071219812874')
    expect(baldyga?.billing.row?.preferredCurrency).toBe('EUR')
  })

  it('agreguje auto-promoted contacts (Expobud + Filler 6)', () => {
    expect(report.autoPromotedContacts.length).toBeGreaterThanOrEqual(2)
    const ids = report.autoPromotedContacts.map((p) => p.externalCompanyId)
    expect(ids).toContain('cmnap2aeu006vlght0n7bkbic')
    expect(ids).toContain('cmnfill00000007lghtfill06')
  })

  it('agreguje auto-promoted banks (Filler 7)', () => {
    const ids = report.autoPromotedBanks.map((p) => p.externalCompanyId)
    expect(ids).toContain('cmnfill00000007lghtfill07')
  })

  it('demote multi-primary contacts (Filler 4 — pierwszy wins, drugi demoted)', () => {
    const filler4 = plans.find((p) => p.externalCompanyId === 'cmnfill00000007lghtfill04')
    const primaryLinks = filler4?.contacts.links.filter((l) => l.isPrimary) ?? []
    expect(primaryLinks).toHaveLength(1)
    expect(primaryLinks[0].externalContactId).toBe('c_f4_a')
    expect(filler4?.contacts.warnings.some((w) => w.includes('demoted c_f4_b'))).toBe(true)
  })

  it('multi-bank Filler 5: pierwszy primary, drugi w skipped (Faza 4)', () => {
    const filler5 = plans.find((p) => p.externalCompanyId === 'cmnfill00000007lghtfill05')
    expect(filler5?.banks.primary?.externalBankId).toBe('bank_f5_a')
    expect(filler5?.banks.skipped.map((s) => s.id)).toEqual(['bank_f5_b'])
  })

  it('idempotency: re-run pipeline na tym samym fixture daje identyczny raport', async () => {
    const adapter = makeFakeAdapter(buildFixtureBundles())
    const second = await runImportPipeline(adapter, scope, { batchSize: 5 })
    expect(second.plans).toHaveLength(plans.length)
    expect(second.report.total).toBe(report.total)
    expect(second.report.imported).toBe(report.imported)
    expect(second.report.skipped.total).toBe(report.skipped.total)
    expect(second.report.skipped.byReason).toEqual(report.skipped.byReason)
    expect(second.report.brokenBanks.map((b) => b.bankId).sort()).toEqual(
      report.brokenBanks.map((b) => b.bankId).sort(),
    )
  })

  it('aggregateReport jest czystą funkcją (re-aggregate planów daje identyczny raport)', () => {
    const reAggregated = aggregateReport(plans, report.durationMs)
    expect(reAggregated.imported).toBe(report.imported)
    expect(reAggregated.skipped.total).toBe(report.skipped.total)
    expect(reAggregated.manualReview).toEqual(report.manualReview)
  })

  it('respektuje --limit option', async () => {
    const adapter = makeFakeAdapter(buildFixtureBundles())
    const limited = await runImportPipeline(adapter, scope, { limit: 5 })
    expect(limited.plans).toHaveLength(5)
  })
})
