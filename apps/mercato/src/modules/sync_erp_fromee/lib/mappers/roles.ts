import type { ErpFromeeCompanyRole, ErpFromeeRoleType, ImportScope } from '../types'

/**
 * Output: rows ready to be upserted into `customer_entity_roles`.
 * One source Company with multiple roles produces multiple rows
 * (e.g. dual CUSTOMER+SUPPLIER → 2 rows).
 */
export type EntityRoleRow = {
  externalCompanyId: string             // erp-fromee Company.id (parent)
  organizationId: string
  tenantId: string
  entityType: 'company' | 'person'      // entity_roles is generic; we emit 'company' for Company source
  roleType: string                      // 'customer' | 'supplier' | 'prospect' | ... (lowercase per openm dictionary)
  /** Sales-side properties (currency, paymentTerms) attached to CUSTOMER role
   * are NOT stored on customer_entity_roles in MVP — they go to
   * customer_company_billing via a separate mapper. */
}

export type RolesPlan = {
  /** Skip this Company entirely — all roles INTERNAL (D4). */
  skip: boolean
  skipReason?: string
  rows: EntityRoleRow[]
  /** Lifecycle stage hint for customer_entities.lifecycle_stage. */
  primaryLifecycleStage: string | null
  warnings: string[]
}

/** Mapping erp-fromee uppercase role types to openm lowercase dictionary values. */
const ROLE_TYPE_MAP: Record<ErpFromeeRoleType, string> = {
  CUSTOMER: 'customer',
  SUPPLIER: 'supplier',
  PROSPECT: 'prospect',
  LEAD: 'lead',
  PARTNER: 'partner',
  CARRIER: 'carrier',
  BANK: 'bank',
  INTERNAL: 'internal',
}

/** Priority ranking for primary lifecycle stage selection (highest first). */
const LIFECYCLE_PRIORITY: ErpFromeeRoleType[] = [
  'CUSTOMER',
  'PROSPECT',
  'SUPPLIER',
  'LEAD',
  'PARTNER',
  'CARRIER',
  'BANK',
  'INTERNAL',
]

/**
 * Maps erp-fromee `CompanyRole` rows into 1..N customer_entity_role rows.
 *
 * Decisions applied:
 * - **D1** Filter: per Y3 spec, the import pipeline applies the
 *   `roleType IN ('CUSTOMER', 'PROSPECT')` filter at the SQL query level.
 *   This mapper assumes input rows are already filtered, so it accepts
 *   any role type and emits openm rows.
 * - **D4** Skip if all roles are INTERNAL (intra-organization companies).
 *   If INTERNAL co-exists with another role (e.g. CUSTOMER+INTERNAL), the
 *   INTERNAL row is dropped; non-INTERNAL roles are kept.
 *
 * Dual-role example:
 *   Source: Company has both `CUSTOMER` and `SUPPLIER` roles
 *   Output: 2 entity_role rows (`customer` + `supplier`)
 *   Lifecycle: `customer` (higher priority)
 */
export function mapRoles(
  source: { companyId: string; roles: ErpFromeeCompanyRole[] },
  scope: ImportScope,
): RolesPlan {
  const warnings: string[] = []
  const activeRoles = source.roles.filter((r) => r.isActive)

  if (activeRoles.length === 0) {
    return {
      skip: false,
      rows: [],
      primaryLifecycleStage: null,
      warnings: [`Company ${source.companyId} has no active roles`],
    }
  }

  // D4: if every active role is INTERNAL → skip the Company.
  const onlyInternal = activeRoles.every((r) => r.roleType === 'INTERNAL')
  if (onlyInternal) {
    return {
      skip: true,
      skipReason: 'internal-only',
      rows: [],
      primaryLifecycleStage: null,
      warnings: [`Company ${source.companyId} has only INTERNAL role(s) — skipped per D4`],
    }
  }

  // Drop INTERNAL when accompanied by another role.
  const filtered = activeRoles.filter((r) => r.roleType !== 'INTERNAL')
  if (filtered.length < activeRoles.length) {
    warnings.push(
      `Company ${source.companyId} has INTERNAL role alongside others — INTERNAL dropped, kept: ${filtered.map((r) => r.roleType).join(', ')}`,
    )
  }

  // Deduplicate roles of the same type (rare but legit if multi-scope).
  const seen = new Set<ErpFromeeRoleType>()
  const unique = filtered.filter((r) => {
    if (seen.has(r.roleType)) return false
    seen.add(r.roleType)
    return true
  })
  if (unique.length < filtered.length) {
    warnings.push(`Company ${source.companyId} has duplicate role types — deduplicated`)
  }

  const rows: EntityRoleRow[] = unique.map((r) => ({
    externalCompanyId: source.companyId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    entityType: 'company',
    roleType: ROLE_TYPE_MAP[r.roleType],
  }))

  const primaryLifecycleStage = pickPrimaryLifecycleStage(unique.map((r) => r.roleType))

  return {
    skip: false,
    rows,
    primaryLifecycleStage,
    warnings,
  }
}

function pickPrimaryLifecycleStage(roleTypes: ErpFromeeRoleType[]): string | null {
  if (roleTypes.length === 0) return null
  for (const candidate of LIFECYCLE_PRIORITY) {
    if (roleTypes.includes(candidate)) return ROLE_TYPE_MAP[candidate]
  }
  return ROLE_TYPE_MAP[roleTypes[0]]
}

export const __testables = { pickPrimaryLifecycleStage, ROLE_TYPE_MAP }
