import { useCallback, type MutableRefObject } from 'react'
import { saveProfiles, saveSettings as persistSettings } from '../../lib/store'
import { GAMES, getUtilities, type Profiles } from '../../lib/config'
import type { ThemeMode } from '../../lib/theme'
import { getSettingsObjectChangesDuringSave, type SettingsObjectVersions } from './saveRace'
import { normalizeLaunchDelayMs } from './settingsUtils'

// A dropped custom app name can itself be the too-long value being reported —
// cap the label so the toast stays readable instead of echoing 100+ chars.
const MAX_DROPPED_LABEL_LENGTH = 40

// Reason shown when the main-process sanitizer rejects an entry rather than
// persisting it. Driven by the reason the sanitizer actually rejected FOR —
// a legitimately-named .exe can be rejected purely for path length, and the
// warning must not misstate that as an extension problem. #669
function getDroppedEntryReason(entry: DroppedSettingsEntry): string {
  if (entry.reason === 'not-an-exe') {
    return 'must be an .exe path'
  }
  switch (entry.field) {
    case 'appNames':
      return 'name is too long'
    case 'appArgs':
      return 'arguments are too long'
    default:
      return 'path is too long'
  }
}

// Resolves a dropped entry's key to the label the user sees in the UI (game
// title, or app slot name/custom label) so the warning is legible instead of
// showing a raw internal key like "customapp3".
function getDroppedEntryLabel(
  entry: DroppedSettingsEntry,
  appNames: Record<string, string>,
  customSlots: number
): string {
  let label: string
  if (entry.field === 'gamePaths') {
    label = GAMES.find((game) => game.key === entry.key)?.name ?? entry.key
  } else {
    const utility = getUtilities(customSlots).find((candidate) => candidate.key === entry.key)
    label = appNames[entry.key] || utility?.name || entry.key
  }

  return label.length > MAX_DROPPED_LABEL_LENGTH
    ? `${label.slice(0, MAX_DROPPED_LABEL_LENGTH)}…`
    : label
}

function buildDroppedEntriesWarning(
  dropped: DroppedSettingsEntry[],
  appNames: Record<string, string>,
  customSlots: number
): string {
  const details = dropped
    .map(
      (entry) =>
        `${getDroppedEntryLabel(entry, appNames, customSlots)} (${getDroppedEntryReason(entry)})`
    )
    .join(', ')

  return `Not saved: ${details}`
}

interface SettingsStateSnapshot {
  appPaths: Record<string, string>
  appNames: Record<string, string>
  appArgs: Record<string, string>
  profiles: Profiles
  gamePaths: Record<string, string>
  customSlots: number
  accentPreset: string
  accentCustom: string
  accentBgTint: boolean
  themeMode: ThemeMode
  focusActiveTitle: boolean
  launchDelayMs: number
  startWithWindows: boolean
  startMinimized: boolean
  minimizeToTray: boolean
  showTrayIcon: boolean
  autoCheckUpdates: boolean
  zoomFactor: number
}

// Paths only need whitespace trimmed; an empty string is a valid sentinel
// meaning "not configured" and must be preserved so the store can clear it.
function trimPathRecord(paths: Record<string, string>) {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, value.trim()]))
}

// Args entries with a blank value after trimming are dropped entirely rather
// than stored as empty strings — avoids passing a bare "" to the launcher and
// keeps the persisted JSON clean.
function trimStringRecord(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value.length > 0)
  )
}

interface UseSettingsSaveArgs {
  appPaths: Record<string, string>
  appNames: Record<string, string>
  appArgs: Record<string, string>
  profiles: Profiles
  gamePaths: Record<string, string>
  customSlots: number
  accentPreset: string
  accentCustom: string
  accentBgTint: boolean
  themeMode: ThemeMode
  focusActiveTitle: boolean
  launchDelayMs: number
  startMinimized: boolean
  minimizeToTray: boolean
  showTrayIcon: boolean
  autoCheckUpdates: boolean
  startWithWindows: boolean
  zoomFactor: number
  currentSettingsState: SettingsStateSnapshot
  settingsObjectEditVersions: MutableRefObject<SettingsObjectVersions>
  notify: (message: string, type: 'success' | 'error' | 'warn', duration?: number) => void
  resetDirty: (state?: SettingsStateSnapshot) => void
  setAppPaths: (appPaths: Record<string, string>) => void
  setGamePaths: (gamePaths: Record<string, string>) => void
  setAppArgs: (appArgs: Record<string, string>) => void
  setLaunchDelayMs: (launchDelayMs: number) => void
}

