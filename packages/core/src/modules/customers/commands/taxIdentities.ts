import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerTaxIdentity } from '../data/entities'
import {
  taxIdentityCreateSchema,
  taxIdentityUpdateSchema,
  type TaxIdentityCreateInput,
  type TaxIdentityUpdateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
  requireCustomerEntity,
  resolveParentResourceKind,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'

const TAX_IDENTITY_ENTITY_TYPE = 'customers:customer_tax_identity'

const taxIdentityCrudIndexer: CrudIndexerConfig<CustomerTaxIdentity> = {
  entityType: TAX_IDENTITY_ENTITY_TYPE,
}

const taxIdentityCrudEvents: CrudEventsConfig<CustomerTaxIdentity> = {
  module: 'customers',
  entity: 'tax_identity',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type TaxIdentitySnapshot = {
  id: string
  organizationId: string
  tenantId: string
  entityId: string
  entityKind: string | null
  countryCode: string
  kind: string
  value: string
  validFrom: Date | null
  validTo: Date | null
  isPrimary: boolean
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

type TaxIdentityUndoPayload = {
  before?: TaxIdentitySnapshot | null
  after?: TaxIdentitySnapshot | null
}

async function loadTaxIdentitySnapshot(
  em: EntityManager,
  id: string,
): Promise<TaxIdentitySnapshot | null> {
  const record = await em.findOne(CustomerTaxIdentity, { id }, { populate: ['entity'] })
  if (!record) return null
  const entityRef = record.entity
  const entityKind =
    typeof entityRef === 'object' && entityRef !== null && 'kind' in entityRef
      ? (entityRef as { kind: string }).kind
      : null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    entityId: typeof entityRef === 'string' ? entityRef : entityRef.id,
    entityKind,
    countryCode: record.countryCode,
    kind: record.kind,
    value: record.value,
    validFrom: record.validFrom ?? null,
    validTo: record.validTo ?? null,
    isPrimary: record.isPrimary,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt ?? null,
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown }
  if (candidate.code === '23505') return true
  if (typeof candidate.constraint === 'string' && candidate.constraint.includes('customer_tax_identities_unique_active')) {
    return true
  }
  if (typeof candidate.message === 'string' && candidate.message.includes('customer_tax_identities_unique_active')) {
    return true
  }
  return false
}

async function flushOrConflict(em: EntityManager, conflictMessageKey: string): Promise<void> {
  const { translate } = await resolveTranslations()
  try {
    await em.flush()
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CrudHttpError(409, {
        error: translate(conflictMessageKey, 'A tax identity with the same country, kind, and value already exists.'),
      })
    }
    throw err
  }
}

const createTaxIdentityCommand: CommandHandler<TaxIdentityCreateInput, { taxIdentityId: string }> = {
  id: 'customers.tax_identities.create',
  async execute(rawInput, ctx) {
    const parsed = taxIdentityCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)

    const record = em.create(CustomerTaxIdentity, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      entity,
      countryCode: parsed.countryCode,
      kind: parsed.kind,
      value: parsed.value,
      validFrom: parsed.validFrom ?? null,
      validTo: parsed.validTo ?? null,
      isPrimary: parsed.isPrimary ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(record)
    await flushOrConflict(em, 'customers.tax_identities.errors.duplicate')

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: taxIdentityCrudIndexer,
      events: taxIdentityCrudEvents,
    })

    return { taxIdentityId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadTaxIdentitySnapshot(em, result.taxIdentityId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as TaxIdentitySnapshot | undefined
    return {
      actionLabel: translate('customers.audit.taxIdentities.create', 'Create tax identity'),
      resourceKind: 'customers.tax_identity',
      resourceId: result.taxIdentityId,
      parentResourceKind: resolveParentResourceKind(snapshot?.entityKind),
      parentResourceId: snapshot?.entityId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies TaxIdentityUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const recordId = logEntry?.resourceId ?? null
    if (!recordId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CustomerTaxIdentity, { id: recordId })
    if (!record) return
    const identifiers = {
      id: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
    }
    await em.removeAndFlush(record)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: record,
      identifiers,
      indexer: taxIdentityCrudIndexer,
      events: taxIdentityCrudEvents,
    })
  },
}

