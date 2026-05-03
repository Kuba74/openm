import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'sync_erp_fromee',
  title: 'ERP-fromee Customer Import',
  version: '0.1.0',
  description:
    'One-time CLI importer that pulls ~200 customer/prospect partners from the legacy erp-fromee Postgres into openm. Read-only against the source. Idempotent.',
  author: 'Open Mercato',
  license: 'MIT',
}

export default metadata
