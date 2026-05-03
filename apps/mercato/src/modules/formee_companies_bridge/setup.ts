import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['formee_companies_bridge.*'],
    admin: ['formee_companies_bridge.*'],
  },
}

export default setup
