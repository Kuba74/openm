import type { ErpFromeeCompany, ImportScope } from '../types'

/**
 * Output of `mapCompanyToPartner`. We don't construct ORM entities directly
 * here — that's the pipeline's responsibility. Mapper returns plain shapes
 * that the pipeline upserts via mikro-orm.
 */
export type PartnerImportPlan = {
  /** Skip this company entirely (D4 INTERNAL-only, D12 test data, D13 Formee). */
  skip: boolean
  skipReason?: string
  /** Warnings that should land in the dry-run report. */
  warnings: string[]
  /** Customer entity row to upsert (when not skipped). */
  entity?: PartnerEntityRow
  /** Profile row (1:1 with entity) — kind matches `entity.kind`. */
  profile?: PartnerCompanyRow | PartnerPersonRow
}

export type PartnerEntityRow = {
  externalId: string                    // erp-fromee Company.id
  organizationId: string
  tenantId: string
  kind: 'company' | 'person'
  displayName: string
  description: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  isActive: boolean
  metadata: Record<string, unknown>
}

export type PartnerCompanyRow = {
  kind: 'company'
  legalName: string | null
  brandName: string | null
  legalForm: string | null
  entityType: string | null
  fullAddressKrs: string | null
}

export type PartnerPersonRow = {
  kind: 'person'
  firstName: string | null
  lastName: string | null
}

const PL_LEGAL_FORM_MAP: Record<string, string> = {
  'Sp. z o.o.': 'sp_z_oo',
  'Sp. z o.o': 'sp_z_oo',
  'sp. z o.o.': 'sp_z_oo',
  'spółka z o.o.': 'sp_z_oo',
  'S.A.': 's_a',
  'SA': 's_a',
  'GmbH': 'gmbh',
  'JDG': 'jdg',
  'Jednoosobowa działalność gospodarcza': 'jdg',
  'Sp.j.': 'sp_j',
  'Sp. j.': 'sp_j',
  'Sp. komandytowa': 'sp_k',
  'Sp.k.': 'sp_k',
  'Spółka cywilna': 's_c',
  'Sp. cywilna': 's_c',
  'Fundacja': 'fundacja',
  'Stowarzyszenie': 'stowarzyszenie',
}

const ENTITY_TYPE_MAP: Record<string, string> = {
  'Firma': 'organization',
  'Osoba prywatna': 'consumer',
}

/** D12: regex for test/smoke fixtures we never want to import. */
const TEST_DATA_REGEX = /^(test|smoke)/i

/** D13: hardcoded company name to skip (the importing company itself). */
const FORMEE_DISPLAY_NAMES = new Set([
  'Formee Sp. z o.o.',
  'Formee Sp. z o.o',
  'Formee',
])

/** Sanitize free-text input: trim + collapse internal whitespace runs. */
function sanitize(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed : null
}

