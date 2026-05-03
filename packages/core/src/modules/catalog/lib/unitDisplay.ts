import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useCallback } from 'react'

/**
 * Hook for rendering unit-of-measure values in their localized short form.
 *
 * Translation keys live under `catalog.unit.{value}.short` (e.g.
 * `catalog.unit.pc.short` → "szt." in PL, "pc" in EN). Falls back to the
 * raw unit value when no translation exists.
 *
 * Usage in components:
 *
 * ```tsx
 * const formatUnit = useUnitDisplay()
 * <Text>{quantity} {formatUnit(line.unit)}</Text>
 * ```
 */
export function useUnitDisplay(): (unitValue: string | null | undefined) => string {
  const t = useT()
  return useCallback(
    (unitValue: string | null | undefined): string => {
      if (!unitValue) return ''
      return t(`catalog.unit.${unitValue}.short`, unitValue)
    },
    [t],
  )
}
