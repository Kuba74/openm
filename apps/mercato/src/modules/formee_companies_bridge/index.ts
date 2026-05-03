import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'formee_companies_bridge',
  title: 'Formee → Mercato Companies Bridge (POC)',
  version: '0.1.0',
  description:
    'Read-only one-shot importer that maps the legacy Formee Prisma "Company" rows into Open Mercato customer entities. POC validating the migration path.',
  author: 'Formee',
  license: 'UNLICENSED',
}

export default metadata
