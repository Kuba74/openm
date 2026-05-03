import type { ErpFromeeCompanyBankAccount, ImportScope } from '../types'

/**
 * Output shape: a single primary bank row destined for `customer_company_billing`
 * (Tydzień 1, 1:1 with company entity). Multi-bank model
 * (`customer_company_bank_accounts`) is deferred to Faza 4 per D10.
 *
 * IBAN is emitted in **plain text** here. Encryption (D11) is applied by the
 * pipeline layer that knows the tenant's `TenantDataEncryptionService` flag —
 * mappers stay pure and side-effect-free.
 */
export type BankAccountRow = {
  externalBankId: string                // erp-fromee CompanyBankAccount.id
  externalCompanyId: string             // erp-fromee Company.id (parent)
  organizationId: string
  tenantId: string
  bankName: string | null
  iban: string                          // normalized: uppercase, no spaces
  swift: string | null                  // normalized: uppercase, no spaces
}

export type BanksPlan = {
  primary: BankAccountRow | null
  /** Bank accounts not imported in MVP (multi-bank model deferred to Faza 4). */
  skipped: { id: string; reason: string }[]
  warnings: string[]
}

function sanitize(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed : null
}

function normalizeIban(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const cleaned = String(value).replace(/\s+/g, '').toUpperCase()
  return cleaned.length > 0 ? cleaned : null
}

function normalizeSwift(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const cleaned = String(value).replace(/\s+/g, '').toUpperCase()
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Maps erp-fromee `CompanyBankAccount` rows for a single Company into a
 * single primary bank row for `customer_company_billing`.
 *
 * Decyzje aplikowane:
 * - **D10** Single-bank only in MVP. Auto-promote first active bank when no
 *   `isPrimary=true` is flagged (production audit: 65/66 banks lack the
 *   flag). Non-primary actives go to `skipped` with a per-record reason —
 *   pipeline writes them to the import report for the Faza 4 follow-up.
 * - **D10 — broken-record skip**: bank rows lacking an IBAN are dropped
 *   even when they are the only bank on the Company (covers `Constar GmbH`
 *   and `Thomas Melsdorf` from the 2026-05-03 audit). The Company itself
 *   is still imported; it simply lands without billing IBAN.
 * - **D11** IBAN emitted in plain text. Encryption is applied by the
 *   pipeline (it owns the `TenantDataEncryptionService` resolution).
 * - **Inactive banks** are dropped silently — historical accounts have no
 *   value in `customer_company_billing` (single-row, current state only).
 *
 * Empty `bankAccounts` input returns `{ primary: null, skipped: [], warnings: [] }`
 * — 1074/1140 source companies fall in this bucket per audit.
 */
export function mapBanks(
  source: { companyId: string; bankAccounts: ErpFromeeCompanyBankAccount[] },
  scope: ImportScope,
): BanksPlan {
  const skipped: { id: string; reason: string }[] = []
  const warnings: string[] = []

  if (source.bankAccounts.length === 0) {
    return { primary: null, skipped, warnings }
  }

  // Sort by createdAt ASC for deterministic auto-promotion.
  const sorted = [...source.bankAccounts].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )
  const active = sorted.filter((b) => b.isActive)

  if (active.length === 0) {
    for (const bank of sorted) {
      skipped.push({ id: bank.id, reason: 'inactive' })
    }
    return { primary: null, skipped, warnings }
  }

  // D10: pick primary — explicit flag wins; otherwise earliest active.
  const explicitPrimary = active.find((b) => b.isPrimary)
  let candidate = explicitPrimary ?? active[0]

  // D10 broken-record skip: candidate must have an IBAN. If the chosen one
  // does not, try to find another active bank that does. If none qualify,
  // drop the entire bank set with explicit warnings (Constar/Melsdorf path).
  if (!normalizeIban(candidate.iban)) {
    const fallback = active.find((b) => normalizeIban(b.iban))
    if (fallback) {
      skipped.push({
        id: candidate.id,
        reason: `missing IBAN (preferred candidate); falling back to ${fallback.id}`,
      })
      candidate = fallback
    } else {
      for (const bank of sorted) {
        skipped.push({ id: bank.id, reason: 'missing IBAN' })
      }
      warnings.push(
        `Company ${source.companyId}: all bank accounts missing IBAN — billing imported without bank details`,
      )
      return { primary: null, skipped, warnings }
    }
  }

  if (active.length > 1) {
    warnings.push(
      `Company ${source.companyId}: ${active.length} active bank accounts — kept ${candidate.id} (D10 single-bank MVP), deferred others to Faza 4`,
    )
  }
  if (!explicitPrimary && active.length > 1) {
    warnings.push(
      `Company ${source.companyId}: no isPrimary flagged — auto-promoted ${candidate.id} (earliest active)`,
    )
  }

  for (const bank of sorted) {
    if (bank.id === candidate.id) continue
    skipped.push({
      id: bank.id,
      reason: bank.isActive ? 'multi-bank deferred to Faza 4' : 'inactive',
    })
  }

  const iban = normalizeIban(candidate.iban)
  if (!iban) {
    // Defensive — should be unreachable because we just validated above.
    warnings.push(`Company ${source.companyId}: chosen bank ${candidate.id} lost IBAN during normalization`)
    return { primary: null, skipped: [...skipped, { id: candidate.id, reason: 'missing IBAN' }], warnings }
  }

  const primary: BankAccountRow = {
    externalBankId: candidate.id,
    externalCompanyId: source.companyId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    bankName: sanitize(candidate.bankName),
    iban,
    swift: normalizeSwift(candidate.swift),
  }

  return { primary, skipped, warnings }
}

export const __testables = { sanitize, normalizeIban, normalizeSwift }
