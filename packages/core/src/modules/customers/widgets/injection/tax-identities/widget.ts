import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TaxIdentitiesWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'customers.injection.tax-identities',
    title: 'Tax identities',
    description: 'Manage tax identifiers (NIP, REGON, KRS, EU VAT, …) for a company.',
    features: ['customers.tax_identities.view'],
    priority: 150,
    enabled: true,
  },
  Widget: TaxIdentitiesWidget,
}

export default widget
