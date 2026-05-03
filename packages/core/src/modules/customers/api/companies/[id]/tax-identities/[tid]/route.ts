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
import { CustomerEntity, CustomerTaxIdentity } from '../../../../../data/entities'
import { taxIdentityUpdateSchema } from '../../../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['customers.tax_identities.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.tax_identities.manage'] },
}

const paramsSchema = z.object({
  id: z.string().uuid(),
  tid: z.string().uuid(),
})

const patchBodySchema = z
  .object({
    countryCode: z.string().trim().length(2).optional(),
    kind: z.string().trim().min(1).max(20).optional(),
    value: z.string().trim().min(1).max(80).optional(),
    validFrom: z.union([z.string(), z.null()]).optional(),
    validTo: z.union([z.string(), z.null()]).optional(),
    isPrimary: z.boolean().optional(),
  })
  .passthrough()
  .refine(
    (payload) => !(payload.value !== undefined && payload.kind === undefined),
    { message: 'Updating value requires kind to be provided as well so checksum can be re-validated.', path: ['kind'] },
  )

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

async function resolveTaxIdentityForCompany(
  em: EntityManager,
  companyId: string,
  taxIdentityId: string,
  tenantId: string,
  allowedOrgIds: Set<string>,
): Promise<{ company: CustomerEntity; record: CustomerTaxIdentity }> {
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
  const record = await em.findOne(CustomerTaxIdentity, { id: taxIdentityId })
  if (!record || record.deletedAt) {
    throw new CrudHttpError(404, { error: 'Tax identity not found' })
  }
  if (record.tenantId !== company.tenantId || record.organizationId !== company.organizationId) {
    throw new CrudHttpError(404, { error: 'Tax identity not found' })
  }
  const recordEntityId = typeof record.entity === 'string' ? record.entity : record.entity?.id
  if (recordEntityId !== company.id) {
    throw new CrudHttpError(404, { error: 'Tax identity not found' })
  }
  return { company, record }
}

export async function PATCH(req: Request, ctx: { params?: { id?: string; tid?: string } }) {
  try {
    const { translate } = await resolveTranslations()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: translate('customers.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const params = paramsSchema.parse({ id: ctx.params?.id, tid: ctx.params?.tid })
    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = container.resolve('em') as EntityManager
    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)

    const { company, record } = await resolveTaxIdentityForCompany(
      em,
      params.id,
      params.tid,
      auth.tenantId,
      allowedOrgIds,
    )

    const rawBody = await req.json().catch(() => ({}))
    const parsedBody = patchBodySchema.parse(rawBody)
    const commandInput = taxIdentityUpdateSchema.parse({
      ...parsedBody,
      id: record.id,
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
    const executeResult = (await commandBus.execute('customers.tax_identities.update', {
      input: commandInput,
      ctx: commandContext,
    })) as CommandExecuteResult<{ taxIdentityId: string }>
    const { result, logEntry } = executeResult

    const updated = await em.fork().findOne(CustomerTaxIdentity, { id: result.taxIdentityId })
    if (!updated) {
      throw new CrudHttpError(500, { error: translate('customers.errors.internalError', 'Internal server error') })
    }

    const response = NextResponse.json(serialize(updated))
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.tax_identity',
          resourceId: updated.id,
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
    console.error('customers.taxIdentities.update failed', err)
    return NextResponse.json({ error: translate('customers.errors.internalError', 'Internal server error') }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params?: { id?: string; tid?: string } }) {
  try {
    const { translate } = await resolveTranslations()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: translate('customers.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const params = paramsSchema.parse({ id: ctx.params?.id, tid: ctx.params?.tid })
    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = container.resolve('em') as EntityManager
    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)

    const { company, record } = await resolveTaxIdentityForCompany(
      em,
      params.id,
      params.tid,
      auth.tenantId,
      allowedOrgIds,
    )

    const commandContext: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: company.organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const executeResult = (await commandBus.execute('customers.tax_identities.delete', {
      input: { id: record.id },
      ctx: commandContext,
    })) as CommandExecuteResult<{ taxIdentityId: string }>
    const { logEntry } = executeResult

    const response = NextResponse.json({ success: true })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.tax_identity',
          resourceId: record.id,
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
    console.error('customers.taxIdentities.delete failed', err)
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

const deleteResponseSchema = z.object({ success: z.literal(true) })
const errorResponseSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer company tax identity (single)',
  methods: {
    PATCH: {
      summary: 'Update a tax identity',
      description: 'Updates one or more fields on an existing tax identity. Re-validates checksums when value or kind changes.',
      requestBody: { contentType: 'application/json', schema: patchBodySchema },
      responses: [{ status: 200, description: 'Tax identity updated', schema: taxIdentitySchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Tax identity not found', schema: errorResponseSchema },
        { status: 409, description: 'Duplicate tax identity', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Soft-delete a tax identity',
      description: 'Marks the tax identity as deleted (soft delete) so the active partial unique index frees the country/kind/value tuple.',
      responses: [{ status: 200, description: 'Tax identity deleted', schema: deleteResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Tax identity not found', schema: errorResponseSchema },
      ],
    },
  },
}
