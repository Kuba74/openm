/**
 * Catalog Image Enricher
 *
 * Overrides the snapshot's `thumbnailUrl` with a freshly built URL from the
 * product/variant's current `defaultMediaId`. This ensures quote/order lines
 * always reflect the latest product image, even when the underlying attachment
 * changes. The snapshot serves as fallback for deleted products.
 *
 * Uses raw Kysely queries because cross-module ORM entity class references
 * do not resolve correctly at runtime (the imported class does not match the
 * entity registered in MikroORM's metadata by the app bootstrap).
 */

import type { Kysely } from 'kysely'
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { buildAttachmentImageUrl } from '../../attachments/lib/imageUrls'

type LineRecord = Record<string, unknown> & { id: string }

type SnapshotNode = { thumbnailUrl?: string | null; [key: string]: unknown }
type CatalogSnapshot = { product?: SnapshotNode; variant?: SnapshotNode; [key: string]: unknown }

function getDb(em: unknown): Kysely<any> | null {
  const getter = (em as any)?.getKysely
  return typeof getter === 'function' ? getter.call(em) : null
}

async function fetchMediaIds(
  db: Kysely<any>,
  table: string,
  ids: Set<string>,
  organizationId: string,
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (ids.size === 0) return map

  const rows = await (db as any)
    .selectFrom(table)
    .select(['id', 'default_media_id'])
    .where('id', 'in', [...ids])
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .execute() as Array<{ id: string; default_media_id: string | null }>

  for (const row of rows) {
    map.set(row.id, row.default_media_id ? buildAttachmentImageUrl(row.default_media_id) : null)
  }
  return map
}

function enrichRecords(
  records: LineRecord[],
  productMedia: Map<string, string | null>,
  variantMedia: Map<string, string | null>,
): LineRecord[] {
  return records.map((record) => {
    const productId = record['product_id'] as string | undefined
    const variantId = record['product_variant_id'] as string | undefined

    const productUrl = productId ? productMedia.get(productId) : undefined
    const variantUrl = variantId ? variantMedia.get(variantId) : undefined
    if (productUrl === undefined && variantUrl === undefined) return record

    const snapshot = (record['catalog_snapshot'] as CatalogSnapshot | null | undefined) ?? {}
    const updatedSnapshot = { ...snapshot }

    if (productUrl !== undefined) {
      updatedSnapshot.product = { ...snapshot.product, thumbnailUrl: productUrl ?? snapshot.product?.thumbnailUrl }
    }
    if (variantUrl !== undefined) {
      updatedSnapshot.variant = { ...snapshot.variant, thumbnailUrl: variantUrl ?? snapshot.variant?.thumbnailUrl }
    }

    const changed =
      updatedSnapshot.product?.thumbnailUrl !== snapshot.product?.thumbnailUrl ||
      updatedSnapshot.variant?.thumbnailUrl !== snapshot.variant?.thumbnailUrl
    if (!changed) return record

    return { ...record, catalog_snapshot: updatedSnapshot }
  })
}

function createCatalogImageEnricher(targetEntity: string): ResponseEnricher<LineRecord> {
  return {
    id: `sales.catalog-image:${targetEntity}`,
    targetEntity,
    features: [],
    priority: 5,
    timeout: 1000,
    critical: false,
    fallback: {},

    async enrichOne(record, context: EnricherContext) {
      return (await this.enrichMany!([record], context))[0]
    },

    async enrichMany(records, context: EnricherContext) {
      if (records.length === 0) return records

      const db = getDb(context.em)
      if (!db) return records

      const productIds = new Set<string>()
      const variantIds = new Set<string>()
      for (const record of records) {
        if (typeof record['product_id'] === 'string') productIds.add(record['product_id'])
        if (typeof record['product_variant_id'] === 'string') variantIds.add(record['product_variant_id'])
      }
      if (productIds.size === 0 && variantIds.size === 0) return records

      const [productMedia, variantMedia] = await Promise.all([
        fetchMediaIds(db, 'catalog_products', productIds, context.organizationId),
        fetchMediaIds(db, 'catalog_product_variants', variantIds, context.organizationId),
      ])

      return enrichRecords(records, productMedia, variantMedia)
    },
  }
}

type QuoteRecord = Record<string, unknown> & { id: string }

async function fetchSalesOwnerDisplayMap(
  db: Kysely<any>,
  userIds: Set<string>,
  organizationId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (userIds.size === 0) return map
  const ids = [...userIds]

  const teamRows = (await (db as any)
    .selectFrom('staff_team_members')
    .select(['user_id', 'display_name'])
    .where('user_id', 'in', ids)
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .execute()) as Array<{ user_id: string; display_name: string | null }>

  for (const row of teamRows) {
    const name =
      typeof row.display_name === 'string' && row.display_name.trim().length > 0
        ? row.display_name.trim()
        : null
    if (name && !map.has(row.user_id)) {
      map.set(row.user_id, name)
    }
  }

  const missing = ids.filter((id) => !map.has(id))
  if (missing.length === 0) return map

  const userRows = (await (db as any)
    .selectFrom('users')
    .select(['id', 'email'])
    .where('id', 'in', missing)
    .where('deleted_at', 'is', null)
    .execute()) as Array<{ id: string; email: string | null }>

  for (const row of userRows) {
    const email =
      typeof row.email === 'string' && row.email.trim().length > 0
        ? row.email.trim()
        : null
    if (email) map.set(row.id, email)
  }

  return map
}

