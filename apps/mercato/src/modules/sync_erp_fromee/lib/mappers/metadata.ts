import type {
  ErpFromeeCompany,
  ErpFromeeCompanySourceLink,
  ImportScope,
} from '../types'

/**
 * Output shape: a metadata blob ready to be merged into
 * `customer_entities.metadata` for the imported Company.
 *
 * Fields:
 * - `external_links`: array of cross-system identifiers (D3 — modeled as array
 *   even though 99% of source companies have exactly one element). Each entry
 *   carries `{ source_system, external_id, last_sync_at? }`. Includes the
 *   ambient `erp_fromee` link plus any `CompanySourceLink` rows the source
 *   had registered (idempotency anchor for cross-system reconciliation).
 * - `legacy_klient_firma_id`: surfaced from `Company.metadata.legacyKlientFirmaId`
 *   when present (audit trail per D5; tax IDs themselves come from top-level
 *   columns).
 * - `legacy_metadata`: passthrough of `Company.metadata` minus the keys we
 *   already promoted (`legacyKlientFirmaId`, `taxId`, `regon`, `krs`, `vatEu`).
 * - `legacy_created_at` / `legacy_updated_at`: ISO timestamps from the source
 *   row — preserved so the UI can show "imported / originally created" dates.
 */
export type MetadataPlan = {
  externalId: string                    // erp-fromee Company.id (parent reference)
  organizationId: string
  tenantId: string
  metadata: {
    external_links: ExternalLink[]
    legacy_klient_firma_id: string | null
    legacy_metadata: Record<string, unknown> | null
    legacy_created_at: string
    legacy_updated_at: string
    legacy_source_system: 'erp_fromee'
  }
  warnings: string[]
}

export type ExternalLink = {
  source_system: string
  external_id: string
  last_sync_at: string | null
}

/** Keys we promote elsewhere — drop them from `legacy_metadata` to avoid duplication. */
const PROMOTED_METADATA_KEYS = new Set([
  'legacyKlientFirmaId',
  'taxId',
  'regon',
  'krs',
  'vatEu',
])

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function pruneLegacyMetadata(
  source: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!source || typeof source !== 'object') return null
  const pruned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (PROMOTED_METADATA_KEYS.has(key)) continue
    pruned[key] = value
  }
  return Object.keys(pruned).length > 0 ? pruned : null
}

function buildExternalLinks(
  source: ErpFromeeCompany,
  links: ErpFromeeCompanySourceLink[],
  warnings: string[],
): ExternalLink[] {
  const out: ExternalLink[] = []
  const seen = new Set<string>()

  // Always anchor with the `erp_fromee` provenance link — every imported row
  // carries this so reverse-lookup ("which source row produced this entity?")
  // is always available.
  const ambientKey = `erp_fromee:${source.id}`
  out.push({ source_system: 'erp_fromee', external_id: source.id, last_sync_at: null })
  seen.add(ambientKey)

  for (const link of links) {
    const system = sanitizeString(link.sourceSystem)
    const externalId = sanitizeString(link.externalId)
    if (!system || !externalId) {
      warnings.push(
        `Company ${source.id}: dropped CompanySourceLink ${link.id} (missing sourceSystem or externalId)`,
      )
      continue
    }
    const key = `${system}:${externalId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      source_system: system,
      external_id: externalId,
      last_sync_at: link.lastSyncAt ? link.lastSyncAt.toISOString() : null,
    })
  }

  return out
}

/**
 * Maps Company-level provenance (CompanySourceLink rows + JSONB metadata
 * + timestamps) into a single `customer_entities.metadata` blob.
 *
 * Decyzje aplikowane:
 * - **D3** External-link as array. Audit: 99% Companies have exactly one
 *   `CompanySourceLink` row, but the schema models it as N to keep room for
 *   multi-source reconciliation (e.g. when the same Company also exists in
 *   a CRM). Mapper always anchors with the ambient `erp_fromee → Company.id`
 *   link, then dedup-merges any registered `CompanySourceLink` rows.
 * - **D5** Top-level columns (taxId/regon/krs/vatEu) are authoritative. We
 *   surface `metadata.legacyKlientFirmaId` to a stable field for audit but
 *   strip the tax-related keys from `legacy_metadata` so they don't ghost
 *   the canonical tax identity rows.
 *
 * Returned `legacy_metadata` is `null` when the source has none / only
 * promoted keys — keeps `customer_entities.metadata` payload clean.
 */
export function mapMetadata(
  source: ErpFromeeCompany,
  sourceLinks: ErpFromeeCompanySourceLink[],
  scope: ImportScope,
): MetadataPlan {
  const warnings: string[] = []
  const externalLinks = buildExternalLinks(source, sourceLinks, warnings)

  const legacyKlientFirmaId =
    source.metadata && typeof source.metadata === 'object'
      ? sanitizeString((source.metadata as Record<string, unknown>).legacyKlientFirmaId)
      : null

  const legacyMetadata = pruneLegacyMetadata(source.metadata)

  return {
    externalId: source.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    metadata: {
      external_links: externalLinks,
      legacy_klient_firma_id: legacyKlientFirmaId,
      legacy_metadata: legacyMetadata,
      legacy_created_at: source.createdAt.toISOString(),
      legacy_updated_at: source.updatedAt.toISOString(),
      legacy_source_system: 'erp_fromee',
    },
    warnings,
  }
}

export const __testables = { sanitizeString, pruneLegacyMetadata, PROMOTED_METADATA_KEYS, buildExternalLinks }
