import { test, expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * TC-PARTNER-W1-PrimaryContact: only one primary contact per company
 *
 * Source spec: .ai/specs/2026-05-03-mvp-s-week-1-partner-foundation.md (story S1.4).
 * Behaviour: when a person-company link is promoted to `is_primary=true`, any other
 * active link on the same company must be demoted automatically (or rejected).
 */
test.describe('TC-PARTNER-W1-PrimaryContact: primary contact uniqueness', () => {
  test('promoting a contact to primary demotes the previous primary for the company', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let personOneId: string | null = null
    let personTwoId: string | null = null

    try {
      token = await getAuthToken(request)
      const stamp = Date.now()
      companyId = await createCompanyFixture(request, token, `QA-W1-PrimaryContact ${stamp}`)
      personOneId = await createPersonFixture(request, token, {
        firstName: 'Anna',
        lastName: 'Kowalska',
        displayName: `QA-W1 Anna ${stamp}`,
        companyEntityId: companyId,
      })
      personTwoId = await createPersonFixture(request, token, {
        firstName: 'Tomasz',
        lastName: 'Nowak',
        displayName: `QA-W1 Tomasz ${stamp}`,
      })

      const linkResponse = await apiRequest(
        request,
        'POST',
        `/api/customers/people/${personTwoId}/companies`,
        { token, data: { companyId, isPrimary: true } },
      )
      expect(linkResponse.ok(), `Failed to link second person ${linkResponse.status()}`).toBeTruthy()

      const verify = async (personId: string) => {
        const response = await apiRequest(
          request,
          'GET',
          `/api/customers/people/${personId}/companies`,
          { token: token! },
        )
        expect(response.ok(), `Failed to load companies for ${personId}`).toBeTruthy()
        const payload = (await response.json()) as { items?: Array<{ companyId?: string; isPrimary?: boolean }> }
        return Array.isArray(payload.items) ? payload.items : []
      }

      const personOneLinks = await verify(personOneId)
      const personTwoLinks = await verify(personTwoId)

      const primaryLinksForCompany = [
        ...personOneLinks.filter((link) => link.companyId === companyId && link.isPrimary === true),
        ...personTwoLinks.filter((link) => link.companyId === companyId && link.isPrimary === true),
      ]
      expect(primaryLinksForCompany).toHaveLength(1)
    } finally {
      if (token) {
        await deleteEntityIfExists(request, token, '/api/customers/people', personTwoId)
        await deleteEntityIfExists(request, token, '/api/customers/people', personOneId)
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      }
    }
  })
})
