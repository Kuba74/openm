import { mapRoles, __testables } from '../roles'
import type { ErpFromeeCompanyRole, ErpFromeeRoleType, ImportScope } from '../../types'

const scope: ImportScope = {
  organizationId: 'a1111111-2222-4333-8444-555555555551',
  tenantId: 'a1111111-2222-4333-8444-555555555552',
}

function buildRole(overrides: Partial<ErpFromeeCompanyRole> = {}): ErpFromeeCompanyRole {
  return {
    id: 'role_a',
    companyId: 'company_x',
    roleType: 'CUSTOMER',
    isActive: true,
    currency: null,
    paymentTerms: null,
    deliveryTerms: null,
    priceGroup: null,
    creditLimit: null,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('pickPrimaryLifecycleStage', () => {
  it('prefers CUSTOMER over SUPPLIER', () => {
    expect(__testables.pickPrimaryLifecycleStage(['SUPPLIER', 'CUSTOMER'])).toBe('customer')
  })

  it('falls back to PROSPECT when no CUSTOMER', () => {
    expect(__testables.pickPrimaryLifecycleStage(['PROSPECT', 'LEAD'])).toBe('prospect')
  })

  it('returns null for empty array', () => {
    expect(__testables.pickPrimaryLifecycleStage([])).toBeNull()
  })

  it('returns first role when only INTERNAL given (defensive)', () => {
    expect(__testables.pickPrimaryLifecycleStage(['INTERNAL'])).toBe('internal')
  })
})

describe('mapRoles', () => {
  it('maps single CUSTOMER role', () => {
    const plan = mapRoles({ companyId: 'company_x', roles: [buildRole()] }, scope)
    expect(plan.skip).toBe(false)
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0]).toMatchObject({
      externalCompanyId: 'company_x',
      entityType: 'company',
      roleType: 'customer',
    })
    expect(plan.primaryLifecycleStage).toBe('customer')
  })

  it('emits 2 rows for dual CUSTOMER+SUPPLIER', () => {
    const plan = mapRoles({
      companyId: 'company_y',
      roles: [
        buildRole({ id: 'r1', roleType: 'CUSTOMER' }),
        buildRole({ id: 'r2', roleType: 'SUPPLIER' }),
      ],
    }, scope)
    expect(plan.rows).toHaveLength(2)
    expect(plan.rows.map((r) => r.roleType).sort()).toEqual(['customer', 'supplier'])
    expect(plan.primaryLifecycleStage).toBe('customer')
  })

  it('skips Company when all roles INTERNAL (D4)', () => {
    const plan = mapRoles({
      companyId: 'internal_co',
      roles: [
        buildRole({ id: 'r1', roleType: 'INTERNAL' }),
        buildRole({ id: 'r2', roleType: 'INTERNAL' }),
      ],
    }, scope)
    expect(plan.skip).toBe(true)
    expect(plan.skipReason).toBe('internal-only')
    expect(plan.rows).toHaveLength(0)
  })

  it('drops INTERNAL when accompanied by other role', () => {
    const plan = mapRoles({
      companyId: 'company_z',
      roles: [
        buildRole({ id: 'r1', roleType: 'INTERNAL' }),
        buildRole({ id: 'r2', roleType: 'CUSTOMER' }),
      ],
    }, scope)
    expect(plan.skip).toBe(false)
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0].roleType).toBe('customer')
    expect(plan.warnings.some((w) => w.includes('INTERNAL dropped'))).toBe(true)
  })

  it('ignores inactive roles', () => {
    const plan = mapRoles({
      companyId: 'company_w',
      roles: [
        buildRole({ id: 'r1', roleType: 'CUSTOMER', isActive: false }),
        buildRole({ id: 'r2', roleType: 'SUPPLIER', isActive: true }),
      ],
    }, scope)
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0].roleType).toBe('supplier')
  })

  it('emits empty when no active roles + warning', () => {
    const plan = mapRoles({
      companyId: 'company_v',
      roles: [buildRole({ isActive: false })],
    }, scope)
    expect(plan.skip).toBe(false)
    expect(plan.rows).toHaveLength(0)
    expect(plan.warnings.some((w) => w.includes('no active roles'))).toBe(true)
  })

  it('deduplicates duplicate role types', () => {
    const plan = mapRoles({
      companyId: 'company_dup',
      roles: [
        buildRole({ id: 'r1', roleType: 'CUSTOMER' }),
        buildRole({ id: 'r2', roleType: 'CUSTOMER' }),
      ],
    }, scope)
    expect(plan.rows).toHaveLength(1)
    expect(plan.warnings.some((w) => w.includes('duplicate'))).toBe(true)
  })

  it('passes organizationId/tenantId from scope', () => {
    const plan = mapRoles({ companyId: 'company_x', roles: [buildRole()] }, scope)
    expect(plan.rows[0].organizationId).toBe(scope.organizationId)
    expect(plan.rows[0].tenantId).toBe(scope.tenantId)
  })

  it('maps all 8 erp-fromee role types to openm lowercase', () => {
    const allTypes: ErpFromeeRoleType[] = [
      'CUSTOMER', 'SUPPLIER', 'PROSPECT', 'LEAD', 'PARTNER', 'CARRIER', 'BANK',
    ]  // INTERNAL excluded — covered by skip test above
    const plan = mapRoles({
      companyId: 'company_all',
      roles: allTypes.map((roleType, i) => buildRole({ id: `r${i}`, roleType })),
    }, scope)
    expect(plan.rows.map((r) => r.roleType).sort()).toEqual([
      'bank', 'carrier', 'customer', 'lead', 'partner', 'prospect', 'supplier',
    ])
    expect(plan.primaryLifecycleStage).toBe('customer')
  })

  it('SUPPLIER-only Company → primaryLifecycleStage="supplier"', () => {
    const plan = mapRoles({
      companyId: 'supplier_only',
      roles: [buildRole({ roleType: 'SUPPLIER' })],
    }, scope)
    expect(plan.primaryLifecycleStage).toBe('supplier')
  })
})
