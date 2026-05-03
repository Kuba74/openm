import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * TC-PARTNER-001: Customer tax identities CRUD + uniqueness + permissions
 *
 * Covers:
 *  - Create company → POST 3 tax identities (PL NIP, DE EU VAT, FR EU VAT)
 *  - GET list returns all 3
 *  - Duplicate PL NIP across the same scope → 409 Conflict
 *  - DELETE one → list returns 2
 *  - User without `customers.tax_identities.manage` cannot POST → 403
 */
test.describe('TC-PARTNER-001: Tax identities CRUD + permissions', () => {
  test('admin can manage tax identities; non-manager is blocked', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const companyName = `QA TC-PARTNER-001 ${Date.now()}`
    let companyId: string | null = null
    const createdIds: string[] = []

    try {
      companyId = await createCompanyFixture(request, adminToken, companyName)
      expect(companyId).toBeTruthy()

      const baseUrl = `/api/customers/companies/${companyId}/tax-identities`

      const nipResponse = await apiRequest(request, 'POST', baseUrl, {
        token: adminToken,
        data: { countryCode: 'PL', kind: 'nip', value: '5260250995' },
      })
      expect(nipResponse.status(), 'expected 201 for first NIP').toBe(201)
      const nipBody = (await readJsonSafe(nipResponse)) as { id?: string; value?: string } | null
      expect(typeof nipBody?.id).toBe('string')
      expect(nipBody?.value).toBe('5260250995')
      if (nipBody?.id) createdIds.push(nipBody.id)

      const deResponse = await apiRequest(request, 'POST', baseUrl, {
        token: adminToken,
        data: { countryCode: 'DE', kind: 'vat_eu', value: 'DE123456789' },
      })
      expect(deResponse.status(), 'expected 201 for DE VAT').toBe(201)
      const deBody = (await readJsonSafe(deResponse)) as { id?: string } | null
      if (deBody?.id) createdIds.push(deBody.id)

      const frResponse = await apiRequest(request, 'POST', baseUrl, {
        token: adminToken,
        data: { countryCode: 'FR', kind: 'vat_eu', value: 'FRAB123456789' },
      })
      expect(frResponse.status(), 'expected 201 for FR VAT').toBe(201)
      const frBody = (await readJsonSafe(frResponse)) as { id?: string } | null
      if (frBody?.id) createdIds.push(frBody.id)

      const listResponse = await apiRequest(request, 'GET', baseUrl, { token: adminToken })
      expect(listResponse.ok()).toBeTruthy()
      const listBody = (await readJsonSafe(listResponse)) as { items?: Array<{ id: string }>; total?: number } | null
      expect(listBody?.items?.length).toBe(3)

      const duplicateResponse = await apiRequest(request, 'POST', baseUrl, {
        token: adminToken,
        data: { countryCode: 'PL', kind: 'nip', value: '5260250995' },
      })
      expect(duplicateResponse.status(), 'duplicate PL NIP must be 409').toBe(409)

      const targetId = nipBody?.id
      expect(targetId).toBeTruthy()
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${baseUrl}/${encodeURIComponent(String(targetId))}`,
        { token: adminToken },
      )
      expect(deleteResponse.ok(), 'soft delete must succeed').toBeTruthy()

      const listAfterDelete = await apiRequest(request, 'GET', baseUrl, { token: adminToken })
      expect(listAfterDelete.ok()).toBeTruthy()
      const afterBody = (await readJsonSafe(listAfterDelete)) as { items?: Array<{ id: string }> } | null
      expect(afterBody?.items?.length).toBe(2)
      expect(afterBody?.items?.every((item) => item.id !== targetId)).toBeTruthy()

      let viewerToken: string | null = null
      try {
        viewerToken = await getAuthToken(request, 'employee')
      } catch {
        viewerToken = null
      }
      if (viewerToken) {
        const forbiddenResponse = await apiRequest(request, 'POST', baseUrl, {
          token: viewerToken,
          data: { countryCode: 'IT', kind: 'vat_eu', value: 'IT12345678901' },
        })
        expect(forbiddenResponse.status(), 'employee role must not be allowed to manage tax identities').toBe(403)
      } else {
        test.info().annotations.push({
          type: 'skip-detail',
          description: 'Skipped permission denial branch: employee credentials not configured for this environment.',
        })
      }
    } finally {
      for (const id of createdIds) {
        if (!companyId) break
        try {
          await apiRequest(
            request,
            'DELETE',
            `/api/customers/companies/${companyId}/tax-identities/${encodeURIComponent(id)}`,
            { token: adminToken },
          )
        } catch {
          // ignore cleanup errors; integration env may already have removed the row
        }
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
    }
  })
})
