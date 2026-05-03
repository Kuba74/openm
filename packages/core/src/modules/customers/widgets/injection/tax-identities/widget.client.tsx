"use client"

import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatNipForDisplay } from '../../../data/taxIdentityChecksums'

type TaxIdentity = {
  id: string
  countryCode: string
  kind: string
  value: string
  validFrom: string | null
  validTo: string | null
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

type ListResponse = {
  items?: TaxIdentity[]
  total?: number
}

type WidgetContext = {
  recordId?: string
  entityId?: string
}

type WidgetProps = {
  context?: WidgetContext
}

const KIND_OPTIONS = [
  { value: 'nip', labelKey: 'customers.tax_identities.kinds.nip', fallback: 'NIP' },
  { value: 'regon', labelKey: 'customers.tax_identities.kinds.regon', fallback: 'REGON' },
  { value: 'krs', labelKey: 'customers.tax_identities.kinds.krs', fallback: 'KRS' },
  { value: 'pesel', labelKey: 'customers.tax_identities.kinds.pesel', fallback: 'PESEL' },
  { value: 'vat_eu', labelKey: 'customers.tax_identities.kinds.vat_eu', fallback: 'EU VAT' },
  { value: 'vat', labelKey: 'customers.tax_identities.kinds.vat', fallback: 'VAT' },
  { value: 'eori', labelKey: 'customers.tax_identities.kinds.eori', fallback: 'EORI' },
  { value: 'other', labelKey: 'customers.tax_identities.kinds.other', fallback: 'Other' },
] as const

function defaultCountryForKind(kind: string): string {
  if (kind === 'nip' || kind === 'regon' || kind === 'krs' || kind === 'pesel') return 'PL'
  return ''
}

function formatValueForDisplay(kind: string, value: string): string {
  if (kind === 'nip') return formatNipForDisplay(value)
  return value
}

export default function TaxIdentitiesWidget({ context }: WidgetProps) {
  const t = useT()
  const companyId = context?.recordId
  const [items, setItems] = React.useState<TaxIdentity[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [draftCountry, setDraftCountry] = React.useState('PL')
  const [draftKind, setDraftKind] = React.useState('nip')
  const [draftValue, setDraftValue] = React.useState('')
  const [validationError, setValidationError] = React.useState<string | null>(null)

  const guarded = useGuardedMutation({
    contextId: `customers.tax_identities:${companyId ?? 'unknown'}`,
  })

  const refresh = React.useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const result = await apiCall(`/api/customers/companies/${companyId}/tax-identities`)
      if (!result.ok) {
        setError(t('customers.tax_identities.errors.load_failed', 'Failed to load tax identities.'))
        setItems([])
        return
      }
      const data = result.result as ListResponse
      setItems(Array.isArray(data?.items) ? data.items : [])
    } catch {
      setError(t('customers.tax_identities.errors.load_failed', 'Failed to load tax identities.'))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [companyId, t])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const handleKindChange = React.useCallback((nextKind: string) => {
    setDraftKind(nextKind)
    if (!draftCountry) {
      setDraftCountry(defaultCountryForKind(nextKind))
    }
  }, [draftCountry])

  const handleSubmit = React.useCallback(async () => {
    if (!companyId) return
    setValidationError(null)
    const trimmedValue = draftValue.trim()
    const trimmedCountry = draftCountry.trim().toUpperCase()
    if (!trimmedValue) {
      setValidationError(t('customers.tax_identities.errors.invalid_value', 'Tax identifier value is required.'))
      return
    }
    if (!/^[A-Z]{2}$/.test(trimmedCountry)) {
      setValidationError(t('customers.tax_identities.errors.invalid_country_code', 'Country code must be two letters.'))
      return
    }

    setCreating(true)
    try {
      await guarded.runMutation({
        operation: async () => {
          const result = await apiCall(`/api/customers/companies/${companyId}/tax-identities`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              countryCode: trimmedCountry,
              kind: draftKind,
              value: trimmedValue,
            }),
          })
          if (!result.ok) {
            const payload = result.result as { error?: string } | null
            const message = payload?.error
              ? t(payload.error, payload.error)
              : t('customers.tax_identities.errors.create_failed', 'Failed to add tax identity.')
            throw new Error(message)
          }
          return result.result
        },
        context: {
          formId: `customers.tax_identities:${companyId}`,
          retryLastMutation: () => handleSubmit(),
        },
      })
      flash(t('customers.tax_identities.flash.created', 'Tax identity added.'), 'success')
      setDraftValue('')
      setValidationError(null)
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.tax_identities.errors.create_failed', 'Failed to add tax identity.')
      setValidationError(message)
    } finally {
      setCreating(false)
    }
  }, [companyId, draftCountry, draftKind, draftValue, guarded, refresh, t])

  const handleDelete = React.useCallback(async (id: string) => {
    if (!companyId) return
    try {
      await guarded.runMutation({
        operation: async () => {
          const result = await apiCall(`/api/customers/companies/${companyId}/tax-identities/${id}`, {
            method: 'DELETE',
          })
          if (!result.ok) {
            const payload = result.result as { error?: string } | null
            const message = payload?.error
              ? t(payload.error, payload.error)
              : t('customers.tax_identities.errors.delete_failed', 'Failed to delete tax identity.')
            throw new Error(message)
          }
          return result.result
        },
        context: {
          formId: `customers.tax_identities:${companyId}`,
          retryLastMutation: () => handleDelete(id),
        },
      })
      flash(t('customers.tax_identities.flash.deleted', 'Tax identity removed.'), 'success')
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.tax_identities.errors.delete_failed', 'Failed to delete tax identity.')
      flash(message, 'error')
    }
  }, [companyId, guarded, refresh, t])

  if (!companyId) {
    return null
  }

  const submitOnEnter: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div className="rounded-md border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">
            {t('customers.tax_identities.title', 'Tax identities')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('customers.tax_identities.subtitle', 'NIP / REGON / KRS / EU VAT registered to this company.')}
          </p>
        </div>
        {items.length > 0 ? (
          <span className="text-xs text-muted-foreground">{items.length}</span>
        ) : null}
      </div>

      {error ? (
        <div className="text-sm text-status-error-text">{error}</div>
      ) : null}

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading…')}</div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t('customers.tax_identities.empty', 'No tax identifiers recorded.')}
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="divide-y">
          {items.map((item) => {
            const kindLabel = KIND_OPTIONS.find((option) => option.value === item.kind)
            return (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {item.countryCode}
                    </span>
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {kindLabel ? t(kindLabel.labelKey, kindLabel.fallback) : item.kind.toUpperCase()}
                    </span>
                    <span className="font-mono text-sm text-foreground">
                      {formatValueForDisplay(item.kind, item.value)}
                    </span>
                  </div>
                </div>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(item.id)}
                  aria-label={t('customers.tax_identities.actions.delete', 'Delete tax identity')}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="border-t pt-3 space-y-3">
        <div className="grid gap-3 md:grid-cols-[120px_180px_1fr_auto] md:items-end">
          <div className="space-y-1">
            <Label htmlFor="customers-tax-identity-country">
              {t('customers.tax_identities.fields.country', 'Country')}
            </Label>
            <Input
              id="customers-tax-identity-country"
              value={draftCountry}
              maxLength={2}
              onChange={(event) => setDraftCountry(event.target.value.toUpperCase())}
              onKeyDown={submitOnEnter}
              placeholder="PL"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="customers-tax-identity-kind">
              {t('customers.tax_identities.fields.kind', 'Kind')}
            </Label>
            <select
              id="customers-tax-identity-kind"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draftKind}
              onChange={(event) => handleKindChange(event.target.value)}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey, option.fallback)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="customers-tax-identity-value">
              {t('customers.tax_identities.fields.value', 'Value')}
            </Label>
            <Input
              id="customers-tax-identity-value"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              onKeyDown={submitOnEnter}
              placeholder={t('customers.tax_identities.fields.value.placeholder', 'e.g. 5260250995')}
            />
          </div>
          <Button
            type="button"
            disabled={creating}
            onClick={() => void handleSubmit()}
          >
            {t('customers.tax_identities.actions.add', 'Add')}
          </Button>
        </div>
        {validationError ? (
          <div className="text-sm text-status-error-text">{validationError}</div>
        ) : null}
      </div>
    </div>
  )
}
