import type {
  ErpFromeeAdapter,
  ErpFromeeAdapterConfig,
} from './erpFromeeAdapter'
import { createErpFromeeAdapter, resolveErpFromeeAdapterConfig } from './erpFromeeAdapter'
import type {
  ErpFromeeBundle,
  ErpFromeeRoleType,
  ImportScope,
} from './types'
import { mapCompanyToPartner, type PartnerImportPlan } from './mappers/companyToPartner'
import { mapTaxIdentities, type TaxIdentitiesPlan } from './mappers/taxIdentities'
import { mapRoles, type RolesPlan } from './mappers/roles'
import { mapContacts, type ContactPlan } from './mappers/contacts'
import { mapAddresses, type AddressesPlan } from './mappers/addresses'
import { mapBanks, type BanksPlan } from './mappers/banks'
import { mapBilling, type BillingPlan } from './mappers/billing'
import { mapMetadata, type MetadataPlan } from './mappers/metadata'

/**
 * Plan na pojedynczą firmę przepuszczoną przez pipeline. Zwracany strumieniowo
 * przez `runImportPipeline`. Pipeline jest pure-ish (read-only po stronie
 * source, no DB writes po openm) — caller (CLI dry-run, command-bus writer
 * w Y6) decyduje co z tym zrobić.
 */
export type CompanyImportPlan = {
  externalCompanyId: string
  status: 'imported' | 'skipped' | 'manual_review'
  skipReason?: string
  manualReviewReason?: string
  partner: PartnerImportPlan
  taxIdentities: TaxIdentitiesPlan
  roles: RolesPlan
  contacts: ContactPlan
  addresses: AddressesPlan
  banks: BanksPlan
  billing: BillingPlan
  metadata: MetadataPlan
  warnings: string[]
}

export type ImportPipelineOptions = {
  /** Maksymalna liczba firm do przetworzenia (testowanie + ograniczenie blast radius). */
  limit?: number | null
  /** Rozmiar batcha streamingu z erp-fromee. */
  batchSize?: number
  /** Filtr ról przy pobieraniu. Default: ['CUSTOMER'] (D1 — only customers + prospects). */
  roleTypes?: readonly ErpFromeeRoleType[]
  /** Tylko przelicz mapery, nie generuj raportów ad-hoc — dla unit testów. */
  silent?: boolean
}

export type ImportPipelineReport = {
  total: number
  imported: number
  skipped: {
    total: number
    byReason: Record<string, number>
    ids: { externalId: string; reason: string }[]
  }
  manualReview: { externalId: string; reason: string }[]
  /** Suma ID-ków, którym dosadziliśmy primary contact bo source ich nie miał. */
  autoPromotedContacts: { externalCompanyId: string; contactId: string }[]
  /** Suma ID-ków, którym dosadziliśmy primary bank bo source ich nie miał. */
  autoPromotedBanks: { externalCompanyId: string; bankId: string }[]
  /** Banki dropped per D10 broken-record (Constar / Melsdorf style). */
  brokenBanks: { externalCompanyId: string; bankId: string; reason: string }[]
  /** Raw warnings agregowane ze wszystkich mapperów (do raportu .ai/runs/). */
  warnings: string[]
  durationMs: number
}

/**
 * Hard-skip ID per D13 — Formee Sp. z o.o. tenant self-reference. Tu jest
 * dodatkowo do match-by-name w `companyToPartner` na wypadek gdyby
 * displayName w source został zmieniony.
 */
export const FORMEE_TENANT_COMPANY_ID = 'cmnam2ld40007lg5x21na05ac'

const AUTO_PROMOTE_CONTACT_MARKER = 'auto-promoted'
const AUTO_PROMOTE_BANK_MARKER = 'auto-promoted'

function isAutoPromoteContactWarning(warning: string): boolean {
  return warning.includes(AUTO_PROMOTE_CONTACT_MARKER) && warning.includes('earliest active')
}

