import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import {
  renderReportMarkdown,
  runImportPipelineWithConfig,
  type ImportPipelineOptions,
} from './lib/pipeline'

function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part?.startsWith('--')) continue
    const [keyRaw, valueRaw] = part.slice(2).split('=')
    if (keyRaw) {
      if (valueRaw !== undefined) args[keyRaw] = valueRaw
      else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) args[keyRaw] = rest[i + 1]
      else args[keyRaw] = 'true'
    }
  }
  return args
}

function isTrue(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes' || v === 'on'
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function writeReportFile(content: string): Promise<string> {
  const runsDir = path.resolve(process.cwd(), '.ai', 'runs')
  await fs.mkdir(runsDir, { recursive: true })
  const filePath = path.join(runsDir, `sync-erp-fromee-customers-${timestamp()}.md`)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

const customersImportCommand: ModuleCli = {
  command: 'customers',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    const dryRun = isTrue(args['dry-run']) || (!isTrue(args.commit) && !isTrue(args.write))
    const commit = isTrue(args.commit) || isTrue(args.write)
    const limitArg = args.limit
    const batchSizeArg = args['batch-size'] ?? args.batchSize

    if (!tenantId || !organizationId) {
      console.error(
        'Usage: mercato sync_erp_fromee customers --tenant <tenantId> --org <organizationId> [--dry-run] [--commit] [--limit N] [--batch-size N]',
      )
      process.exitCode = 1
      return
    }

    if (commit) {
      console.error(
        '✗ --commit not yet implemented. Pipeline jest gotowy (Y5), writer integracja z DataSyncAdapter ' +
          'jest planowana w Y6. Uruchom bez flagi --commit (lub z --dry-run) żeby wygenerować raport.',
      )
      process.exitCode = 1
      return
    }

    const options: ImportPipelineOptions = {
      limit: limitArg ? Number(limitArg) : null,
      batchSize: batchSizeArg ? Number(batchSizeArg) : 50,
      roleTypes: ['CUSTOMER', 'PROSPECT'] as const,
    }

    if (options.limit !== null && options.limit !== undefined &&
        (!Number.isFinite(options.limit) || options.limit <= 0)) {
      console.error(`✗ --limit must be a positive integer (got "${limitArg}")`)
      process.exitCode = 1
      return
    }
    if (options.batchSize !== undefined && (!Number.isFinite(options.batchSize) || options.batchSize <= 0)) {
      console.error(`✗ --batch-size must be a positive integer (got "${batchSizeArg}")`)
      process.exitCode = 1
      return
    }

    console.log(`▶ erp-fromee → openm import (dry-run)`)
    console.log(`  tenantId:       ${tenantId}`)
    console.log(`  organizationId: ${organizationId}`)
    console.log(`  limit:          ${options.limit ?? '(none)'}`)
    console.log(`  batchSize:      ${options.batchSize ?? 50}`)
    console.log(`  roleTypes:      ${(options.roleTypes ?? ['CUSTOMER']).join(', ')}`)
    console.log('')

    let result: Awaited<ReturnType<typeof runImportPipelineWithConfig>>
    try {
      result = await runImportPipelineWithConfig({ tenantId, organizationId }, options)
    } catch (error) {
      console.error('✗ Pipeline failed:', error instanceof Error ? error.message : String(error))
      process.exitCode = 1
      return
    }

    const { report } = result
    console.log(`✓ streamed ${report.total} companies in ${report.durationMs} ms`)
    console.log(`  imported (would-be-written): ${report.imported}`)
    console.log(`  skipped:                     ${report.skipped.total}`)
    for (const [reason, count] of Object.entries(report.skipped.byReason)) {
      console.log(`    - ${reason}: ${count}`)
    }
    console.log(`  manual review queue:         ${report.manualReview.length}`)
    console.log(`  auto-promoted contacts:      ${report.autoPromotedContacts.length}`)
    console.log(`  auto-promoted banks:         ${report.autoPromotedBanks.length}`)
    console.log(`  broken bank rows (D10):      ${report.brokenBanks.length}`)

    const md = renderReportMarkdown(report, { tenantId, organizationId }, options)
    if (dryRun) {
      try {
        const filePath = await writeReportFile(md)
        console.log('')
        console.log(`✓ Raport zapisany: ${filePath}`)
      } catch (error) {
        console.warn(
          '⚠ nie udało się zapisać raportu do .ai/runs/:',
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  },
}

const cliCommands = [customersImportCommand]
export default cliCommands
