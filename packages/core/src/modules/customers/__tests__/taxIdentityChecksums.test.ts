import {
  isValidEuVat,
  isValidKrs,
  isValidNip,
  isValidPesel,
  isValidRegon,
  formatNipForDisplay,
  normalizeVatEuForStorage,
} from '../data/taxIdentityChecksums'

describe('isValidNip', () => {
  it('accepts a known valid NIP with checksum 5', () => {
    expect(isValidNip('5260250995')).toBe(true)
  })

  it('accepts a NIP formatted with dashes', () => {
    expect(isValidNip('526-025-09-95')).toBe(true)
  })

  it('rejects a NIP with the wrong checksum', () => {
    expect(isValidNip('5260250996')).toBe(false)
  })

  it('rejects a NIP shorter than ten digits', () => {
    expect(isValidNip('123456789')).toBe(false)
  })

  it('rejects a NIP whose modulo is ten', () => {
    expect(isValidNip('1111111111')).toBe(false)
  })

  it('rejects non-digit characters that cannot be stripped to ten digits', () => {
    expect(isValidNip('abcdefghij')).toBe(false)
  })
})

describe('isValidRegon', () => {
  it('accepts a valid 9-digit REGON', () => {
    expect(isValidRegon('123456785')).toBe(true)
  })

  it('rejects a 9-digit REGON with the wrong checksum', () => {
    expect(isValidRegon('123456784')).toBe(false)
  })

  it('rejects an 8-digit number', () => {
    expect(isValidRegon('12345678')).toBe(false)
  })

  it('rejects a 14-digit REGON whose 9-digit prefix has a bad checksum', () => {
    expect(isValidRegon('12345678412345')).toBe(false)
  })

  it('rejects a 14-digit REGON whose tail checksum does not match', () => {
    expect(isValidRegon('12345678500001')).toBe(false)
  })

  it('accepts a 14-digit REGON whose 9-prefix and tail checksum both match', () => {
    expect(isValidRegon('12345678500002')).toBe(true)
  })
})

describe('isValidKrs', () => {
  it('accepts any ten-digit KRS', () => {
    expect(isValidKrs('0000123456')).toBe(true)
  })

  it('rejects a KRS shorter than ten digits', () => {
    expect(isValidKrs('123456')).toBe(false)
  })

  it('rejects a KRS longer than ten digits when ignoring formatting', () => {
    expect(isValidKrs('00001234567')).toBe(false)
  })
})

describe('isValidPesel', () => {
  it('accepts a known valid PESEL', () => {
    expect(isValidPesel('44051401359')).toBe(true)
  })

  it('rejects a PESEL with the wrong checksum', () => {
    expect(isValidPesel('44051401358')).toBe(false)
  })

  it('rejects a PESEL with an impossible date component', () => {
    expect(isValidPesel('44023001359')).toBe(false)
  })

  it('rejects a PESEL shorter than 11 digits', () => {
    expect(isValidPesel('1234567890')).toBe(false)
  })
})

describe('isValidEuVat', () => {
  it('accepts a Polish VAT number with the PL prefix', () => {
    expect(isValidEuVat('PL5260250995')).toBe(true)
  })

  it('accepts a German VAT number with the DE prefix', () => {
    expect(isValidEuVat('DE123456789')).toBe(true)
  })

  it('rejects a VAT number missing the country prefix', () => {
    expect(isValidEuVat('5260250995')).toBe(false)
  })

  it('rejects a VAT number whose body length is wrong', () => {
    expect(isValidEuVat('DE12345')).toBe(false)
  })

  it('rejects a VAT number with an unsupported prefix', () => {
    expect(isValidEuVat('US5260250995')).toBe(false)
  })

  it('normalizes spaces and casing during validation', () => {
    expect(isValidEuVat('de 123 456 789')).toBe(true)
  })
})

describe('normalization helpers', () => {
  it('formats a NIP for display with dashes when ten digits are present', () => {
    expect(formatNipForDisplay('5260250995')).toBe('526-025-09-95')
  })

  it('returns the input unchanged when fewer than ten digits are present', () => {
    expect(formatNipForDisplay('1234')).toBe('1234')
  })

  it('uppercases and removes spaces from EU VAT input', () => {
    expect(normalizeVatEuForStorage('de 123 456 789')).toBe('DE123456789')
  })
})
