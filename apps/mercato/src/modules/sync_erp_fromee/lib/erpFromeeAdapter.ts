import pkg from 'pg'
const { Client } = pkg
type PgClient = InstanceType<typeof pkg.Client>
type PgClientConfig = ConstructorParameters<typeof pkg.Client>[0]
import type {
  ErpFromeeBundle,
  ErpFromeeCompany,
  ErpFromeeCompanyAddress,
  ErpFromeeCompanyBankAccount,
  ErpFromeeCompanyContact,
  ErpFromeeCompanyRole,
  ErpFromeeCompanySourceLink,
  ErpFromeeRoleType,
} from './types'

export type ErpFromeeAdapterConfig = {
  connectionString: string
}

export type ErpFromeeAdapter = {
  countCustomerCompanies(roleTypes: readonly ErpFromeeRoleType[]): Promise<number>
  fetchCustomerBundles(options: {
    roleTypes: readonly ErpFromeeRoleType[]
    limit?: number | null
    batchSize?: number
  }): AsyncIterable<ErpFromeeBundle[]>
}

const COMPANY_COLS = `
  c.id,
  c."companyNo",
  c.kind,
  c."legalName",
  c."displayName",
  c."shortName",
  c."searchTerm",
  c."taxId",
  c.regon,
  c.krs,
  c."vatEu",
  c."countryCode",
  c."defaultLanguage",
  c."isActive",
  c."isBlocked",
  c.note,
  c.metadata,
  c."createdAt",
  c."updatedAt"
`

const ROLE_COLS = `
  id,
  "companyId",
  "roleType",
  "isActive",
  currency,
  "paymentTerms",
  "deliveryTerms",
  "priceGroup",
  "creditLimit",
  "createdAt"
`

// erp-fromee CompanyContact has no email/phone columns — those live in
// CompanyCommunication (1:N). We project the primary EMAIL/PHONE/MOBILE
// via lateral subqueries so the mapper layer keeps a flat shape.
const CONTACT_COLS = `
  cc.id,
  cc."companyId",
  cc."firstName",
  cc."lastName",
  cc."displayName",
  cc."jobTitle",
  cc.department,
  cc."contactFunction",
  (
    SELECT co.value
    FROM "CompanyCommunication" co
    WHERE co."contactId" = cc.id AND co.type = 'EMAIL' AND co."isActive" = true
    ORDER BY co."isPrimary" DESC, co."createdAt" ASC
    LIMIT 1
  ) AS email,
  (
    SELECT co.value
    FROM "CompanyCommunication" co
    WHERE co."contactId" = cc.id AND co.type IN ('PHONE','MOBILE') AND co."isActive" = true
    ORDER BY co."isPrimary" DESC, co.type ASC, co."createdAt" ASC
    LIMIT 1
  ) AS phone,
  cc."isPrimary",
  cc."isActive",
  cc.metadata,
  cc."createdAt"
`

const ADDRESS_COLS = `
  id,
  "companyId",
  type,
  label,
  "attentionOf",
  name1,
  name2,
  street1,
  street2,
  "postalCode",
  city,
  region,
  "countryCode",
  latitude,
  longitude,
  "isPrimary",
  "createdAt"
`

const BANK_COLS = `
  id,
  "companyId",
  "bankName",
  "bankNumber",
  "accountNumber",
  iban,
  swift,
  currency,
  "countryCode",
  label,
  "isPrimary",
  "isActive",
  note,
  "createdAt"
`

// erp-fromee schema uses (system, sourceType, sourceId); type ErpFromeeCompanySourceLink
// names them sourceSystem/externalId. We alias here so the mapper layer keeps working.
const SOURCE_LINK_COLS = `
  id,
  "companyId",
  system AS "sourceSystem",
  "sourceId" AS "externalId",
  "lastSyncAt"
`

export function resolveErpFromeeAdapterConfig(): ErpFromeeAdapterConfig {
  const url =
    process.env.ERP_FROMEE_DATABASE_URL ??
    process.env.FORMEE_DATABASE_URL ??
    null
  if (!url) {
    throw new Error(
      'ERP_FROMEE_DATABASE_URL is not set. Point it at the legacy erp-fromee Postgres ' +
        '(e.g. postgresql://user@localhost:5432/formee).',
    )
  }
  return { connectionString: url }
}

