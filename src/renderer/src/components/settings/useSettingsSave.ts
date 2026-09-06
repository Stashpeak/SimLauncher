import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { saveProfiles, saveSettings as persistSettings } from '../../lib/store'
import { GAMES, getUtilities, type Profiles } from '../../lib/config'
import type { ThemeMode } from '../../lib/theme'
import { fetchAppIcons } from './appIcons'
import {
  getSettingsObjectChangesDuringSave,
  type SettingsObjectRecords,
  type SettingsObjectVersions
} from './saveRace'
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
  gracefulCloseEnabled: boolean
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

/**
 * Refetches the icons of the app paths a save just wrote (#898).
 *
 * A path pasted or typed into a slot cannot have its icon fetched while it is
 * being entered: `get-file-icon` only answers for paths already in the store or
 * just picked through Browse, which is how Browse shows an icon immediately and
 * typing never did. The save is the moment the path becomes fetchable, and
 * nothing else asks afterwards, because the store-changed reload skips this
 * provider's own save on purpose (#480). So the icon corrected itself only once
 * some other write reloaded Settings, typically enabling the slot in a profile.
 *
 * Same rule as the Browse branch: an icon replaces the previous one, no icon
 * drops it rather than leaving the old executable's picture on a new path
 * (#428). Functional updates, because a Browse that lands while the fetch is in
 * flight puts an icon in state this call never saw, and a value write would
 * discard it. Cosmetic, so a failure here logs and must not turn a saved
 * settings into a failed one.
 *
 * A result belongs to the path it was fetched for. A slot the user retyped or
 * Browsed while the fetch was in flight has moved on: the save-race guard keeps
 * that draft, Browse has already set that slot's icon, and an answer for the
 * path just written would overwrite it whenever the fetch settles second. So
 * each result is applied only while the slot still shows the path it was
 * fetched for, read from the synchronous mirror of the latest edits rather than
 * from the state this call closed over (Codex on #936).
 */
async function refreshAppIcons(
  persistedAppPaths: Record<string, string>,
  latestAppPaths: () => Record<string, string>,
  previousIcons: Record<string, string>,
  setAppIcons: Dispatch<SetStateAction<Record<string, string>>>,
  setIconLoadErrors: Dispatch<SetStateAction<Set<string>>>
): Promise<void> {
  let fetched: Record<string, string | null>
  try {
    fetched = await fetchAppIcons(persistedAppPaths)
  } catch (err) {
    console.error('Failed to refresh app icons after save:', err)
    return
  }
  const current = latestAppPaths()
  const keys = Object.keys(fetched).filter(
    (key) => (current[key] ?? '').trim() === persistedAppPaths[key]
  )
  if (keys.length === 0) return

  setAppIcons((current) => {
    const next = { ...current }
    for (const key of keys) {
      const icon = fetched[key]
      if (icon) {
        next[key] = icon
      } else {
        delete next[key]
      }
    }
    return next
  })

  // A decode failure belongs to the image that failed: stale once the image
  // changes, still true while it does not, and never this save's business for
  // a bundled icon it did not fetch.
  const changed = keys.filter((key) => (fetched[key] ?? undefined) !== previousIcons[key])
  if (changed.length === 0) return
  setIconLoadErrors((current) => {
    if (!changed.some((key) => current.has(key))) return current
    const next = new Set(current)
    changed.forEach((key) => next.delete(key))
    return next
  })
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
  gracefulCloseEnabled: boolean
  autoCheckUpdates: boolean
  startWithWindows: boolean
  zoomFactor: number
  currentSettingsState: SettingsStateSnapshot
  settingsObjectEditVersions: MutableRefObject<SettingsObjectVersions>
  notify: (message: string, type: 'success' | 'error' | 'warn', duration?: number) => void
  resetDirty: (state?: SettingsStateSnapshot) => void
  setAppPaths: (appPaths: Record<string, string>) => void
  setAppNames: (appNames: Record<string, string>) => void
  setGamePaths: (gamePaths: Record<string, string>) => void
  setAppArgs: (appArgs: Record<string, string>) => void
  setLaunchDelayMs: (launchDelayMs: number) => void
  appIcons: Record<string, string>
  setAppIcons: Dispatch<SetStateAction<Record<string, string>>>
  setIconLoadErrors: Dispatch<SetStateAction<Set<string>>>
  latestSettingsObjects: MutableRefObject<SettingsObjectRecords>
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
  gracefulCloseEnabled,
  autoCheckUpdates,
  startWithWindows,
  zoomFactor,
  currentSettingsState,
  settingsObjectEditVersions,
  notify,
  resetDirty,
  setAppPaths,
  setAppNames,
  setGamePaths,
  setAppArgs,
  setLaunchDelayMs,
  appIcons,
  setAppIcons,
  setIconLoadErrors,
  latestSettingsObjects
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
          gracefulCloseEnabled,
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
      // appNames was the one tracked dictionary with no write-back (#711). Its
      // absence did not just leave a rejected value on screen: the baseline
      // below IS built from persistedSettings, so live state kept a key the
      // baseline lacked and useDirtyTracking re-derived isDirty back to true
      // immediately after resetDirty cleared it. The panel then stayed dirty
      // for the rest of the session, through every later save.
      if (!changedDuringSave.appNames) setAppNames(persistedSettings.appNames)
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

      // After the baseline and the toast: the icons are a picture of what was
      // just written, not part of whether the write happened (#898).
      //
      // Not behind `changedDuringSave.appPaths` like the write-backs above,
      // because that guard is per field and a retyped slot must not cost the
      // untouched slots their icons. The per-slot version of the same guard
      // lives inside: a result is applied only while the slot still shows the
      // path it was fetched for (review bot and Codex on #936).
      await refreshAppIcons(
        persistedSettings.appPaths,
        () => latestSettingsObjects.current.appPaths,
        appIcons,
        setAppIcons,
        setIconLoadErrors
      )
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
    gracefulCloseEnabled,
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
    setAppNames,
    setGamePaths,
    setAppArgs,
    setLaunchDelayMs,
    appIcons,
    setAppIcons,
    setIconLoadErrors,
    latestSettingsObjects
  ])

  return { handleSave }
}
