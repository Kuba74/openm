const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const
const REGON_9_WEIGHTS = [8, 9, 2, 3, 4, 5, 6, 7] as const
const REGON_14_WEIGHTS = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8] as const

const VAT_EU_FORMATS: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-Z0-9]{2}\d{9}$/,
  GR: /^\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^\d[A-Z0-9+*]\d{5}[A-Z](?:[A-Z]?)$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
}

export const SUPPORTED_VAT_EU_PREFIXES = Object.keys(VAT_EU_FORMATS)

export function stripDigits(input: string): string {
  return input.replace(/\D+/g, '')
}

export function normalizeUpper(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

export function isValidNip(input: string): boolean {
  const digits = stripDigits(input)
  if (digits.length !== 10) return false
  let sum = 0
  for (let index = 0; index < NIP_WEIGHTS.length; index += 1) {
    sum += NIP_WEIGHTS[index] * Number(digits.charAt(index))
  }
  const check = sum % 11
  if (check === 10) return false
  return check === Number(digits.charAt(9))
}

function computeRegon9Checksum(digits: string): number {
  let sum = 0
  for (let index = 0; index < REGON_9_WEIGHTS.length; index += 1) {
    sum += REGON_9_WEIGHTS[index] * Number(digits.charAt(index))
  }
  const value = sum % 11
  return value === 10 ? 0 : value
}

function computeRegon14Checksum(digits: string): number {
  let sum = 0
  for (let index = 0; index < REGON_14_WEIGHTS.length; index += 1) {
    sum += REGON_14_WEIGHTS[index] * Number(digits.charAt(index))
  }
  const value = sum % 11
  return value === 10 ? 0 : value
}

export function isValidRegon(input: string): boolean {
  const digits = stripDigits(input)
  if (digits.length === 9) {
    return computeRegon9Checksum(digits) === Number(digits.charAt(8))
  }
  if (digits.length === 14) {
    if (computeRegon9Checksum(digits.substring(0, 9)) !== Number(digits.charAt(8))) {
      return false
    }
    return computeRegon14Checksum(digits) === Number(digits.charAt(13))
  }
  return false
}

export function isValidKrs(input: string): boolean {
  const digits = stripDigits(input)
  return digits.length === 10
}

function isValidPeselDate(year: number, month: number, day: number): boolean {
  if (day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function isValidPesel(input: string): boolean {
  const digits = stripDigits(input)
  if (digits.length !== 11) return false
  const peselWeights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
  let sum = 0
  for (let index = 0; index < peselWeights.length; index += 1) {
    sum += peselWeights[index] * Number(digits.charAt(index))
  }
  const checksum = (10 - (sum % 10)) % 10
  if (checksum !== Number(digits.charAt(10))) return false
  const yy = Number(digits.substring(0, 2))
  const mm = Number(digits.substring(2, 4))
  const dd = Number(digits.substring(4, 6))
  let year = 1900 + yy
  let month = mm
  if (mm >= 81 && mm <= 92) {
    year = 1800 + yy
    month = mm - 80
  } else if (mm >= 1 && mm <= 12) {
    year = 1900 + yy
  } else if (mm >= 21 && mm <= 32) {
    year = 2000 + yy
    month = mm - 20
  } else if (mm >= 41 && mm <= 52) {
    year = 2100 + yy
    month = mm - 40
  } else if (mm >= 61 && mm <= 72) {
    year = 2200 + yy
    month = mm - 60
  } else {
    return false
  }
  return isValidPeselDate(year, month, dd)
}

export function isValidEuVat(input: string): boolean {
  const normalized = normalizeUpper(input)
  if (normalized.length < 3) return false
  const prefix = normalized.substring(0, 2)
  const body = normalized.substring(2)
  const pattern = VAT_EU_FORMATS[prefix]
  if (!pattern) return false
  return pattern.test(body)
}

export function normalizeNipForStorage(input: string): string {
  return stripDigits(input)
}

export function normalizeRegonForStorage(input: string): string {
  return stripDigits(input)
}

export function normalizeKrsForStorage(input: string): string {
  return stripDigits(input)
}

export function normalizePeselForStorage(input: string): string {
  return stripDigits(input)
}

export function normalizeVatEuForStorage(input: string): string {
  return normalizeUpper(input)
}

export function formatNipForDisplay(value: string): string {
  const digits = stripDigits(value)
  if (digits.length !== 10) return value
  return `${digits.substring(0, 3)}-${digits.substring(3, 6)}-${digits.substring(6, 8)}-${digits.substring(8, 10)}`
}
