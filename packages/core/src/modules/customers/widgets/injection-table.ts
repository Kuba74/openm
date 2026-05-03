import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'crud-form:customers:customer_company_profile:fields': [
    {
      widgetId: 'customers.injection.tax-identities',
      kind: 'group',
      column: 2,
      groupLabel: 'customers.tax_identities.title',
      priority: 150,
    },
    {
      widgetId: 'customers.injection.sales',
      kind: 'group',
      column: 2,
      groupLabel: 'customers.sales.title',
      priority: 200,
    },
  ],
}

export default injectionTable
