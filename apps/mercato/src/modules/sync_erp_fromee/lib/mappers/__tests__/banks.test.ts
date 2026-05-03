import { mapBanks, __testables } from '../banks'
import type { ErpFromeeCompanyBankAccount, ImportScope } from '../../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

function buildBank(overrides: Partial<ErpFromeeCompanyBankAccount> = {}): ErpFromeeCompanyBankAccount {
  return {
    id: 'bank_a',
    companyId: 'company_x',
    bankName: 'PKO BP',
    iban: 'PL61109010140000071219812874',
    swift: 'BPKOPLPW',
    isPrimary: false,
    isActive: true,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    ...overrides,
  }
}

describe('normalizeIban', () => {
  it('strips spaces and uppercases', () => {
    expect(__testables.normalizeIban('  pl 6110 9010 1400 0007 1219 8128 74  ')).toBe(
      'PL61109010140000071219812874',
    )
  })
  it('returns null for empty/null', () => {
    expect(__testables.normalizeIban(null)).toBeNull()
    expect(__testables.normalizeIban('')).toBeNull()
    expect(__testables.normalizeIban('   ')).toBeNull()
  })
})

describe('normalizeSwift', () => {
  it('strips spaces and uppercases', () => {
    expect(__testables.normalizeSwift(' bpko plpw ')).toBe('BPKOPLPW')
  })
  it('returns null for empty/null', () => {
    expect(__testables.normalizeSwift(null)).toBeNull()
    expect(__testables.normalizeSwift('')).toBeNull()
  })
})

