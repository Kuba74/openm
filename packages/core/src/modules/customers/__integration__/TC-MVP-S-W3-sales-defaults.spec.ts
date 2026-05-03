import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

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

test.describe('TC-MVP-S-W3: GET /api/customers/companies/[id]/sales-defaults', () => {
  test('rejects unauthenticated requests with 401', async ({ request }) => {
    const response = await request.get(
      '/api/customers/companies/00000000-0000-0000-0000-000000000001/sales-defaults',
    )
    expect(response.status()).toBe(401)
  })

  test('returns 404 for an unknown company id', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'GET',
      '/api/customers/companies/00000000-0000-0000-0000-000000000001/sales-defaults',
      { token },
    )
    expect(response.status()).toBe(404)
  })

  test('returns 400 when the id is not a uuid', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'GET',
      '/api/customers/companies/not-a-uuid/sales-defaults',
      { token },
    )
    expect(response.status()).toBe(400)
  })

  test('returns billing-driven defaults and DEFAULT_OFFER_VALIDITY_DAYS=30 when no overrides exist', async ({ request }) => {
    const token = await getAuthToken(request)
    const prefix = `QA TC-MVP-S-W3 ${Date.now()}`
    let companyId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', '/api/customers/companies', {
        token,
        data: { displayName: `${prefix} Co` },
      })
      expect(createResponse.ok()).toBeTruthy()
      const body = (await readJsonSafe<{ id?: unknown }>(createResponse)) ?? {}
      expect(typeof body.id).toBe('string')
      companyId = body.id as string

      const response = await apiRequest(
        request,
        'GET',
        `/api/customers/companies/${companyId}/sales-defaults`,
        { token },
      )
      expect(response.status()).toBe(200)
      const payload = (await readJsonSafe<SalesDefaultsResponse>(response)) ?? ({} as SalesDefaultsResponse)

      expect(payload.primaryContactId).toBeNull()
      expect(payload.primaryContactName).toBeNull()
      expect(payload.primaryEmail).toBeNull()
      expect(payload.primaryPhone).toBeNull()
      expect(payload.defaultShippingAddressId).toBeNull()
      expect(payload.defaultBillingAddressId).toBeNull()
      expect(payload.preferredCurrency).toBeNull()
      expect(payload.paymentTerms).toBeNull()
      expect(payload.salesOwnerUserId).toBeNull()
      expect(payload.defaultOfferValidityDays).toBe(30)
    } finally {
      if (companyId) {
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      }
    }
  })

  test('reflects sales-billing PATCH (salesOwner + offer validity days)', async ({ request }) => {
    const token = await getAuthToken(request)
    const prefix = `QA TC-MVP-S-W3 ${Date.now()}`
    let companyId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', '/api/customers/companies', {
        token,
        data: { displayName: `${prefix} Billing` },
      })
      expect(createResponse.ok()).toBeTruthy()
      const created = (await readJsonSafe<{ id?: unknown }>(createResponse)) ?? {}
      expect(typeof created.id).toBe('string')
      companyId = created.id as string

      const patchResponse = await apiRequest(
        request,
        'PATCH',
        `/api/customers/companies/${companyId}/sales-billing`,
        {
          token,
          data: { defaultOfferValidityDays: 14 },
        },
      )
      expect(patchResponse.ok()).toBeTruthy()

      const response = await apiRequest(
        request,
        'GET',
        `/api/customers/companies/${companyId}/sales-defaults`,
        { token },
      )
      expect(response.status()).toBe(200)
      const payload = (await readJsonSafe<SalesDefaultsResponse>(response)) ?? ({} as SalesDefaultsResponse)
      expect(payload.defaultOfferValidityDays).toBe(14)
      expect(payload.salesOwnerUserId).toBeNull()
    } finally {
      if (companyId) {
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      }
    }
  })
})
