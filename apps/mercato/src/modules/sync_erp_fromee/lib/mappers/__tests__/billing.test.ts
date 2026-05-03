import { mapBilling, maskIban, DEFAULT_OFFER_VALIDITY_DAYS, __testables } from '../billing'
import type { BankAccountRow } from '../banks'
import type {
  ErpFromeeCompany,
  ErpFromeeCompanyRole,
  ImportScope,
} from '../../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

function buildCompany(overrides: Partial<ErpFromeeCompany> = {}): ErpFromeeCompany {
  return {
    id: 'company_x',
    companyNo: 'C-001',
    kind: 'ORGANIZATION',
    legalName: 'Test Sp. z o.o.',
    displayName: null,
    shortName: null,
    searchTerm: null,
    taxId: '5260250996',
    regon: null,
    krs: null,
    vatEu: null,
    countryCode: 'PL',
    defaultLanguage: 'pl',
    isActive: true,
    isBlocked: false,
    note: null,
    metadata: null,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-06-15T12:30:00Z'),
    ...overrides,
  }
}

function buildRole(overrides: Partial<ErpFromeeCompanyRole> = {}): ErpFromeeCompanyRole {
  return {
    id: 'role_a',
    companyId: 'company_x',
    roleType: 'CUSTOMER',
    isActive: true,
    currency: 'PLN',
    paymentTerms: 'NET 14',
    deliveryTerms: 'EXW',
    priceGroup: 'A',
    creditLimit: '50000',
    createdAt: new Date('2024-01-01T10:00:00Z'),
    ...overrides,
  }
}

function buildBank(overrides: Partial<BankAccountRow> = {}): BankAccountRow {
  return {
    externalBankId: 'bank_a',
    externalCompanyId: 'company_x',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    bankName: 'PKO BP',
    iban: 'PL61109010140000071219812874',
    swift: 'BPKOPLPW',
    ...overrides,
  }
}

describe('maskIban', () => {
  it('masks middle, keeps first 4 + last 4', () => {
    expect(maskIban('PL61109010140000071219812874')).toBe('PL61 ******************** 2874')
  })
  it('strips spaces and uppercases before masking', () => {
    expect(maskIban('  pl61 1090 1014 0000 0712 1981 2874  ')).toBe('PL61 ******************** 2874')
  })
  it('returns null for too-short IBAN', () => {
    expect(maskIban('PL61')).toBeNull()
    expect(maskIban('PL61109')).toBeNull()
  })
  it('returns null for null input', () => {
    expect(maskIban(null)).toBeNull()
  })
})

describe('normalizeCurrency', () => {
  it('uppercases and limits to 3 chars', () => {
    expect(__testables.normalizeCurrency('eur')).toBe('EUR')
    expect(__testables.normalizeCurrency('PolishZloty')).toBe('POL')
  })
  it('returns null for empty', () => {
    expect(__testables.normalizeCurrency(null)).toBeNull()
    expect(__testables.normalizeCurrency('  ')).toBeNull()
  })
})

describe('pickCustomerRole', () => {
  it('returns null when no CUSTOMER role exists', () => {
    expect(__testables.pickCustomerRole([buildRole({ roleType: 'SUPPLIER' })])).toBeNull()
  })
  it('returns null when only inactive CUSTOMER role exists', () => {
    expect(__testables.pickCustomerRole([buildRole({ isActive: false })])).toBeNull()
  })
  it('picks earliest active CUSTOMER on ties', () => {
    const role = __testables.pickCustomerRole([
      buildRole({ id: 'r1', createdAt: new Date('2024-02-01T10:00:00Z') }),
      buildRole({ id: 'r2', createdAt: new Date('2024-01-01T10:00:00Z') }),
    ])
    expect(role?.id).toBe('r2')
  })
  it('ignores SUPPLIER role even when it is the earliest', () => {
    const role = __testables.pickCustomerRole([
      buildRole({ id: 'r1', roleType: 'SUPPLIER', createdAt: new Date('2024-01-01T10:00:00Z') }),
      buildRole({ id: 'r2', roleType: 'CUSTOMER', createdAt: new Date('2024-02-01T10:00:00Z') }),
    ])
    expect(role?.id).toBe('r2')
  })
})

