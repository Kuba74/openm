import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerCompanyBilling,
  CustomerEntity,
} from '../../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.companies.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['customers.companies.manage'] },
}

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const patchBodySchema = z
  .object({
    salesOwnerUserId: z.union([z.string().uuid(), z.null()]).optional(),
    defaultOfferValidityDays: z
      .union([z.number().int().min(1).max(365), z.null()])
      .optional(),
  })
  .strict()

type SalesBillingResponse = {
  companyId: string
  salesOwnerUserId: string | null
  defaultOfferValidityDays: number | null
}

async function loadCompanyOrThrow(
  em: EntityManager,
  companyId: string,
  tenantId: string,
  allowedOrgIds: Set<string>,
): Promise<CustomerEntity> {
  const company = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: companyId, kind: 'company', deletedAt: null } as Record<string, unknown>,
    {},
    { tenantId, organizationId: allowedOrgIds.size === 1 ? allowedOrgIds.values().next().value ?? null : null },
  )
  if (!company || company.tenantId !== tenantId) {
    throw new CrudHttpError(404, { error: 'Company not found' })
  }
  if (allowedOrgIds.size && !allowedOrgIds.has(company.organizationId)) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
  return company
}

async function loadOrCreateBilling(
  em: EntityManager,
  company: CustomerEntity,
): Promise<CustomerCompanyBilling> {
  const existing = await findOneWithDecryption(
    em,
    CustomerCompanyBilling,
    {
      entity: company,
      organizationId: company.organizationId,
      tenantId: company.tenantId,
    } as Record<string, unknown>,
    {},
    { tenantId: company.tenantId, organizationId: company.organizationId },
  )
  if (existing) return existing
  const created = em.create(CustomerCompanyBilling, {
    organizationId: company.organizationId,
    tenantId: company.tenantId,
    entity: company,
  })
  em.persist(created)
  return created
}

function serialize(
  company: CustomerEntity,
  billing: CustomerCompanyBilling | null,
): SalesBillingResponse {
  return {
    companyId: company.id,
    salesOwnerUserId: billing?.salesOwnerUserId ?? null,
    defaultOfferValidityDays: billing?.defaultOfferValidityDays ?? null,
  }
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

    const billing = await findOneWithDecryption(
      em,
      CustomerCompanyBilling,
      {
        entity: company,
        organizationId: company.organizationId,
        tenantId: company.tenantId,
      } as Record<string, unknown>,
      {},
      { tenantId: company.tenantId, organizationId: company.organizationId },
    )

    return NextResponse.json(serialize(company, billing))
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.companies.salesBilling.get failed', err)
    return NextResponse.json({ error: translate('customers.errors.internalError', 'Internal server error') }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: { params?: { id?: string } }) {
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
    const parsed = patchBodySchema.parse(rawBody ?? {})

    const billing = await loadOrCreateBilling(em, company)
    if (Object.prototype.hasOwnProperty.call(parsed, 'salesOwnerUserId')) {
      billing.salesOwnerUserId = parsed.salesOwnerUserId ?? null
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'defaultOfferValidityDays')) {
      billing.defaultOfferValidityDays = parsed.defaultOfferValidityDays ?? null
    }
    await em.flush()

    return NextResponse.json(serialize(company, billing))
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.companies.salesBilling.patch failed', err)
    return NextResponse.json({ error: translate('customers.errors.internalError', 'Internal server error') }, { status: 500 })
  }
}

const responseSchema = z.object({
  companyId: z.string().uuid(),
  salesOwnerUserId: z.string().uuid().nullable(),
  defaultOfferValidityDays: z.number().int().nullable(),
})

const errorResponseSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer company sales-side billing properties',
  methods: {
    GET: {
      summary: 'Get sales-side billing properties for a company',
      description:
        'Returns the optional sales owner and default offer validity days assigned to a customer company billing record.',
      responses: [{ status: 200, description: 'Sales billing properties', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Company not found', schema: errorResponseSchema },
      ],
    },
    PATCH: {
      summary: 'Update sales-side billing properties for a company',
      description:
        'Patches the sales owner user and default offer validity days. Creates the underlying customer_company_billing row if missing.',
      requestBody: { contentType: 'application/json', schema: patchBodySchema },
      responses: [{ status: 200, description: 'Sales billing properties updated', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Company not found', schema: errorResponseSchema },
      ],
    },
  },
}