function isAutoPromoteBankWarning(warning: string): boolean {
  return warning.includes(AUTO_PROMOTE_BANK_MARKER) && warning.includes('earliest active')
}

function pickAutoPromotedContactId(plan: ContactPlan): string | null {
  const auto = plan.warnings.find(isAutoPromoteContactWarning)
  if (!auto) return null
  const match = auto.match(/auto-promoted ([^\s]+)/)
  return match?.[1] ?? null
}

function pickAutoPromotedBankId(plan: BanksPlan): string | null {
  const auto = plan.warnings.find(isAutoPromoteBankWarning)
  if (!auto) return null
  const match = auto.match(/auto-promoted ([^\s]+)/)
  return match?.[1] ?? null
}

/**
 * Wykrywa case "PERSON bez NIP" — wymaga manualnej decyzji czy traktować jak
 * konsumenta czy jak firmę. companyToPartner sam tego nie flag'uje (bo dla
 * niego to legitne `kind=person`), ale pipeline chce odłożyć takie rekordy
 * do manual review zamiast cicho importować jako konsumenta.
 */
function detectManualReview(bundle: ErpFromeeBundle): string | null {
  const c = bundle.company
  if (c.kind === 'PERSON' && (!c.taxId || !c.taxId.trim())) {
    return 'person-without-nip'
  }
  return null
}

/**
 * Strumieniowy pipeline. Yieldsuje plan per firma, niezależnie od trybu
 * (dry-run / commit). Pipeline jest pure: czyta z `adapter`, nic nie zapisuje.
 *
 * Konsument (CLI dry-run, writer commitujący w Y6) konsumuje plany i decyduje
 * co z nimi robi.
 */
export async function* streamImportPlans(
  adapter: ErpFromeeAdapter,
  scope: ImportScope,
  options: ImportPipelineOptions = {},
): AsyncIterable<CompanyImportPlan> {
  const roleTypes = options.roleTypes ?? (['CUSTOMER'] as const)
  const limit = options.limit ?? null
  const batchSize = options.batchSize ?? 50

  let yielded = 0
  for await (const batch of adapter.fetchCustomerBundles({ roleTypes, limit, batchSize })) {
    for (const bundle of batch) {
      if (limit !== null && yielded >= limit) return
      yielded += 1
      yield buildPlan(bundle, scope)
    }
  }
}

function buildPlan(bundle: ErpFromeeBundle, scope: ImportScope): CompanyImportPlan {
  const company = bundle.company
  const warnings: string[] = []

  // D13 hard skip by ID — defensive layer if displayName drift bypassed companyToPartner.
  if (company.id === FORMEE_TENANT_COMPANY_ID) {
    return makeSkippedPlan(bundle, scope, 'formee-self', `Skipped Formee tenant by hard-coded ID ${company.id}`)
  }

  const partner = mapCompanyToPartner(company, scope)
  warnings.push(...partner.warnings)

  if (partner.skip) {
    return makeSkippedPlan(bundle, scope, partner.skipReason ?? 'mapper-skip', warnings.join('\n'))
  }

  const taxIdentities = mapTaxIdentities(company, scope)
  warnings.push(...taxIdentities.warnings)

  const roles = mapRoles({ companyId: company.id, roles: bundle.roles }, scope)
  warnings.push(...roles.warnings)

  if (roles.skip) {
    return makeSkippedPlan(bundle, scope, roles.skipReason ?? 'roles-skip', warnings.join('\n'))
  }

  const contacts = mapContacts({ companyId: company.id, contacts: bundle.contacts }, scope)
  warnings.push(...contacts.warnings)

  const addresses = mapAddresses({ companyId: company.id, addresses: bundle.addresses }, scope)
  warnings.push(...addresses.warnings)

  const banks = mapBanks({ companyId: company.id, bankAccounts: bundle.bankAccounts }, scope)
  warnings.push(...banks.warnings)

  const billing = mapBilling(company, bundle.roles, banks.primary, scope)
  warnings.push(...billing.warnings)

  const metadata = mapMetadata(company, bundle.sourceLinks, scope)
  warnings.push(...metadata.warnings)

  const manualReason = detectManualReview(bundle)
  if (manualReason) {
    return {
      externalCompanyId: company.id,
      status: 'manual_review',
      manualReviewReason: manualReason,
      partner,
      taxIdentities,
      roles,
      contacts,
      addresses,
      banks,
      billing,
      metadata,
      warnings,
    }
  }

  return {
    externalCompanyId: company.id,
    status: 'imported',
    partner,
    taxIdentities,
    roles,
    contacts,
    addresses,
    banks,
    billing,
    metadata,
    warnings,
  }
}

