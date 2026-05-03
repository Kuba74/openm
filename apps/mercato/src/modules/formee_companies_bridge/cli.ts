import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { importFormeeCompanies } from './lib/import'

function parseArgs(rest: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i += 1
    }
  }
  return out
}

const importCompanies: ModuleCli = {
  command: 'import',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = (args.tenant || args.tenantId) as string | undefined
    const organizationId = (args.org || args.organizationId) as string | undefined
    const dryRun = args.dryRun === true || args['dry-run'] === true
    const onlyActive = !(args.includeInactive === true || args['include-inactive'] === true)
    const limitArg = args.limit
    const limit = typeof limitArg === 'string' ? Number.parseInt(limitArg, 10) : null
    const batchSizeArg = args.batchSize || args['batch-size']
    const batchSize = typeof batchSizeArg === 'string' ? Number.parseInt(batchSizeArg, 10) : 500

    if (!tenantId || !organizationId) {
      console.error(
        'Usage: mercato formee_companies_bridge import --tenant <id> --org <id> [--dry-run] [--include-inactive] [--limit N] [--batch-size N]',
      )
      console.error('Requires FORMEE_LEGACY_DATABASE_URL env var pointing at the legacy Postgres.')
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    let lastReport = 0
    const result = await importFormeeCompanies(
      container,
      { tenantId, organizationId },
      {
        batchSize,
        onlyActive,
        dryRun,
        limit,
        onProgress: (progress) => {
          if (progress.processed - lastReport >= 100 || progress.processed === progress.total) {
            console.log(
              `[formee] processed ${progress.processed}/${progress.total} ` +
                `(created ${progress.created}, skipped ${progress.skipped}, errors ${progress.errors.length})`,
            )
            lastReport = progress.processed
          }
        },
      },
    )

    console.log('---')
    console.log(`Total Formee rows visited: ${result.processed}`)
    console.log(`Created in Mercato: ${result.created}`)
    console.log(`Skipped (dry run or filtered): ${result.skipped}`)
    console.log(`Errors: ${result.errors.length}`)
    if (result.errors.length > 0) {
      console.log('First 10 errors:')
      for (const err of result.errors.slice(0, 10)) {
        console.log(`  - ${err.formeeId} (${err.legalName ?? 'no legal name'}): ${err.message}`)
      }
    }
    console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`)
  },
}

export default [importCompanies]
