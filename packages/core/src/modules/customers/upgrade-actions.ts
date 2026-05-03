import { upgradeActions } from '@open-mercato/core/modules/configs/lib/upgrade-actions'
import { reclassifyJdgEntities } from './lib/jdgClassification'

upgradeActions.push({
  id: 'customers.jdg-reclassification',
  version: '0.6.0',
  messageKey: 'customers.upgrade.jdgReclassification.message',
  ctaKey: 'customers.upgrade.jdgReclassification.cta',
  successKey: 'customers.upgrade.jdgReclassification.success',
  loadingKey: 'customers.upgrade.jdgReclassification.loading',
  run: async (ctx) => {
    await reclassifyJdgEntities(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },
})