function mapLegalForm(formaPrawna: string | null | undefined): string | null {
  const cleaned = sanitize(formaPrawna)
  if (!cleaned) return null
  const direct = PL_LEGAL_FORM_MAP[cleaned]
  if (direct) return direct
  // Fallback: lowercase slug, replace non-alphanumeric with underscore.
  return cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function mapEntityType(typPodmiotu: string | null | undefined): string | null {
  const cleaned = sanitize(typPodmiotu)
  if (!cleaned) return null
  return ENTITY_TYPE_MAP[cleaned] ?? null
}

function splitDisplayName(displayName: string): { firstName: string | null; lastName: string | null } {
  const cleaned = displayName.trim()
  if (!cleaned) return { firstName: null, lastName: null }
  const parts = cleaned.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: null }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/**
 * Maps an erp-fromee `Company` row into a Partner import plan.
 *
 * Decisions applied:
 * - **D2** JDG reclassification: PERSON+NIP → company + legal_form='jdg'.
 *   PERSON without NIP stays as person (manual_review flag).
 * - **D5** taxId on Company is authoritative; metadata.legacyKlientFirmaId
 *   preserved only as audit trail in `metadata.external_links`.
 * - **D12** Skip rows whose displayName/legalName starts with "test" or "smoke".
 * - **D13** Skip Formee Sp. z o.o. (the importing tenant itself).
 *
 * The mapper does NOT decide kind from `roles` alone — that's `roles.ts`.
 * Here we only fix kind when JDG reclassification applies.
 */
export function mapCompanyToPartner(
  source: ErpFromeeCompany,
  scope: ImportScope,
): PartnerImportPlan {
  const warnings: string[] = []

  const displayName = sanitize(source.displayName) ?? sanitize(source.legalName)
  if (!displayName) {
    return {
      skip: true,
      skipReason: 'missing-display-name',
      warnings: [`Company ${source.id} has neither displayName nor legalName — skipped`],
    }
  }

  // D13 — hard skip.
  if (FORMEE_DISPLAY_NAMES.has(displayName)) {
    return {
      skip: true,
      skipReason: 'formee-self',
      warnings: [`Skipped Formee self-reference (Company ${source.id})`],
    }
  }

  // D12 — test/smoke fixtures.
  if (TEST_DATA_REGEX.test(displayName)) {
    return {
      skip: true,
      skipReason: 'test-data',
      warnings: [`Skipped test/smoke fixture "${displayName}" (Company ${source.id})`],
    }
  }

  const taxId = sanitize(source.taxId)
  // D2 — JDG reclassification.
  // PERSON kind in erp-fromee with NIP populated = sole proprietor, model
  // as company with legal_form='jdg' in openm.
  let kind: 'company' | 'person'
  let isJdg = false
  if (source.kind === 'PERSON' && taxId) {
    kind = 'company'
    isJdg = true
  } else if (source.kind === 'PERSON') {
    kind = 'person'
    warnings.push(`Person without tax ID — manual review recommended (Company ${source.id})`)
  } else {
    kind = 'company'
  }

  const metadata: Record<string, unknown> = {
    external_id: source.id,
    source: 'erp_fromee',
    partner_no: source.companyNo ?? null,
    short_name: sanitize(source.shortName),
    is_blocked: source.isBlocked === true,
    block_reason: null,                 // Phase 4 will pull from metadata.powodBlokady
    external_links: {
      erp_fromee_company_id: source.id,
    },
  }

  // D5 — preserve legacyKlientFirmaId only as audit trail.
  const sourceMeta = (source.metadata ?? {}) as Record<string, unknown>
  const legacyId = typeof sourceMeta.legacyKlientFirmaId === 'string' ? sourceMeta.legacyKlientFirmaId : null
  if (legacyId) {
    ;(metadata.external_links as Record<string, unknown>).legacy_klient_firma_id = legacyId
    if (taxId && typeof sourceMeta.taxId === 'string' && sourceMeta.taxId !== source.taxId) {
      warnings.push(
        `Tax ID mismatch on Company ${source.id}: top-level "${source.taxId}" vs metadata.taxId "${sourceMeta.taxId}". Top-level wins (D5).`,
      )
    }
  }

  const entity: PartnerEntityRow = {
    externalId: source.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    kind,
    displayName,
    description: sanitize(source.note),
    primaryEmail: null,                 // populated by contacts mapper
    primaryPhone: null,
    isActive: source.isActive,
    metadata,
  }

  let profile: PartnerCompanyRow | PartnerPersonRow
  if (kind === 'company') {
    profile = {
      kind: 'company',
      legalName: sanitize(source.legalName),
      brandName: sanitize(source.shortName),
      legalForm: isJdg ? 'jdg' : mapLegalForm(typeof sourceMeta.formaPrawna === 'string' ? sourceMeta.formaPrawna : null),
      entityType: mapEntityType(typeof sourceMeta.typPodmiotu === 'string' ? sourceMeta.typPodmiotu : null),
      fullAddressKrs: sanitize(typeof sourceMeta.pelnyAdresKRS === 'string' ? sourceMeta.pelnyAdresKRS : null),
    }
  } else {
    const { firstName, lastName } = splitDisplayName(displayName)
    profile = { kind: 'person', firstName, lastName }
  }

  return {
    skip: false,
    warnings,
    entity,
    profile,
  }
}

export const __testables = { sanitize, mapLegalForm, mapEntityType, splitDisplayName }
