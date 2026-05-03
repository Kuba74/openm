// @ts-nocheck — dead-code module (not registered in src/modules.ts); pre-existing
// type drift after upstream commands API change. Kept for reference until cleanup.
import type { CommandBus } from '@open-mercato/shared/lib/commands'
type CommandContext = any
import '@open-mercato/core/modules/customers/commands/index'
import {
  countFormeeCompanies,
  resolveFormeeBridgeConfig,
  streamFormeeCompanies,
  type FormeeBridgeConfig,
  type FormeeCompanyRow,
} from './formee-prisma'
import { mapFormeeCompanyToMercato } from './company-mapper'

export type ImportFormeeCompaniesScope = {
  tenantId: string
  organizationId: string
  userId?: string | null
}

export type ImportFormeeCompaniesOptions = {
  batchSize?: number
  onlyActive?: boolean
  dryRun?: boolean
  limit?: number | null
  onProgress?: (progress: ImportFormeeCompaniesProgress) => void
}

export type ImportFormeeCompaniesProgress = {
  total: number
  processed: number
  created: number
  skipped: number
  errors: ImportFormeeCompaniesError[]
}

export type ImportFormeeCompaniesError = {
  formeeId: string
  legalName: string | null
  message: string
}

export type ImportFormeeCompaniesResult = ImportFormeeCompaniesProgress & {
  durationMs: number
}

type ContainerLike = {
  resolve: <T = unknown>(name: string) => T
}

function buildCommandContext(
  container: ContainerLike,
  scope: ImportFormeeCompaniesScope,
): CommandContext {
  return {
    container: container as CommandContext['container'],
    auth: {
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
      userId: scope.userId ?? 'formee-bridge',
      roles: ['admin'],
      features: ['customers.companies.create', 'customers.companies.manage'],
    },
    requestId: `formee-bridge-${Date.now()}`,
    origin: 'formee_companies_bridge',
  } as unknown as CommandContext
}

export async function importFormeeCompanies(
  container: ContainerLike,
  scope: ImportFormeeCompaniesScope,
  options: ImportFormeeCompaniesOptions = {},
): Promise<ImportFormeeCompaniesResult> {
  const startedAt = Date.now()
  const config: FormeeBridgeConfig = resolveFormeeBridgeConfig()
  const total = await countFormeeCompanies(config, { onlyActive: options.onlyActive ?? true })
  const limit = options.limit ?? null

  const progress: ImportFormeeCompaniesProgress = {
    total: limit ? Math.min(total, limit) : total,
    processed: 0,
    created: 0,
    skipped: 0,
    errors: [],
  }
  options.onProgress?.(progress)

  if (options.dryRun) {
    let scanned = 0
    for await (const batch of streamFormeeCompanies(config, {
      batchSize: options.batchSize,
      onlyActive: options.onlyActive ?? true,
    })) {
      for (const row of batch) {
        if (limit && scanned >= limit) break
        scanned += 1
        progress.processed = scanned
        progress.skipped = scanned
        options.onProgress?.(progress)
      }
      if (limit && scanned >= limit) break
    }
    return { ...progress, durationMs: Date.now() - startedAt }
  }

  const commandBus = container.resolve<CommandBus>('commandBus')
  const ctx = buildCommandContext(container, scope)

  let scanned = 0
  for await (const batch of streamFormeeCompanies(config, {
    batchSize: options.batchSize,
    onlyActive: options.onlyActive ?? true,
  })) {
    for (const row of batch) {
      if (limit && scanned >= limit) break
      scanned += 1
      try {
        const payload = mapFormeeCompanyToMercato(row as FormeeCompanyRow, scope)
        await commandBus.execute('customers.companies.create', payload, ctx)
        progress.created += 1
      } catch (error) {
        progress.errors.push({
          formeeId: row.id,
          legalName: row.legalName,
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        progress.processed = scanned
        options.onProgress?.(progress)
      }
    }
    if (limit && scanned >= limit) break
  }

  return { ...progress, durationMs: Date.now() - startedAt }
}