const updateTaxIdentityCommand: CommandHandler<TaxIdentityUpdateInput, { taxIdentityId: string }> = {
  id: 'customers.tax_identities.update',
  async prepare(rawInput, ctx) {
    const parsed = taxIdentityUpdateSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadTaxIdentitySnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = taxIdentityUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CustomerTaxIdentity, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Tax identity not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.countryCode !== undefined) record.countryCode = parsed.countryCode
    if (parsed.kind !== undefined) record.kind = parsed.kind
    if (parsed.value !== undefined) record.value = parsed.value
    if (parsed.validFrom !== undefined) record.validFrom = parsed.validFrom ?? null
    if (parsed.validTo !== undefined) record.validTo = parsed.validTo ?? null
    if (parsed.isPrimary !== undefined) record.isPrimary = parsed.isPrimary

    await flushOrConflict(em, 'customers.tax_identities.errors.duplicate')

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: taxIdentityCrudIndexer,
      events: taxIdentityCrudEvents,
    })

    return { taxIdentityId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadTaxIdentitySnapshot(em, result.taxIdentityId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as TaxIdentitySnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as TaxIdentitySnapshot | undefined
    const changes =
      afterSnapshot && before
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            afterSnapshot as unknown as Record<string, unknown>,
            ['countryCode', 'kind', 'value', 'validFrom', 'validTo', 'isPrimary'],
          )
        : {}
    return {
      actionLabel: translate('customers.audit.taxIdentities.update', 'Update tax identity'),
      resourceKind: 'customers.tax_identity',
      resourceId: before.id,
      parentResourceKind: resolveParentResourceKind(before.entityKind),
      parentResourceId: before.entityId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies TaxIdentityUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaxIdentityUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CustomerTaxIdentity, { id: before.id })
    if (!record) return
    record.countryCode = before.countryCode
    record.kind = before.kind as CustomerTaxIdentity['kind']
    record.value = before.value
    record.validFrom = before.validFrom
    record.validTo = before.validTo
    record.isPrimary = before.isPrimary
    record.deletedAt = before.deletedAt
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: taxIdentityCrudIndexer,
      events: taxIdentityCrudEvents,
    })
  },
}

const deleteTaxIdentityCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { taxIdentityId: string }
> = {
  id: 'customers.tax_identities.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Tax identity id required')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadTaxIdentitySnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Tax identity id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CustomerTaxIdentity, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Tax identity not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    if (!record.deletedAt) {
      record.deletedAt = new Date()
      await em.flush()
    }

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: taxIdentityCrudIndexer,
      events: taxIdentityCrudEvents,
    })

    return { taxIdentityId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TaxIdentitySnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('customers.audit.taxIdentities.delete', 'Delete tax identity'),
      resourceKind: 'customers.tax_identity',
      resourceId: before.id,
      parentResourceKind: resolveParentResourceKind(before.entityKind),
      parentResourceId: before.entityId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies TaxIdentityUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TaxIdentityUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CustomerTaxIdentity, { id: before.id })
    if (!record) return
    record.deletedAt = null
    record.countryCode = before.countryCode
    record.kind = before.kind as CustomerTaxIdentity['kind']
    record.value = before.value
    record.validFrom = before.validFrom
    record.validTo = before.validTo
    record.isPrimary = before.isPrimary
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: taxIdentityCrudIndexer,
      events: taxIdentityCrudEvents,
    })
  },
}

registerCommand(createTaxIdentityCommand)
registerCommand(updateTaxIdentityCommand)
registerCommand(deleteTaxIdentityCommand)
