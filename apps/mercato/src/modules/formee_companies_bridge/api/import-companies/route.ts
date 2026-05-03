import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { importFormeeCompanies } from '../../lib/import'

export const metadata = {
  path: '/formee_companies_bridge/import-companies',
  requireAuth: true,
  requireFeatures: ['formee_companies_bridge.import'],
}

const bodySchema = z
  .object({
    dryRun: z.boolean().optional(),
    onlyActive: z.boolean().optional(),
    limit: z.number().int().positive().optional().nullable(),
    batchSize: z.number().int().positive().max(2000).optional(),
    organizationId: z.string().uuid().optional(),
  })
  .strict()

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text.trim()) return {}
  return JSON.parse(text) as unknown
}

export async function POST(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = bodySchema.safeParse(await readJsonBody(request))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId =
    parsed.data.organizationId ?? scope?.selectedId ?? auth.orgId ?? null

  if (!organizationId) {
    return NextResponse.json(
      { error: 'No organization in scope. Pass organizationId in the body or select one.' },
      { status: 400 },
    )
  }

  try {
    const result = await importFormeeCompanies(
      container,
      { tenantId: auth.tenantId, organizationId, userId: auth.userId ?? null },
      {
        dryRun: parsed.data.dryRun ?? false,
        onlyActive: parsed.data.onlyActive ?? true,
        limit: parsed.data.limit ?? null,
        batchSize: parsed.data.batchSize,
      },
    )
    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
