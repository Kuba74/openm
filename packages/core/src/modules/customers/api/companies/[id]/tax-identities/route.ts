import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandExecuteResult } from '@open-mercato/shared/lib/commands/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity, CustomerTaxIdentity } from '../../../../data/entities'
import { taxIdentityCreateSchema } from '../../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.tax_identities.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.tax_identities.manage'] },
}

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const createBodySchema = z
  .object({
    countryCode: z.string().trim().length(2),
    kind: z.string().trim().min(1).max(20),
    value: z.string().trim().min(1).max(80),
    validFrom: z.union([z.string(), z.null()]).optional(),
    validTo: z.union([z.string(), z.null()]).optional(),
    isPrimary: z.boolean().optional(),
  })
  .passthrough()

type SerializedTaxIdentity = {
  id: string
  countryCode: string
  kind: string
  value: string
  validFrom: string | null
  validTo: string | null
  isPrimary: boolean
  createdAt: string
  updatedAt: string
  organizationId: string
  tenantId: string
}

function serialize(record: CustomerTaxIdentity): SerializedTaxIdentity {
  return {
    id: record.id,
    countryCode: record.countryCode,
    kind: record.kind,
    value: record.value,
    validFrom: record.validFrom ? record.validFrom.toISOString() : null,
    validTo: record.validTo ? record.validTo.toISOString() : null,
    isPrimary: record.isPrimary,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    organizationId: record.organizationId,
    tenantId: record.tenantId,
  }
}

async function loadCompanyOrThrow(
  em: EntityManager,
  companyId: string,
  tenantId: string,
  allowedOrgIds: Set<string>,
): Promise<CustomerEntity> {
  const company = await em.findOne(CustomerEntity, {
    id: companyId,
    kind: 'company',
    deletedAt: null,
  })
  if (!company || company.tenantId !== tenantId) {
    throw new CrudHttpError(404, { error: 'Company not found' })
  }
  if (allowedOrgIds.size && !allowedOrgIds.has(company.organizationId)) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
  return company
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  try {
    const { translate } = await resolveTranslations()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: translate('customers.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const params = paramsSchema.parse({ id: ctx.params?.id })
    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = container.resolve('em') as EntityManager
    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)
    const company = await loadCompanyOrThrow(em, params.id, auth.tenantId, allowedOrgIds)

    const records = await findWithDecryption(
      em,
      CustomerTaxIdentity,
      { entity: company, deletedAt: null },
      { orderBy: { isPrimary: 'desc', createdAt: 'desc' } },
      { tenantId: company.tenantId, organizationId: company.organizationId },
    )

    return NextResponse.json({ items: records.map(serialize), total: records.length })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.taxIdentities.list failed', err)
    return NextResponse.json({ error: translate('customers.errors.internalError', 'Internal server error') }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  try {
    const { translate } = await resolveTranslations()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: translate('customers.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const params = paramsSchema.parse({ id: ctx.params?.id })
    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = container.resolve('em') as EntityManager
    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)
    const company = await loadCompanyOrThrow(em, params.id, auth.tenantId, allowedOrgIds)

    const rawBody = await req.json().catch(() => ({}))
    const parsedBody = createBodySchema.parse(rawBody)
    const commandInput = taxIdentityCreateSchema.parse({
      ...parsedBody,
      entityId: company.id,
      organizationId: company.organizationId,
      tenantId: company.tenantId,
    })
    const commandContext: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: company.organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const executeResult = (await commandBus.execute('customers.tax_identities.create', {
      input: commandInput,
      ctx: commandContext,
    })) as CommandExecuteResult<{ taxIdentityId: string }>
    const { result, logEntry } = executeResult

    const created = await em.fork().findOne(CustomerTaxIdentity, { id: result.taxIdentityId })
    if (!created) {
      throw new CrudHttpError(500, { error: translate('customers.errors.internalError', 'Internal server error') })
    }

    const response = NextResponse.json(serialize(created), { status: 201 })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.tax_identity',
          resourceId: created.id,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        }),
      )
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.taxIdentities.create failed', err)
    return NextResponse.json({ error: translate('customers.errors.internalError', 'Internal server error') }, { status: 500 })
  }
}

const taxIdentitySchema = z.object({
  id: z.string().uuid(),
  countryCode: z.string(),
  kind: z.string(),
  value: z.string(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

const listResponseSchema = z.object({
  items: z.array(taxIdentitySchema),
  total: z.number().int().nonnegative(),
})

const errorResponseSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer company tax identities',
  methods: {
    GET: {
      summary: 'List tax identities for a company',
      description: 'Returns the active (non-soft-deleted) tax identities attached to a customer company.',
      responses: [{ status: 200, description: 'Tax identity collection', schema: listResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Company not found', schema: errorResponseSchema },
      ],
    },
    POST: {
      summary: 'Create a tax identity for a company',
      description: 'Creates a new tax identity. Validates checksums for NIP, REGON, KRS, PESEL, and EU VAT formats. Returns 409 when the same country/kind/value tuple already exists for any company in the same scope.',
      requestBody: { contentType: 'application/json', schema: createBodySchema },
      responses: [{ status: 201, description: 'Tax identity created', schema: taxIdentitySchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Company not found', schema: errorResponseSchema },
        { status: 409, description: 'Duplicate tax identity', schema: errorResponseSchema },
      ],
    },
  },
}
