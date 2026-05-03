import {
  taxIdentityCreateSchema,
  taxIdentityUpdateSchema,
  validateTaxIdentityValue,
} from '../data/validators'

const validScope = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  entityId: '33333333-3333-4333-8333-333333333333',
}

describe('taxIdentityCreateSchema', () => {
  it('accepts a Polish NIP and normalizes the value', () => {
    const result = taxIdentityCreateSchema.safeParse({
      ...validScope,
      countryCode: 'pl',
      kind: 'nip',
      value: '526-025-09-95',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.value).toBe('5260250995')
      expect(result.data.countryCode).toBe('PL')
    }
  })

  it('accepts a German EU VAT number', () => {
    const result = taxIdentityCreateSchema.safeParse({
      ...validScope,
      countryCode: 'DE',
      kind: 'vat_eu',
      value: 'DE 123 456 789',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.value).toBe('DE123456789')
    }
  })

  it('rejects a NIP with an invalid checksum', () => {
    const result = taxIdentityCreateSchema.safeParse({
      ...validScope,
      countryCode: 'PL',
      kind: 'nip',
      value: '5260250996',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a vat_eu value missing a country prefix', () => {
    const result = taxIdentityCreateSchema.safeParse({
      ...validScope,
      countryCode: 'DE',
      kind: 'vat_eu',
      value: '123456789',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid country code', () => {
    const result = taxIdentityCreateSchema.safeParse({
      ...validScope,
      countryCode: '12',
      kind: 'nip',
      value: '5260250995',
    })
    expect(result.success).toBe(false)
  })
})

describe('taxIdentityUpdateSchema', () => {
  it('accepts a partial update without a value change', () => {
    const result = taxIdentityUpdateSchema.safeParse({
      organizationId: validScope.organizationId,
      tenantId: validScope.tenantId,
      id: '99999999-9999-4999-8999-999999999999',
      isPrimary: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a value change that fails checksum validation', () => {
    const result = taxIdentityUpdateSchema.safeParse({
      organizationId: validScope.organizationId,
      tenantId: validScope.tenantId,
      id: '99999999-9999-4999-8999-999999999999',
      kind: 'nip',
      countryCode: 'PL',
      value: '0000000000',
    })
    expect(result.success).toBe(false)
  })
})

describe('validateTaxIdentityValue', () => {
  it('returns the normalized value on success', () => {
    const result = validateTaxIdentityValue('nip', 'PL', '526-025-09-95')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('5260250995')
  })

  it('returns an error message key for invalid PESEL', () => {
    const result = validateTaxIdentityValue('pesel', 'PL', '00000000000')
    expect(result.ok).toBe(false)
  })

  it('uppercases values for the generic kinds', () => {
    const result = validateTaxIdentityValue('eori', 'PL', 'pl1234567890')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('PL1234567890')
  })
})