const salesOwnerDisplayEnricher: ResponseEnricher<QuoteRecord> = {
  id: 'sales.sales-owner-display:sales_quote',
  targetEntity: 'sales:sales_quote',
  features: [],
  priority: 5,
  timeout: 1500,
  critical: false,
  fallback: {},

  async enrichOne(record, context: EnricherContext) {
    return (await this.enrichMany!([record], context))[0]
  },

  async enrichMany(records, context: EnricherContext) {
    if (records.length === 0) return records
    const db = getDb(context.em)
    if (!db) return records

    const userIds = new Set<string>()
    for (const record of records) {
      const userId = record['sales_owner_user_id']
      if (typeof userId === 'string' && userId.length > 0) userIds.add(userId)
    }
    if (userIds.size === 0) return records

    const displayMap = await fetchSalesOwnerDisplayMap(db, userIds, context.organizationId)

    return records.map((record) => {
      const userId = record['sales_owner_user_id']
      if (typeof userId !== 'string' || userId.length === 0) return record
      const display = displayMap.get(userId) ?? null
      const existing = (record['_sales'] as Record<string, unknown> | undefined) ?? {}
      return {
        ...record,
        _sales: { ...existing, salesOwnerDisplay: display },
      }
    })
  },
}

async function fetchPrimaryContactNameMap(
  db: Kysely<any>,
  companyIds: Set<string>,
  organizationId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (companyIds.size === 0) return map
  const ids = [...companyIds]

  const linkRows = (await (db as any)
    .selectFrom('customer_person_company_links as link')
    .leftJoin('customer_people as profile', 'profile.entity_id', 'link.person_entity_id')
    .leftJoin('customer_entities as person_entity', 'person_entity.id', 'link.person_entity_id')
    .select([
      'link.company_entity_id as company_id',
      'profile.preferred_name',
      'profile.first_name',
      'profile.last_name',
      'person_entity.display_name as entity_display_name',
    ])
    .where('link.company_entity_id', 'in', ids)
    .where('link.is_primary', '=', true)
    .where('link.organization_id', '=', organizationId)
    .where('link.deleted_at', 'is', null)
    .execute()) as Array<{
      company_id: string
      preferred_name: string | null
      first_name: string | null
      last_name: string | null
      entity_display_name: string | null
    }>

  for (const row of linkRows) {
    if (map.has(row.company_id)) continue
    const first =
      (typeof row.preferred_name === 'string' && row.preferred_name.trim().length > 0
        ? row.preferred_name.trim()
        : null) ??
      (typeof row.first_name === 'string' && row.first_name.trim().length > 0
        ? row.first_name.trim()
        : null)
    const last =
      typeof row.last_name === 'string' && row.last_name.trim().length > 0
        ? row.last_name.trim()
        : null
    const composed = [first, last].filter((part): part is string => part !== null).join(' ').trim()
    const fallback =
      typeof row.entity_display_name === 'string' && row.entity_display_name.trim().length > 0
        ? row.entity_display_name.trim()
        : null
    const display = composed.length > 0 ? composed : fallback
    if (display) map.set(row.company_id, display)
  }

  return map
}

const primaryContactNameEnricher: ResponseEnricher<QuoteRecord> = {
  id: 'sales.primary-contact-name:sales_quote',
  targetEntity: 'sales:sales_quote',
  features: [],
  priority: 5,
  timeout: 1500,
  critical: false,
  fallback: {},

  async enrichOne(record, context: EnricherContext) {
    return (await this.enrichMany!([record], context))[0]
  },

  async enrichMany(records, context: EnricherContext) {
    if (records.length === 0) return records
    const db = getDb(context.em)
    if (!db) return records

    const companyIds = new Set<string>()
    for (const record of records) {
      const companyId = record['customer_entity_id']
      if (typeof companyId === 'string' && companyId.length > 0) companyIds.add(companyId)
    }
    if (companyIds.size === 0) return records

    const nameMap = await fetchPrimaryContactNameMap(db, companyIds, context.organizationId)

    return records.map((record) => {
      const companyId = record['customer_entity_id']
      if (typeof companyId !== 'string' || companyId.length === 0) return record
      const display = nameMap.get(companyId) ?? null
      const existing = (record['_sales'] as Record<string, unknown> | undefined) ?? {}
      return {
        ...record,
        _sales: { ...existing, primaryContactName: display },
      }
    })
  },
}

export const enrichers: ResponseEnricher[] = [
  createCatalogImageEnricher('sales:sales_quote_line'),
  createCatalogImageEnricher('sales:sales_order_line'),
  salesOwnerDisplayEnricher,
  primaryContactNameEnricher,
]
