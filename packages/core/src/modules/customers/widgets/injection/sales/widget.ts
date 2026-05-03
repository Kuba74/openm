import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import SalesSectionWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'customers.injection.sales',
    title: 'Sales',
    description: 'Sales-side billing properties (sales owner, default offer validity days) for a company.',
    features: ['customers.companies.view'],
    priority: 200,
    enabled: true,
  },
  Widget: SalesSectionWidget,
}

export default widget