describe('COUNTRY_CURRENCY_FALLBACK', () => {
  it('covers core EU/EN markets', () => {
    expect(__testables.COUNTRY_CURRENCY_FALLBACK.PL).toBe('PLN')
    expect(__testables.COUNTRY_CURRENCY_FALLBACK.DE).toBe('EUR')
    expect(__testables.COUNTRY_CURRENCY_FALLBACK.GB).toBe('GBP')
    expect(__testables.COUNTRY_CURRENCY_FALLBACK.US).toBe('USD')
  })
})

describe('resolveCurrency', () => {
  it('uses CUSTOMER role currency when present', () => {
    expect(__testables.resolveCurrency(buildRole({ currency: 'EUR' }), buildCompany())).toBe('EUR')
  })
  it('falls back to country mapping when CUSTOMER role currency null', () => {
    expect(__testables.resolveCurrency(buildRole({ currency: null }), buildCompany({ countryCode: 'DE' }))).toBe('EUR')
  })
  it('falls back to PLN when no CUSTOMER role and no country match', () => {
    expect(__testables.resolveCurrency(null, buildCompany({ countryCode: 'XX' }))).toBe('PLN')
  })
})

describe('mapBilling', () => {
  it('returns null row when no bank, no CUSTOMER role, no sales props', () => {
    const plan = mapBilling(buildCompany(), [], null, scope)
    expect(plan.row).toBeNull()
  })

  it('emits row with bank only when no CUSTOMER role (suppliers/leads with bank)', () => {
    const plan = mapBilling(buildCompany(), [], buildBank(), scope)
    expect(plan.row).not.toBeNull()
    expect(plan.row?.bankName).toBe('PKO BP')
    expect(plan.row?.paymentTerms).toBeNull()
    expect(plan.row?.preferredCurrency).toBe('PLN')
    expect(plan.warnings.some((w) => w.includes('no active CUSTOMER role'))).toBe(true)
  })

  it('emits row with CUSTOMER role only when no bank present', () => {
    const plan = mapBilling(buildCompany(), [buildRole()], null, scope)
    expect(plan.row).not.toBeNull()
    expect(plan.row?.bankName).toBeNull()
    expect(plan.row?.bankAccountMasked).toBeNull()
    expect(plan.row?.paymentTerms).toBe('NET 14')
    expect(plan.warnings.some((w) => w.includes('no usable bank account'))).toBe(true)
  })

  it('emits full row with bank + CUSTOMER role', () => {
    const plan = mapBilling(buildCompany(), [buildRole()], buildBank(), scope)
    expect(plan.row).toMatchObject({
      bankName: 'PKO BP',
      bankAccountMasked: 'PL61 ******************** 2874',
      paymentTerms: 'NET 14',
      preferredCurrency: 'PLN',
      salesOwnerUserId: null,
      defaultOfferValidityDays: 30,
    })
    expect(plan.row?.legacyExtras).toEqual({
      delivery_terms: 'EXW',
      price_group: 'A',
      credit_limit: '50000',
      primary_bank_external_id: 'bank_a',
    })
  })

  it('respects Bałdyga PL IBAN + EUR currency (cmnbcn4d1004flgbrkimwxn0x audit fixture)', () => {
    const plan = mapBilling(
      buildCompany({ id: 'cmnbcn4d1004flgbrkimwxn0x' }),
      [buildRole({ currency: 'EUR' })],
      buildBank({ externalCompanyId: 'cmnbcn4d1004flgbrkimwxn0x', iban: 'PL61109010140000071219812874' }),
      scope,
    )
    expect(plan.row?.preferredCurrency).toBe('EUR')
    expect(plan.row?.bankAccountMasked).toBe('PL61 ******************** 2874')
  })

  it('defaults GOREM PREFA-style NULL currency to PLN (cmnap2c7r05tmlghthjjwshzg audit fixture)', () => {
    const plan = mapBilling(
      buildCompany({ id: 'cmnap2c7r05tmlghthjjwshzg', countryCode: 'PL' }),
      [buildRole({ currency: null })],
      buildBank({ externalCompanyId: 'cmnap2c7r05tmlghthjjwshzg' }),
      scope,
    )
    expect(plan.row?.preferredCurrency).toBe('PLN')
    expect(plan.warnings.some((w) => w.includes('CUSTOMER role currency missing'))).toBe(true)
  })

  it('preserves deliveryTerms/priceGroup/creditLimit in legacyExtras (no W1 column)', () => {
    const plan = mapBilling(
      buildCompany(),
      [buildRole({ deliveryTerms: 'DDP', priceGroup: 'B', creditLimit: '100000' })],
      buildBank(),
      scope,
    )
    expect(plan.row?.legacyExtras.delivery_terms).toBe('DDP')
    expect(plan.row?.legacyExtras.price_group).toBe('B')
    expect(plan.row?.legacyExtras.credit_limit).toBe('100000')
  })

  it('always emits salesOwnerUserId=null (pipeline resolves)', () => {
    const plan = mapBilling(buildCompany(), [buildRole()], buildBank(), scope)
    expect(plan.row?.salesOwnerUserId).toBeNull()
  })

  it('always emits defaultOfferValidityDays=30 (W1 default)', () => {
    const plan = mapBilling(buildCompany(), [buildRole()], buildBank(), scope)
    expect(plan.row?.defaultOfferValidityDays).toBe(DEFAULT_OFFER_VALIDITY_DAYS)
    expect(plan.row?.defaultOfferValidityDays).toBe(30)
  })

  it('picks earliest active CUSTOMER role when multiple exist', () => {
    const plan = mapBilling(
      buildCompany(),
      [
        buildRole({ id: 'r1', paymentTerms: 'NET 30', createdAt: new Date('2024-02-01T10:00:00Z') }),
        buildRole({ id: 'r2', paymentTerms: 'NET 7', createdAt: new Date('2024-01-01T10:00:00Z') }),
      ],
      buildBank(),
      scope,
    )
    expect(plan.row?.paymentTerms).toBe('NET 7')
  })

  it('ignores SUPPLIER role for billing (only CUSTOMER role drives sales props)', () => {
    const plan = mapBilling(
      buildCompany(),
      [buildRole({ roleType: 'SUPPLIER', paymentTerms: 'NET 999' })],
      buildBank(),
      scope,
    )
    expect(plan.row?.paymentTerms).toBeNull()
  })

  it('sanitizes payment terms (trim + collapse whitespace)', () => {
    const plan = mapBilling(
      buildCompany(),
      [buildRole({ paymentTerms: '  NET   14   days  ' })],
      buildBank(),
      scope,
    )
    expect(plan.row?.paymentTerms).toBe('NET 14 days')
  })

  it('passes externalCompanyId for FK resolution', () => {
    const plan = mapBilling(
      buildCompany({ id: 'cmnap2afj009alghtzdrdtjwp' }),
      [buildRole()],
      buildBank({ externalCompanyId: 'cmnap2afj009alghtzdrdtjwp' }),
      scope,
    )
    expect(plan.row?.externalCompanyId).toBe('cmnap2afj009alghtzdrdtjwp')
  })

  it('passes organizationId/tenantId from scope', () => {
    const plan = mapBilling(buildCompany(), [buildRole()], buildBank(), scope)
    expect(plan.row?.organizationId).toBe(scope.organizationId)
    expect(plan.row?.tenantId).toBe(scope.tenantId)
  })

  it('exposes primary_bank_external_id back-reference for pipeline FK resolution', () => {
    const plan = mapBilling(
      buildCompany(),
      [buildRole()],
      buildBank({ externalBankId: 'bank_baldyga' }),
      scope,
    )
    expect(plan.row?.legacyExtras.primary_bank_external_id).toBe('bank_baldyga')
  })

  it('emits null primary_bank_external_id when no bank present', () => {
    const plan = mapBilling(buildCompany(), [buildRole()], null, scope)
    expect(plan.row?.legacyExtras.primary_bank_external_id).toBeNull()
  })

  it('falls back to DE → EUR via COUNTRY_CURRENCY_FALLBACK when role currency null', () => {
    const plan = mapBilling(
      buildCompany({ countryCode: 'DE' }),
      [buildRole({ currency: null })],
      null,
      scope,
    )
    expect(plan.row?.preferredCurrency).toBe('EUR')
  })

  it('preserves CUSTOMER role currency (EUR) over country fallback', () => {
    const plan = mapBilling(
      buildCompany({ countryCode: 'PL' }),
      [buildRole({ currency: 'EUR' })],
      null,
      scope,
    )
    expect(plan.row?.preferredCurrency).toBe('EUR')
  })

  it('emits row when only deliveryTerms is populated (sanity for sparse CUSTOMER roles)', () => {
    const plan = mapBilling(
      buildCompany(),
      [buildRole({
        currency: null,
        paymentTerms: null,
        deliveryTerms: 'EXW',
        priceGroup: null,
        creditLimit: null,
      })],
      null,
      scope,
    )
    expect(plan.row).not.toBeNull()
    expect(plan.row?.legacyExtras.delivery_terms).toBe('EXW')
  })
})
