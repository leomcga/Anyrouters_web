import { createContext, useContext } from 'react'

export type SettingsPageContextValue = {
  actionsContainer: HTMLDivElement | null
  titleStatusContainer: HTMLSpanElement | null
  suppressSectionHeader: boolean
}

export const SettingsPageContext = createContext<SettingsPageContextValue>({
  actionsContainer: null,
  titleStatusContainer: null,
  suppressSectionHeader: false,
})

export function useSuppressSettingsSectionHeader() {
  return useContext(SettingsPageContext).suppressSectionHeader
}