function makeSkippedPlan(
  bundle: ErpFromeeBundle,
  scope: ImportScope,
  reason: string,
  collectedWarning: string,
): CompanyImportPlan {
  const company = bundle.company
  const emptyMetadata = mapMetadata(company, bundle.sourceLinks, scope)
  return {
    externalCompanyId: company.id,
    status: 'skipped',
    skipReason: reason,
    partner: { skip: true, skipReason: reason, warnings: [] },
    taxIdentities: { rows: [], warnings: [] },
    roles: { skip: true, skipReason: reason, rows: [], primaryLifecycleStage: null, warnings: [] },
    contacts: { persons: [], profiles: [], links: [], roles: [], warnings: [] },
    addresses: { rows: [], warnings: [] },
    banks: { primary: null, skipped: [], warnings: [] },
    billing: { row: null, warnings: [] },
    metadata: emptyMetadata,
    warnings: collectedWarning ? [collectedWarning] : [],
  }
}

/**
 * Konsumuje pełny strumień planów do pamięci i zwraca zagregowany raport.
 * Wygodne dla CLI dry-run — print + write do `.ai/runs/`.
 */
export async function runImportPipeline(
  adapter: ErpFromeeAdapter,
  scope: ImportScope,
  options: ImportPipelineOptions = {},
): Promise<{ plans: CompanyImportPlan[]; report: ImportPipelineReport }> {
  const startedAt = Date.now()
  const plans: CompanyImportPlan[] = []
  for await (const plan of streamImportPlans(adapter, scope, options)) {
    plans.push(plan)
  }
  return { plans, report: aggregateReport(plans, Date.now() - startedAt) }
}

/**
 * Wariant `runImportPipeline` przyjmujący config — wygodny dla CLI gdzie
 * użytkownik przekazuje `FORMEE_LEGACY_DATABASE_URL` przez env. Zwraca też
 * raw plany na wypadek gdyby caller chciał je serializować.
 */
export async function runImportPipelineWithConfig(
  scope: ImportScope,
  options: ImportPipelineOptions = {},
  config: ErpFromeeAdapterConfig = resolveErpFromeeAdapterConfig(),
): Promise<{ plans: CompanyImportPlan[]; report: ImportPipelineReport }> {
  const adapter = createErpFromeeAdapter(config)
  return runImportPipeline(adapter, scope, options)
}

