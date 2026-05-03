import type { EntityExtension } from '@open-mercato/shared/modules/entities'
import { defineLink, entityId } from '@open-mercato/shared/modules/dsl'

const entityExtensions: EntityExtension[] = [
  defineLink(
    entityId('customers', 'company_billing'),
    entityId('auth', 'user'),
    {
      join: { baseKey: 'sales_owner_user_id', extensionKey: 'id' },
      cardinality: 'many-to-one',
      required: false,
      description:
        'Optional sales owner assigned to a company billing record. Resolved against auth.users via the sales_owner_user_id column.',
    },
  ),
]

export const extensions = entityExtensions
export default entityExtensions