async function withClient<T>(
  config: ErpFromeeAdapterConfig,
  fn: (client: PgClient) => Promise<T>,
): Promise<T> {
  const clientConfig: PgClientConfig = { connectionString: config.connectionString }
  const client = new Client(clientConfig)
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

function buildPlaceholderList(values: readonly string[], offset: number): string {
  return values.map((_, idx) => `$${idx + offset}`).join(', ')
}

export function createErpFromeeAdapter(
  config: ErpFromeeAdapterConfig = resolveErpFromeeAdapterConfig(),
): ErpFromeeAdapter {
  return {
    async countCustomerCompanies(roleTypes) {
      if (roleTypes.length === 0) return 0
      return withClient(config, async (client) => {
        const placeholders = buildPlaceholderList(roleTypes, 1)
        const result = await (client as any).query({
          text: `
            SELECT COUNT(DISTINCT c.id)::text AS count
            FROM "Company" c
            INNER JOIN "CompanyRole" cr ON cr."companyId" = c.id AND cr."isActive" = true
            WHERE cr."roleType" IN (${placeholders})
          `,
          values: [...roleTypes],
        })
        return Number(result.rows[0]?.count ?? '0')
      })
    },

    async *fetchCustomerBundles({ roleTypes, limit, batchSize = 100 }) {
      if (roleTypes.length === 0) return

      let lastCreatedAt: Date | null = null
      let lastId: string | null = null
      let yielded = 0

      while (true) {
        const remaining = limit !== null && limit !== undefined ? limit - yielded : null
        if (remaining !== null && remaining <= 0) return
        const effectiveBatch = remaining !== null ? Math.min(batchSize, remaining) : batchSize

        const bundles = await withClient(config, async (client) => {
          const baseValues: unknown[] = [...roleTypes]
          const rolePlaceholders = buildPlaceholderList(roleTypes, 1)
          let cursorClause = ''
          if (lastCreatedAt && lastId) {
            cursorClause = `AND (c."createdAt", c.id) > ($${roleTypes.length + 1}::timestamptz, $${roleTypes.length + 2}::text)`
            baseValues.push(lastCreatedAt.toISOString(), lastId)
          }
          const sql = `
            SELECT DISTINCT ${COMPANY_COLS}
            FROM "Company" c
            INNER JOIN "CompanyRole" cr ON cr."companyId" = c.id AND cr."isActive" = true
            WHERE cr."roleType" IN (${rolePlaceholders})
            ${cursorClause}
            ORDER BY c."createdAt" ASC, c.id ASC
            LIMIT ${effectiveBatch}
          `
          const companyResult = await (client as any).query({
            text: sql,
            values: baseValues,
          })
          const companies = companyResult.rows
          if (companies.length === 0) return []

          const ids = companies.map((c: { id: string }) => c.id)
          const idPlaceholders = ids.map((_: string, i: number) => `$${i + 1}`).join(', ')

          const [roles, contacts, addresses, bankAccounts, sourceLinks] = await Promise.all([
            (client as any).query({
              text: `SELECT ${ROLE_COLS} FROM "CompanyRole" WHERE "companyId" IN (${idPlaceholders})`,
              values: ids,
            }),
            (client as any).query({
              text: `SELECT ${CONTACT_COLS} FROM "CompanyContact" cc WHERE cc."companyId" IN (${idPlaceholders})`,
              values: ids,
            }),
            (client as any).query({
              text: `SELECT ${ADDRESS_COLS} FROM "CompanyAddress" WHERE "companyId" IN (${idPlaceholders})`,
              values: ids,
            }),
            (client as any).query({
              text: `SELECT ${BANK_COLS} FROM "CompanyBankAccount" WHERE "companyId" IN (${idPlaceholders})`,
              values: ids,
            }),
            (client as any).query({
              text: `SELECT ${SOURCE_LINK_COLS} FROM "CompanySourceLink" WHERE "companyId" IN (${idPlaceholders})`,
              values: ids,
            }),
          ])

          const rolesByCompany = groupBy(roles.rows as ErpFromeeCompanyRole[], (r) => r.companyId)
          const contactsByCompany = groupBy(contacts.rows as ErpFromeeCompanyContact[], (r) => r.companyId)
          const addressesByCompany = groupBy(addresses.rows as ErpFromeeCompanyAddress[], (r) => r.companyId)
          const banksByCompany = groupBy(bankAccounts.rows as ErpFromeeCompanyBankAccount[], (r) => r.companyId)
          const linksByCompany = groupBy(sourceLinks.rows as ErpFromeeCompanySourceLink[], (r) => r.companyId)

          return (companies as ErpFromeeCompany[]).map((company) => ({
            company,
            roles: rolesByCompany.get(company.id) ?? [],
            contacts: contactsByCompany.get(company.id) ?? [],
            addresses: addressesByCompany.get(company.id) ?? [],
            bankAccounts: banksByCompany.get(company.id) ?? [],
            sourceLinks: linksByCompany.get(company.id) ?? [],
          }))
        })

        if (bundles.length === 0) return

        yield bundles
        yielded += bundles.length

        const tail = bundles[bundles.length - 1]
        lastCreatedAt = new Date(tail.company.createdAt)
        lastId = tail.company.id

        if (bundles.length < effectiveBatch) return
        if (limit !== null && limit !== undefined && yielded >= limit) return
      }
    },
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}