export function useSettingsSave({
  appPaths,
  appNames,
  appArgs,
  profiles,
  gamePaths,
  customSlots,
  accentPreset,
  accentCustom,
  accentBgTint,
  themeMode,
  focusActiveTitle,
  launchDelayMs,
  startMinimized,
  minimizeToTray,
  showTrayIcon,
  autoCheckUpdates,
  startWithWindows,
  zoomFactor,
  currentSettingsState,
  settingsObjectEditVersions,
  notify,
  resetDirty,
  setAppPaths,
  setGamePaths,
  setAppArgs,
  setLaunchDelayMs
}: UseSettingsSaveArgs): { handleSave: () => Promise<boolean> } {
  const handleSave = useCallback(async (): Promise<boolean> => {
    try {
      const normalizedLaunchDelayMs = normalizeLaunchDelayMs(launchDelayMs)
      const trimmedAppPaths = trimPathRecord(appPaths)
      const trimmedGamePaths = trimPathRecord(gamePaths)
      const trimmedAppArgs = trimStringRecord(appArgs)
      // Snapshot versions before the await so we can detect edits that arrive
      // while the IPC write is in flight (the race window).
      const settingsObjectEditVersionsAtSave = { ...settingsObjectEditVersions.current }
      const savedSettingsObjects = {
        appPaths: trimmedAppPaths,
        appNames,
        appArgs: trimmedAppArgs,
        gamePaths: trimmedGamePaths
      }

      const [saveResult] = await Promise.all([
        persistSettings({
          appPaths: savedSettingsObjects.appPaths,
          appNames: savedSettingsObjects.appNames,
          appArgs: savedSettingsObjects.appArgs,
          gamePaths: savedSettingsObjects.gamePaths,
          customSlots,
          accentPreset,
          accentCustom,
          accentBgTint,
          themeMode,
          focusActiveTitle,
          launchDelayMs: normalizedLaunchDelayMs,
          startMinimized,
          minimizeToTray,
          showTrayIcon,
          autoCheckUpdates,
          startWithWindows,
          zoomFactor
        }),
        saveProfiles(profiles)
      ])
      const persistedSettings = saveResult.settings
      const changedDuringSave = getSettingsObjectChangesDuringSave(
        settingsObjectEditVersionsAtSave,
        settingsObjectEditVersions.current
      )

      // Only push the persisted value back into state when the user hasn't
      // edited the field since the save started — avoids overwriting a
      // concurrent edit with the (now-stale) pre-save copy. Using the
      // RETURNED persisted value (not the renderer's pre-save copy) means an
      // entry the sanitizer rejected is reflected as gone here too, instead
      // of lingering in the input as if it had been saved. #669
      if (!changedDuringSave.appPaths) setAppPaths(persistedSettings.appPaths)
      if (!changedDuringSave.gamePaths) setGamePaths(persistedSettings.gamePaths)
      if (!changedDuringSave.appArgs) setAppArgs(persistedSettings.appArgs)

      setLaunchDelayMs(persistedSettings.launchDelayMs)

      if (saveResult.dropped.length > 0) {
        notify(buildDroppedEntriesWarning(saveResult.dropped, appNames, customSlots), 'warn')
      } else {
        notify('Settings saved!', 'success', 2500)
      }

      // The new dirty baseline uses the PERSISTED settings, not the renderer's
      // pre-save copy: the baseline must reflect what is actually on disk, so
      // edits made while the save was awaiting stay visibly dirty (re-saveable)
      // instead of silently looking already-saved, and rejected entries never
      // silently re-baseline as if they had been saved.
      resetDirty({
        ...currentSettingsState,
        ...persistedSettings
      })
      return true
    } catch (err) {
      notify('Failed to save settings', 'error')
      console.error(err)
      return false
    }
  }, [
    appArgs,
    appNames,
    appPaths,
    accentBgTint,
    accentCustom,
    accentPreset,
    autoCheckUpdates,
    currentSettingsState,
    customSlots,
    focusActiveTitle,
    gamePaths,
    launchDelayMs,
    minimizeToTray,
    showTrayIcon,
    notify,
    profiles,
    resetDirty,
    startMinimized,
    startWithWindows,
    themeMode,
    zoomFactor,
    settingsObjectEditVersions,
    setAppPaths,
    setGamePaths,
    setAppArgs,
    setLaunchDelayMs
  ])

  return { handleSave }
}
