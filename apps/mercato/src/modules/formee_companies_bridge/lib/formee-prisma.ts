import { Client, type ClientConfig } from 'pg'

export type FormeeCompanyRow = {
  id: string
  companyNo: string | null
  kind: string
  legalName: string
  displayName: string | null
  shortName: string | null
  searchTerm: string | null
  taxId: string | null
  regon: string | null
  krs: string | null
  vatEu: string | null
  countryCode: string | null
  defaultLanguage: string | null
  isActive: boolean
  isBlocked: boolean
  note: string | null
  metadata: unknown
  createdAt: Date
  updatedAt: Date
}

const SELECT_COLS = `
  id,
  "companyNo",
  kind,
  "legalName",
  "displayName",
  "shortName",
  "searchTerm",
  "taxId",
  regon,
  krs,
  "vatEu",
  "countryCode",
  "defaultLanguage",
  "isActive",
  "isBlocked",
  note,
  metadata,
  "createdAt",
  "updatedAt"
`

export type FormeeBridgeConfig = {
  connectionString: string
}

export function resolveFormeeBridgeConfig(): FormeeBridgeConfig {
  const url =
    process.env.FORMEE_LEGACY_DATABASE_URL ??
    process.env.FORMEE_DATABASE_URL ??
    null
  if (!url) {
    throw new Error(
      'FORMEE_LEGACY_DATABASE_URL is not set. Point it at the legacy Formee Postgres (e.g. postgresql://user@localhost/formee).',
    )
  }
  return { connectionString: url }
}

async function withClient<T>(
  config: FormeeBridgeConfig,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const clientConfig: ClientConfig = { connectionString: config.connectionString }
  const client = new Client(clientConfig)
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function* streamFormeeCompanies(
  config: FormeeBridgeConfig,
  options: { batchSize?: number; onlyActive?: boolean } = {},
): AsyncIterable<FormeeCompanyRow[]> {
  const batchSize = options.batchSize ?? 500
  const filter = options.onlyActive ? `WHERE "isActive" = true AND "isBlocked" = false` : ''
  let lastCreatedAt: Date | null = null
  let lastId: string | null = null

  while (true) {
    const cursorClause =
      lastCreatedAt && lastId
        ? `${filter ? 'AND' : 'WHERE'} ("createdAt", id) > ($1::timestamptz, $2::text)`
        : ''
    const sql = `
      SELECT ${SELECT_COLS}
      FROM "Company"
      ${filter}
      ${cursorClause}
      ORDER BY "createdAt" ASC, id ASC
      LIMIT ${batchSize}
    `
    const params: unknown[] =
      lastCreatedAt && lastId ? [lastCreatedAt.toISOString(), lastId] : []
    const rows = await withClient(config, async (client) => {
      const result = await client.query<FormeeCompanyRow>({ text: sql, values: params })
      return result.rows
    })
    if (rows.length === 0) return
    yield rows
    const tail = rows[rows.length - 1]
    lastCreatedAt = new Date(tail.createdAt)
    lastId = tail.id
    if (rows.length < batchSize) return
  }
}

export async function countFormeeCompanies(
  config: FormeeBridgeConfig,
  options: { onlyActive?: boolean } = {},
): Promise<number> {
  const filter = options.onlyActive ? `WHERE "isActive" = true AND "isBlocked" = false` : ''
  return withClient(config, async (client) => {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "Company" ${filter}`,
    )
    return Number(result.rows[0]?.count ?? '0')
  })
}
