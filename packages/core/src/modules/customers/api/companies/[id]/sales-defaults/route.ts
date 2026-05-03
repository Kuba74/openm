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
import {
  getDefaultOfferValidityDays,
  getSalesOwner,
} from '../../../../lib/companyBilling'
import { getDefaultOfferAddress } from '../../../../lib/primaryAddress'
import { getPrimaryContactCard } from '../../../../lib/primaryContact'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.companies.view'] },
}

const paramsSchema = z.object({
  id: z.string().uuid(),
})

type SalesDefaultsResponse = {
  primaryContactId: string | null
  primaryContactName: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  defaultShippingAddressId: string | null
  defaultBillingAddressId: string | null
  preferredCurrency: string | null
  paymentTerms: string | null
  salesOwnerUserId: string | null
  defaultOfferValidityDays: number
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
    {
      tenantId,
      organizationId:
        allowedOrgIds.size === 1 ? allowedOrgIds.values().next().value ?? null : null,
    },
  )
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
      return NextResponse.json(
        { error: translate('customers.errors.unauthorized', 'Unauthorized') },
        { status: 401 },
      )
    }
    const params = paramsSchema.parse({ id: ctx.params?.id })
    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = container.resolve('em') as EntityManager
    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)
    const company = await loadCompanyOrThrow(em, params.id, auth.tenantId, allowedOrgIds)

    const helperScope = {
      organizationId: company.organizationId,
      tenantId: company.tenantId,
    }

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

    const [contact, shippingAddress, billingAddress, salesOwnerUserId, defaultOfferValidityDays] =
      await Promise.all([
        getPrimaryContactCard(em, company.id, helperScope),
        getDefaultOfferAddress(em, company.id, helperScope, 'shipping'),
        getDefaultOfferAddress(em, company.id, helperScope, 'billing'),
        getSalesOwner(em, company.id, helperScope),
        getDefaultOfferValidityDays(em, company.id, helperScope),
      ])

    const response: SalesDefaultsResponse = {
      primaryContactId: contact?.id ?? null,
      primaryContactName: contact?.displayName ?? null,
      primaryEmail: contact?.email ?? null,
      primaryPhone: contact?.phone ?? null,
      defaultShippingAddressId: shippingAddress?.id ?? null,
      defaultBillingAddressId: billingAddress?.id ?? null,
      preferredCurrency: billing?.preferredCurrency ?? null,
      paymentTerms: billing?.paymentTerms ?? null,
      salesOwnerUserId,
      defaultOfferValidityDays,
    }

    return NextResponse.json(response)
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.companies.salesDefaults.get failed', err)
    return NextResponse.json(
      { error: translate('customers.errors.internalError', 'Internal server error') },
      { status: 500 },
    )
  }
}

const responseSchema = z.object({
  primaryContactId: z.string().uuid().nullable(),
  primaryContactName: z.string().nullable(),
  primaryEmail: z.string().nullable(),
  primaryPhone: z.string().nullable(),
  defaultShippingAddressId: z.string().uuid().nullable(),
  defaultBillingAddressId: z.string().uuid().nullable(),
  preferredCurrency: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  salesOwnerUserId: z.string().uuid().nullable(),
  defaultOfferValidityDays: z.number().int().positive(),
})

const errorResponseSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Aggregated sales defaults snapshot for a customer company',
  methods: {
    GET: {
      summary: 'Sales defaults for offer pre-fill',
      description:
        'Returns a snapshot of the values used to pre-fill new sales documents for the given customer company: primary contact card, default shipping/billing address ids resolved via the standard fallback chain, plus billing-side defaults (preferred currency, payment terms, sales owner, offer validity days).',
      responses: [{ status: 200, description: 'Sales defaults snapshot', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 404, description: 'Company not found', schema: errorResponseSchema },
      ],
    },
  },
}