describe('mapBanks', () => {
  it('returns null primary when company has no bank accounts (1074/1140 case)', () => {
    const plan = mapBanks({ companyId: 'company_x', bankAccounts: [] }, scope)
    expect(plan.primary).toBeNull()
    expect(plan.skipped).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  it('emits single bank when exactly one active', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [buildBank({ id: 'b1' })],
    }, scope)
    expect(plan.primary?.externalBankId).toBe('b1')
    expect(plan.primary?.iban).toBe('PL61109010140000071219812874')
    expect(plan.skipped).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  it('honors isPrimary flag when explicit', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [
        buildBank({ id: 'b1', createdAt: new Date('2024-01-01T10:00:00Z') }),
        buildBank({ id: 'b2', isPrimary: true, createdAt: new Date('2024-01-02T10:00:00Z'), iban: 'PL00000000000000000000000002' }),
      ],
    }, scope)
    expect(plan.primary?.externalBankId).toBe('b2')
  })

  it('auto-promotes earliest active when no isPrimary (65/66 case)', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [
        buildBank({ id: 'b2', createdAt: new Date('2024-01-02T10:00:00Z') }),
        buildBank({ id: 'b1', createdAt: new Date('2024-01-01T10:00:00Z'), iban: 'PL00000000000000000000000001' }),
      ],
    }, scope)
    expect(plan.primary?.externalBankId).toBe('b1')
    expect(plan.warnings.some((w) => w.includes('auto-promoted b1'))).toBe(true)
  })

  it('skips non-primary actives in MVP (D10 multi-bank → Faza 4)', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [
        buildBank({ id: 'b1', isPrimary: true }),
        buildBank({ id: 'b2', createdAt: new Date('2024-01-02T10:00:00Z'), iban: 'PL00000000000000000000000002' }),
        buildBank({ id: 'b3', createdAt: new Date('2024-01-03T10:00:00Z'), iban: 'PL00000000000000000000000003' }),
      ],
    }, scope)
    expect(plan.primary?.externalBankId).toBe('b1')
    expect(plan.skipped).toHaveLength(2)
    expect(plan.skipped.map((s) => s.id).sort()).toEqual(['b2', 'b3'])
    expect(plan.skipped.every((s) => s.reason.includes('Faza 4'))).toBe(true)
    expect(plan.warnings.some((w) => w.includes('D10 single-bank MVP'))).toBe(true)
  })

  it('drops Constar GmbH bank without IBAN (cmnap2afj009alghtzdrdtjwp per audit)', () => {
    const plan = mapBanks({
      companyId: 'cmnap2afj009alghtzdrdtjwp',
      bankAccounts: [buildBank({
        id: 'bank_constar',
        iban: null,
        bankName: 'Sparkasse',
        swift: null,
      })],
    }, scope)
    expect(plan.primary).toBeNull()
    expect(plan.skipped).toEqual([{ id: 'bank_constar', reason: 'missing IBAN' }])
    expect(plan.warnings.some((w) => w.includes('all bank accounts missing IBAN'))).toBe(true)
  })

  it('drops Thomas Melsdorf bank without IBAN (cmnap2byv04zolght0qsxihre per audit)', () => {
    const plan = mapBanks({
      companyId: 'cmnap2byv04zolght0qsxihre',
      bankAccounts: [buildBank({ id: 'bank_melsdorf', iban: '' })],
    }, scope)
    expect(plan.primary).toBeNull()
    expect(plan.skipped).toEqual([{ id: 'bank_melsdorf', reason: 'missing IBAN' }])
  })

  it('imports Bałdyga PL IBAN (cmnbcn4d1004flgbrkimwxn0x — IBAN+EUR currency on parent)', () => {
    const plan = mapBanks({
      companyId: 'cmnbcn4d1004flgbrkimwxn0x',
      bankAccounts: [buildBank({
        id: 'bank_baldyga',
        iban: 'PL61109010140000071219812874',
      })],
    }, scope)
    expect(plan.primary?.externalBankId).toBe('bank_baldyga')
    expect(plan.primary?.iban).toBe('PL61109010140000071219812874')
  })

  it('falls back to next bank with IBAN when first lacks one', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [
        buildBank({ id: 'b1', isPrimary: true, iban: null }),
        buildBank({ id: 'b2', createdAt: new Date('2024-01-02T10:00:00Z'), iban: 'PL00000000000000000000000002' }),
      ],
    }, scope)
    expect(plan.primary?.externalBankId).toBe('b2')
    expect(plan.skipped.some((s) => s.id === 'b1' && s.reason.includes('missing IBAN'))).toBe(true)
  })

  it('drops inactive banks silently', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [
        buildBank({ id: 'b1', isActive: false }),
        buildBank({ id: 'b2', isActive: true, createdAt: new Date('2024-01-02T10:00:00Z') }),
      ],
    }, scope)
    expect(plan.primary?.externalBankId).toBe('b2')
    expect(plan.skipped.find((s) => s.id === 'b1')?.reason).toBe('inactive')
  })

  it('returns null primary when ALL banks inactive', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [
        buildBank({ id: 'b1', isActive: false }),
        buildBank({ id: 'b2', isActive: false }),
      ],
    }, scope)
    expect(plan.primary).toBeNull()
    expect(plan.skipped.every((s) => s.reason === 'inactive')).toBe(true)
  })

  it('normalizes IBAN by stripping spaces and uppercasing', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [buildBank({
        iban: 'pl61 1090 1014 0000 0712 1981 2874',
      })],
    }, scope)
    expect(plan.primary?.iban).toBe('PL61109010140000071219812874')
  })

  it('emits IBAN in plain text (D11 encryption applied by pipeline layer)', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [buildBank({ iban: 'PL61109010140000071219812874' })],
    }, scope)
    expect(plan.primary?.iban).toBe('PL61109010140000071219812874')
    expect(plan.primary?.iban).not.toMatch(/^enc:/)
  })

  it('passes organizationId/tenantId from scope', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [buildBank()],
    }, scope)
    expect(plan.primary?.organizationId).toBe(scope.organizationId)
    expect(plan.primary?.tenantId).toBe(scope.tenantId)
  })

  it('preserves externalCompanyId for FK resolution', () => {
    const plan = mapBanks({
      companyId: 'cmnbcn4d1004flgbrkimwxn0x',
      bankAccounts: [buildBank({ id: 'bank_baldyga' })],
    }, scope)
    expect(plan.primary?.externalCompanyId).toBe('cmnbcn4d1004flgbrkimwxn0x')
    expect(plan.primary?.externalBankId).toBe('bank_baldyga')
  })

  it('sanitizes bank name', () => {
    const plan = mapBanks({
      companyId: 'company_x',
      bankAccounts: [buildBank({ bankName: '  PKO   BP   S.A.  ' })],
    }, scope)
    expect(plan.primary?.bankName).toBe('PKO BP S.A.')
  })
})
