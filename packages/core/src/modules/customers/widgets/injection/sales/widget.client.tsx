"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

const DEFAULT_OFFER_VALIDITY_DAYS = 30

type SalesBillingResponse = {
  companyId: string
  salesOwnerUserId: string | null
  defaultOfferValidityDays: number | null
}

type StaffItem = {
  userId: string
  displayName: string
  email: string | null
}

type StaffListResponse = {
  items?: StaffItem[]
}

type WidgetContext = {
  recordId?: string
}

type WidgetProps = {
  context?: WidgetContext
}

export default function SalesSectionWidget({ context }: WidgetProps) {
  const t = useT()
  const companyId = context?.recordId
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [salesOwnerUserId, setSalesOwnerUserId] = React.useState<string>('')
  const [defaultValidityDays, setDefaultValidityDays] = React.useState<string>('')
  const [staff, setStaff] = React.useState<StaffItem[]>([])
  const [saving, setSaving] = React.useState(false)
  const [validationError, setValidationError] = React.useState<string | null>(null)

  const guarded = useGuardedMutation({
    contextId: `customers.sales.billing:${companyId ?? 'unknown'}`,
  })

  const refresh = React.useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const result = await apiCall(`/api/customers/companies/${companyId}/sales-billing`)
      if (!result.ok) {
        setError(t('customers.sales.errors.load_failed', 'Failed to load sales properties.'))
        return
      }
      const data = result.result as SalesBillingResponse
      setSalesOwnerUserId(data.salesOwnerUserId ?? '')
      setDefaultValidityDays(
        data.defaultOfferValidityDays != null ? String(data.defaultOfferValidityDays) : '',
      )
    } catch {
      setError(t('customers.sales.errors.load_failed', 'Failed to load sales properties.'))
    } finally {
      setLoading(false)
    }
  }, [companyId, t])

  const loadStaff = React.useCallback(async () => {
    try {
      const result = await apiCall('/api/customers/assignable-staff?pageSize=100')
      if (!result.ok) {
        setStaff([])
        return
      }
      const data = result.result as StaffListResponse
      const items = Array.isArray(data?.items) ? data.items : []
      setStaff(
        items.map((entry) => ({
          userId: entry.userId,
          displayName: entry.displayName,
          email: entry.email ?? null,
        })),
      )
    } catch {
      setStaff([])
    }
  }, [])

  React.useEffect(() => {
    refresh()
    loadStaff()
  }, [refresh, loadStaff])

  const handleSave = React.useCallback(async () => {
    if (!companyId) return
    setValidationError(null)

    let parsedValidity: number | null = null
    const trimmedValidity = defaultValidityDays.trim()
    if (trimmedValidity.length > 0) {
      const numeric = Number(trimmedValidity)
      if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 1 || numeric > 365) {
        setValidationError(
          t(
            'customers.sales.errors.invalid_validity_days',
            'Default offer validity must be between 1 and 365 days.',
          ),
        )
        return
      }
      parsedValidity = numeric
    }

    setSaving(true)
    try {
      await guarded.runMutation({
        operation: async () => {
          const result = await apiCall(`/api/customers/companies/${companyId}/sales-billing`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              salesOwnerUserId: salesOwnerUserId.length > 0 ? salesOwnerUserId : null,
              defaultOfferValidityDays: parsedValidity,
            }),
          })
          if (!result.ok) {
            const payload = result.result as { error?: string } | null
            const message = payload?.error
              ? t(payload.error, payload.error)
              : t('customers.sales.errors.save_failed', 'Failed to save sales properties.')
            throw new Error(message)
          }
          return result.result
        },
        context: {
          formId: `customers.sales.billing:${companyId}`,
          retryLastMutation: () => handleSave(),
        },
      })
      flash(t('customers.sales.flash.saved', 'Sales properties saved.'), 'success')
      await refresh()
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('customers.sales.errors.save_failed', 'Failed to save sales properties.')
      setValidationError(message)
    } finally {
      setSaving(false)
    }
  }, [companyId, defaultValidityDays, guarded, refresh, salesOwnerUserId, t])

  if (!companyId) {
    return null
  }

  const submitOnEnter: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSave()
    }
  }

  return (
    <div className="rounded-md border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">
          {t('customers.sales.title', 'Sales')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t(
            'customers.sales.subtitle',
            'Default sales owner and offer validity used to pre-fill quotes for this company.',
          )}
        </p>
      </div>

      {error ? (
        <div className="text-sm text-status-error-text">{error}</div>
      ) : null}

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading…')}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="customers-sales-owner">
            {t('customers.sales.fields.sales_owner', 'Sales owner')}
          </Label>
          <select
            id="customers-sales-owner"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={salesOwnerUserId}
            onChange={(event) => setSalesOwnerUserId(event.target.value)}
          >
            <option value="">
              {t('customers.sales.fields.sales_owner_unassigned', 'Unassigned')}
            </option>
            {staff.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}{member.email ? ` (${member.email})` : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t(
              'customers.sales.fields.sales_owner_hint',
              'Drives quote ownership and notification routing.',
            )}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="customers-sales-validity">
            {t('customers.sales.fields.default_validity_days', 'Default offer validity (days)')}
          </Label>
          <Input
            id="customers-sales-validity"
            type="number"
            min={1}
            max={365}
            value={defaultValidityDays}
            onChange={(event) => setDefaultValidityDays(event.target.value)}
            onKeyDown={submitOnEnter}
            placeholder={String(DEFAULT_OFFER_VALIDITY_DAYS)}
          />
          <p className="text-xs text-muted-foreground">
            {t(
              'customers.sales.fields.default_validity_hint',
              'Falls back to {default} when blank.',
              { default: String(DEFAULT_OFFER_VALIDITY_DAYS) },
            )}
          </p>
        </div>
      </div>

      {validationError ? (
        <div className="text-sm text-status-error-text">{validationError}</div>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={saving || loading}>
          {saving
            ? t('customers.sales.actions.saving', 'Saving…')
            : t('customers.sales.actions.save', 'Save sales properties')}
        </Button>
      </div>
    </div>
  )
}
