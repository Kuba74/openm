import type { ErpFromeeCompanyContact, ImportScope } from '../types'

/**
 * Output shapes for the contacts mapper.
 *
 * One source CompanyContact produces:
 * - 1 customer_entities row (kind=person)
 * - 1 customer_people row (1:1 with entity)
 * - 1 customer_person_company_links row (M:N to the parent company)
 * - 0..N customer_person_company_roles rows (per contactFunction mapping)
 */
export type ContactPersonRow = {
  externalId: string                    // erp-fromee CompanyContact.id
  organizationId: string
  tenantId: string
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
  isActive: boolean
  metadata: Record<string, unknown>
}

export type ContactProfileRow = {
  externalId: string
  firstName: string | null
  lastName: string | null
  jobTitle: string | null
  department: string | null
}

export type ContactCompanyLinkRow = {
  externalContactId: string             // erp-fromee CompanyContact.id
  externalCompanyId: string             // erp-fromee Company.id
  organizationId: string
  tenantId: string
  isPrimary: boolean
}

export type ContactRoleRow = {
  externalContactId: string
  externalCompanyId: string
  organizationId: string
  tenantId: string
  roleValue: string                     // openm dictionary slug
}

export type ContactPlan = {
  persons: ContactPersonRow[]
  profiles: ContactProfileRow[]
  links: ContactCompanyLinkRow[]
  roles: ContactRoleRow[]
  warnings: string[]
}

/** D8: German contactFunction → openm person_company_role dictionary slug. */
const CONTACT_FUNCTION_MAP: Record<string, string> = {
  'Architekt': 'architect',
  'Statiker': 'structural_engineer',
  'Bauherr': 'project_owner',
  'Verkauf': 'sales',
  'Einkauf': 'procurement',
  'Buchhaltung': 'accounting',
  'Qualität': 'quality',
  'Logistik': 'logistics',
  'Technik': 'technical',
  'Sonstige': 'other',
}

function sanitize(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed : null
}

function buildDisplayName(contact: ErpFromeeCompanyContact): string | null {
  const explicit = sanitize(contact.displayName)
  if (explicit) return explicit
  const first = sanitize(contact.firstName)
  const last = sanitize(contact.lastName)
  if (first && last) return `${first} ${last}`
  return first ?? last ?? null
}

function mapContactFunction(german: string | null | undefined): { value: string | null; warning: string | null } {
  const cleaned = sanitize(german)
  if (!cleaned) return { value: null, warning: null }
  const mapped = CONTACT_FUNCTION_MAP[cleaned]
  if (mapped) return { value: mapped, warning: null }
  return {
    value: 'other',
    warning: `Unmapped contactFunction "${cleaned}" defaulted to 'other'`,
  }
}

/**
 * Maps erp-fromee CompanyContact rows for a single Company into openm
 * person + link + role rows.
 *
 * Decyzje aplikowane:
 * - **D6** Multi-primary contacts: first-wins per createdAt ASC. If a
 *   Company has multiple `isPrimary=true` rows, only the earliest stays
 *   primary in openm; rest demoted with a warning. The partial unique
 *   index on `customer_person_company_links` (Tydzień 1) enforces this
 *   at DB level — pre-emptive demotion avoids constraint violation.
 * - **Auto-promote**: if NO contact has isPrimary=true but at least one
 *   exists, promote the earliest active contact (per createdAt ASC) as
 *   primary. Empty input list yields zero output rows (no auto-creation).
 * - **D8** German contactFunction inline mapping (10 known values),
 *   fallback `'other'` with warning per unmapped value.
 *
 * Inactive contacts are imported (with `is_active=false`) — historical
 * audit trail useful for recovering past communication. Primary handling
 * applies only to active contacts.
 */
export function mapContacts(
  source: { companyId: string; contacts: ErpFromeeCompanyContact[] },
  scope: ImportScope,
): ContactPlan {
  const persons: ContactPersonRow[] = []
  const profiles: ContactProfileRow[] = []
  const links: ContactCompanyLinkRow[] = []
  const roles: ContactRoleRow[] = []
  const warnings: string[] = []

  if (source.contacts.length === 0) {
    return { persons, profiles, links, roles, warnings }
  }

  // Sort by createdAt ASC for D6 first-wins + auto-promote determinism.
  const sorted = [...source.contacts].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )

  // Determine primary contact (D6 + auto-promote).
  const activeContacts = sorted.filter((c) => c.isActive)
  let primaryId: string | null = null

  const explicitPrimaries = activeContacts.filter((c) => c.isPrimary)
  if (explicitPrimaries.length === 1) {
    primaryId = explicitPrimaries[0].id
  } else if (explicitPrimaries.length > 1) {
    primaryId = explicitPrimaries[0].id // first per createdAt ASC
    const demotedIds = explicitPrimaries.slice(1).map((c) => c.id)
    warnings.push(
      `Company ${source.companyId}: ${explicitPrimaries.length} primary contacts — kept ${primaryId} (earliest), demoted ${demotedIds.join(', ')}`,
    )
  } else if (activeContacts.length > 0) {
    primaryId = activeContacts[0].id
    warnings.push(
      `Company ${source.companyId}: no primary contact flagged — auto-promoted ${primaryId} (earliest active)`,
    )
  }

  for (const contact of sorted) {
    const displayName = buildDisplayName(contact)
    if (!displayName) {
      warnings.push(`Skipped CompanyContact ${contact.id} (Company ${source.companyId}): no name available`)
      continue
    }

    const personMetadata: Record<string, unknown> = {
      external_id: contact.id,
      source: 'erp_fromee',
      external_links: {
        erp_fromee_contact_id: contact.id,
        erp_fromee_company_id: source.companyId,
      },
    }

    persons.push({
      externalId: contact.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      displayName,
      primaryEmail: sanitize(contact.email),
      primaryPhone: sanitize(contact.phone),
      isActive: contact.isActive,
      metadata: personMetadata,
    })

    profiles.push({
      externalId: contact.id,
      firstName: sanitize(contact.firstName),
      lastName: sanitize(contact.lastName),
      jobTitle: sanitize(contact.jobTitle),
      department: sanitize(contact.department),
    })

    links.push({
      externalContactId: contact.id,
      externalCompanyId: source.companyId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      isPrimary: contact.id === primaryId,
    })

    const { value: roleValue, warning: roleWarning } = mapContactFunction(contact.contactFunction)
    if (roleWarning) warnings.push(`Contact ${contact.id}: ${roleWarning}`)
    if (roleValue) {
      roles.push({
        externalContactId: contact.id,
        externalCompanyId: source.companyId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        roleValue,
      })
    }
  }

  return { persons, profiles, links, roles, warnings }
}

export const __testables = { sanitize, buildDisplayName, mapContactFunction, CONTACT_FUNCTION_MAP }
