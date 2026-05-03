import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * TC-PARTNER-W1-PrimaryAddress: at most one primary address per (entity, purpose)
 *
 * Source spec: .ai/specs/2026-05-03-mvp-s-week-1-partner-foundation.md (story S1.5).
 * Behaviour: a unique partial index on `customer_addresses (entity_id, purpose)` rejects
 * a second active `is_primary=true` row for the same purpose. The same entity may keep a
 * primary `billing` and a primary `shipping` address simultaneously.
 */
test.describe('TC-PARTNER-W1-PrimaryAddress: primary address uniqueness per purpose', () => {
  test('rejects a second primary address with the same purpose for the same entity', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let firstAddressId: string | null = null
    let secondAddressId: string | null = null

    try {
      token = await getAuthToken(request)
      const stamp = Date.now()
      companyId = await createCompanyFixture(request, token, `QA-W1-PrimaryAddress ${stamp}`)

      const firstResponse = await apiRequest(request, 'POST', '/api/customers/addresses', {
        token,
        data: {
          entityId: companyId,
          purpose: 'billing',
          addressLine1: 'ul. Marszałkowska 1',
          city: 'Warszawa',
          country: 'Polska',
          isPrimary: true,
        },
      })
      expect(firstResponse.ok(), `Failed to create first billing address: ${firstResponse.status()}`).toBeTruthy()
      const firstPayload = (await firstResponse.json()) as { id?: string; result?: { id?: string } } | null
      firstAddressId = firstPayload?.id ?? firstPayload?.result?.id ?? null
      expect(firstAddressId, 'Missing id for first billing address').toBeTruthy()

      const secondResponse = await apiRequest(request, 'POST', '/api/customers/addresses', {
        token,
        data: {
          entityId: companyId,
          purpose: 'billing',
          addressLine1: 'ul. Świętokrzyska 12',
          city: 'Warszawa',
          country: 'Polska',
          isPrimary: true,
        },
      })

      if (secondResponse.ok()) {
        const secondPayload = (await secondResponse.json()) as { id?: string; result?: { id?: string } } | null
        secondAddressId = secondPayload?.id ?? secondPayload?.result?.id ?? null
        const listResponse = await apiRequest(
          request,
          'GET',
          `/api/customers/addresses?entityId=${companyId}&pageSize=50`,
          { token },
        )
        expect(listResponse.ok(), 'Failed to list addresses for verification').toBeTruthy()
        const listPayload = (await listResponse.json()) as {
          items?: Array<{ id?: string; purpose?: string | null; is_primary?: boolean; isPrimary?: boolean }>
        }
        const items = Array.isArray(listPayload.items) ? listPayload.items : []
        const billingPrimaries = items.filter((item) =>
          (item.purpose ?? '') === 'billing' &&
          (item.is_primary === true || item.isPrimary === true),
        )
        expect(billingPrimaries).toHaveLength(1)
      } else {
        expect([400, 409, 422]).toContain(secondResponse.status())
      }
    } finally {
      if (token) {
        if (secondAddressId) {
          await deleteEntityIfExists(request, token, '/api/customers/addresses', secondAddressId)
        }
        if (firstAddressId) {
          await deleteEntityIfExists(request, token, '/api/customers/addresses', firstAddressId)
        }
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      }
    }
  })

  test('allows distinct primary addresses across different purposes for the same entity', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const createdAddressIds: string[] = []

    try {
      token = await getAuthToken(request)
      const stamp = Date.now()
      companyId = await createCompanyFixture(request, token, `QA-W1-PrimaryAddress-Multi ${stamp}`)

      for (const purpose of ['billing', 'shipping'] as const) {
        const response = await apiRequest(request, 'POST', '/api/customers/addresses', {
          token,
          data: {
            entityId: companyId,
            purpose,
            addressLine1: `ul. Test ${purpose}`,
            city: 'Warszawa',
            country: 'Polska',
            isPrimary: true,
          },
        })
        expect(response.ok(), `Failed to create primary ${purpose} address: ${response.status()}`).toBeTruthy()
        const payload = (await response.json()) as { id?: string; result?: { id?: string } } | null
        const id = payload?.id ?? payload?.result?.id ?? null
        if (id) createdAddressIds.push(id)
      }

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/addresses?entityId=${companyId}&pageSize=50`,
        { token },
      )
      expect(listResponse.ok(), 'Failed to list addresses for verification').toBeTruthy()
      const listPayload = (await listResponse.json()) as {
        items?: Array<{ purpose?: string | null; is_primary?: boolean; isPrimary?: boolean }>
      }
      const items = Array.isArray(listPayload.items) ? listPayload.items : []
      const primaries = items.filter((item) => item.is_primary === true || item.isPrimary === true)
      expect(primaries.length).toBeGreaterThanOrEqual(2)
    } finally {
      if (token) {
        for (const id of createdAddressIds) {
          await deleteEntityIfExists(request, token, '/api/customers/addresses', id)
        }
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      }
    }
  })
})
