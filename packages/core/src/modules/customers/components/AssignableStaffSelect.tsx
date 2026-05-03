"use client"

import * as React from 'react'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  fetchAssignableStaffMembersPage,
  type AssignableStaffMember,
} from './detail/assignableStaff'

type AssignableStaffSelectProps = {
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
  placeholder?: string
  searchPlaceholder?: string
  loadingLabel?: string
  emptyLabel?: string
}

function memberToLookupItem(member: AssignableStaffMember): LookupSelectItem {
  const subtitleParts = [member.teamName, member.email].filter((part): part is string =>
    typeof part === 'string' && part.length > 0,
  )
  return {
    id: member.userId,
    title: member.displayName,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(' · ') : null,
  }
}

export function AssignableStaffSelect({
  value,
  onChange,
  disabled,
  placeholder,
  searchPlaceholder,
  loadingLabel,
  emptyLabel,
}: AssignableStaffSelectProps) {
  const t = useT()
  const fetchItems = React.useCallback(async (query: string): Promise<LookupSelectItem[]> => {
    const page = await fetchAssignableStaffMembersPage(query, { page: 1, pageSize: 24 })
    return page.items.map(memberToLookupItem)
  }, [])

  return (
    <LookupSelect
      value={value}
      onChange={onChange}
      fetchItems={fetchItems}
      disabled={disabled}
      placeholder={placeholder ?? t('sales.documents.form.salesOwner.placeholder', 'Assign sales owner')}
      searchPlaceholder={searchPlaceholder ?? t('sales.documents.form.salesOwner.search', 'Search staff…')}
      loadingLabel={loadingLabel ?? t('sales.documents.form.salesOwner.loading', 'Loading staff…')}
      emptyLabel={emptyLabel ?? t('sales.documents.form.salesOwner.empty', 'No staff members found.')}
    />
  )
}