export function aggregateReport(
  plans: CompanyImportPlan[],
  durationMs: number,
): ImportPipelineReport {
  const skippedIds: { externalId: string; reason: string }[] = []
  const skippedByReason: Record<string, number> = {}
  const manualReview: { externalId: string; reason: string }[] = []
  const autoPromotedContacts: { externalCompanyId: string; contactId: string }[] = []
  const autoPromotedBanks: { externalCompanyId: string; bankId: string }[] = []
  const brokenBanks: { externalCompanyId: string; bankId: string; reason: string }[] = []
  const warnings: string[] = []
  let imported = 0

  for (const plan of plans) {
    warnings.push(...plan.warnings)

    if (plan.status === 'skipped') {
      const reason = plan.skipReason ?? 'unknown'
      skippedIds.push({ externalId: plan.externalCompanyId, reason })
      skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1
      continue
    }

    if (plan.status === 'manual_review') {
      manualReview.push({ externalId: plan.externalCompanyId, reason: plan.manualReviewReason ?? 'unknown' })
      continue
    }

    imported += 1

    const promotedContact = pickAutoPromotedContactId(plan.contacts)
    if (promotedContact) {
      autoPromotedContacts.push({ externalCompanyId: plan.externalCompanyId, contactId: promotedContact })
    }

    const promotedBank = pickAutoPromotedBankId(plan.banks)
    if (promotedBank) {
      autoPromotedBanks.push({ externalCompanyId: plan.externalCompanyId, bankId: promotedBank })
    }

    for (const skip of plan.banks.skipped) {
      if (skip.reason.includes('missing IBAN')) {
        brokenBanks.push({
          externalCompanyId: plan.externalCompanyId,
          bankId: skip.id,
          reason: skip.reason,
        })
      }
    }
  }

  return {
    total: plans.length,
    imported,
    skipped: { total: skippedIds.length, byReason: skippedByReason, ids: skippedIds },
    manualReview,
    autoPromotedContacts,
    autoPromotedBanks,
    brokenBanks,
    warnings,
    durationMs,
  }
}

/**
 * Generuje raport markdown z zagregowanego output'u pipeline'u. CLI dry-run
 * pisze ten output do `.ai/runs/sync-erp-fromee-customers-{ts}.md`.
 */
export function renderReportMarkdown(
  report: ImportPipelineReport,
  scope: ImportScope,
  options: ImportPipelineOptions,
): string {
  const lines: string[] = []
  lines.push('# erp-fromee → openm customer import — dry-run report')
  lines.push('')
  lines.push(`- **timestamp**: ${new Date().toISOString()}`)
  lines.push(`- **organizationId**: ${scope.organizationId}`)
  lines.push(`- **tenantId**: ${scope.tenantId}`)
  lines.push(`- **role types**: ${(options.roleTypes ?? ['CUSTOMER']).join(', ')}`)
  lines.push(`- **limit**: ${options.limit ?? '(none)'}`)
  lines.push(`- **batch size**: ${options.batchSize ?? 50}`)
  lines.push(`- **duration**: ${report.durationMs} ms`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- total streamed: **${report.total}**`)
  lines.push(`- imported (would be written): **${report.imported}**`)
  lines.push(`- skipped: **${report.skipped.total}**`)
  lines.push(`- manual review: **${report.manualReview.length}**`)
  lines.push(`- auto-promoted primary contact: **${report.autoPromotedContacts.length}**`)
  lines.push(`- auto-promoted primary bank: **${report.autoPromotedBanks.length}**`)
  lines.push(`- broken bank rows (D10 missing IBAN): **${report.brokenBanks.length}**`)
  lines.push('')

  if (Object.keys(report.skipped.byReason).length > 0) {
    lines.push('## Skipped (by reason)')
    lines.push('')
    for (const [reason, count] of Object.entries(report.skipped.byReason)) {
      lines.push(`- \`${reason}\`: ${count}`)
    }
    lines.push('')
  }

  if (report.manualReview.length > 0) {
    lines.push('## Manual review queue')
    lines.push('')
    for (const item of report.manualReview) {
      lines.push(`- \`${item.externalId}\` — ${item.reason}`)
    }
    lines.push('')
  }

  if (report.brokenBanks.length > 0) {
    lines.push('## Broken bank rows (D10 — missing IBAN)')
    lines.push('')
    for (const broken of report.brokenBanks) {
      lines.push(`- company \`${broken.externalCompanyId}\`, bank \`${broken.bankId}\`: ${broken.reason}`)
    }
    lines.push('')
  }

  if (report.warnings.length > 0) {
    lines.push('## Warnings (truncated to first 200)')
    lines.push('')
    for (const warning of report.warnings.slice(0, 200)) {
      lines.push(`- ${warning}`)
    }
    if (report.warnings.length > 200) {
      lines.push(`- _… and ${report.warnings.length - 200} more_`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
