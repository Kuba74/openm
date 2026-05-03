import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { SalesSettings, SalesDocumentSequence, SalesTaxRate } from './data/entities'
import {
  DEFAULT_ORDER_NUMBER_FORMAT,
  DEFAULT_QUOTE_NUMBER_FORMAT,
  DEFAULT_INVOICE_NUMBER_FORMAT,
  DEFAULT_RETURN_NUMBER_FORMAT,
  DEFAULT_CREDIT_MEMO_NUMBER_FORMAT,
} from './lib/documentNumberTokens'
import { seedSalesStatusDictionaries, seedSalesAdjustmentKinds } from './lib/dictionaries'
import { ensureExampleShippingMethods, ensureExamplePaymentMethods } from './seed/examples-data'
import { seedSalesExamples } from './seed/examples'

type SeedScope = { tenantId: string; organizationId: string }

const DEFAULT_TAX_RATES = [
  { code: 'vat-23', name: '23% VAT', rate: '23', countryCode: 'PL', isExempt: false, priority: 0 },
  { code: 'vat-8', name: '8% VAT', rate: '8', countryCode: 'PL', isExempt: false, priority: 10 },
  { code: 'vat-5', name: '5% VAT', rate: '5', countryCode: 'PL', isExempt: false, priority: 20 },
  { code: 'vat-0', name: '0% VAT', rate: '0', countryCode: 'PL', isExempt: false, priority: 30 },
  { code: 'vat-zw', name: 'Zwolnione (zw.)', rate: '0', countryCode: 'PL', isExempt: true, priority: 40 },
] as const

async function seedSalesTaxRates(em: EntityManager, scope: SeedScope): Promise<void> {
  await em.transactional(async (tem) => {
    const existing = await tem.find(SalesTaxRate, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    const existingCodes = new Set(existing.map((rate) => rate.code))
    const hasDefault = existing.some((rate) => rate.isDefault)
    const now = new Date()
    let isFirst = !hasDefault

    for (const seed of DEFAULT_TAX_RATES) {
      if (existingCodes.has(seed.code)) continue
      tem.persist(
        tem.create(SalesTaxRate, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          code: seed.code,
          name: seed.name,
          rate: seed.rate,
          countryCode: seed.countryCode,
          isExempt: seed.isExempt,
          priority: seed.priority,
          isCompound: false,
          isDefault: isFirst,
          createdAt: now,
          updatedAt: now,
        })
      )
      isFirst = false
    }
  })
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['sales.*', 'sales.documents.number.edit'],
    employee: [
      'sales.orders.view',
      'sales.orders.manage',
      'sales.orders.approve',
      'sales.widgets.new-orders',
      'sales.widgets.new-quotes',
      'sales.quotes.view',
      'sales.quotes.manage',
      'sales.shipments.manage',
      'sales.payments.manage',
      'sales.returns.view',
      'sales.returns.create',
      'sales.invoices.manage',
      'sales.credit_memos.manage',
    ],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    const exists = await em.findOne(SalesSettings, { tenantId, organizationId })
    if (!exists) {
      em.persist(
        em.create(SalesSettings, {
          tenantId,
          organizationId,
          orderNumberFormat: DEFAULT_ORDER_NUMBER_FORMAT,
          quoteNumberFormat: DEFAULT_QUOTE_NUMBER_FORMAT,
          invoiceNumberFormat: DEFAULT_INVOICE_NUMBER_FORMAT,
          returnNumberFormat: DEFAULT_RETURN_NUMBER_FORMAT,
          creditMemoNumberFormat: DEFAULT_CREDIT_MEMO_NUMBER_FORMAT,
          defaultCurrencyCode: 'PLN',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      )
    }

    for (const kind of ['order', 'quote', 'return', 'invoice', 'credit_memo'] as const) {
      const seq = await em.findOne(SalesDocumentSequence, {
        tenantId,
        organizationId,
        documentKind: kind,
      })
      if (!seq) {
        em.persist(
          em.create(SalesDocumentSequence, {
            tenantId,
            organizationId,
            documentKind: kind,
            currentValue: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        )
      }
    }

    await em.flush()
  },

  async seedDefaults({ em, tenantId, organizationId }) {
    const scope = { tenantId, organizationId }
    await seedSalesTaxRates(em, scope)
    await seedSalesStatusDictionaries(em, scope)
    await seedSalesAdjustmentKinds(em, scope)
    await ensureExampleShippingMethods(em, scope)
    await ensureExamplePaymentMethods(em, scope)
  },

  async seedExamples({ em, container, tenantId, organizationId }) {
    const scope = { tenantId, organizationId }
    await seedSalesExamples(em, container, scope)
  },
}

export default setup
