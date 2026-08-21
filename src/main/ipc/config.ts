import { app, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import crypto from 'crypto'
import fs from 'fs'

import { getHighestReferencedCustomSlot } from '../../shared/domain/slots'
import { migrateProfilesToNamedSets } from '../migrator'
import {
  getProfileLaunchEntryId,
  getProfileSwitchLeavingEntries,
  isStoredProfileSet
} from '../profiles'
import {
  CONFIG_FILE_NAME,
  KNOWN_GAME_KEYS,
  LOCAL_ONLY_STORE_KEYS,
  MAX_CONFIG_IMPORT_BYTES,
  MAX_CUSTOM_SLOTS,
  consumeConfigRecoveryNotice,
  formatConfigRecoveryNotice,
  getDroppedSettingsEntries,
  getSupportedConfigValues,
  getStoredBoolean,
  getStoredZoomFactor,
  requireSafeZoomFactor,
  sanitizeImportedConfig,
  sanitizeSettingsPatch,
  store
} from '../store'
import { isRecord } from '../utils'
import {
  abortActiveLaunches,
  cancelPendingElevatedHandoffs,
  drainStrandedConsentPrompts,
  publishRunningApps
} from '../processes'
import { applyTrayVisibility } from '../tray'
import { applyRuntimeConfigSettings, getMainWindow, sendToRenderer } from '../window'

// Channel name is a contract shared with preload/index.ts. Renaming either
// side without updating the other silently breaks store-change notifications.
const STORE_CONFIG_CHANGED_CHANNEL = 'store-config-changed'
const STRANDED_CONSENT_PROMPTS_CHANNEL = 'stranded-consent-prompts'
// 24 bytes → 32-character base64url token, which is unguessable for a
// single-session nonce and fits comfortably in an IPC argument.
const IMPORT_PREVIEW_TOKEN_BYTES = 24
// 5-minute window gives the user time to review the diff UI before confirming;
// after expiry the sanitised config is discarded and re-reading from disk is
// required, preventing stale or swapped files from being silently applied.
const IMPORT_PREVIEW_TTL_MS = 5 * 60 * 1000

interface ConfigImportPreviewEntry {
  key: string
  path?: string
  args?: string
}

interface ConfigImportPreviewSummary {
  changedKeys: string[]
  gamePaths: ConfigImportPreviewEntry[]
  appPaths: ConfigImportPreviewEntry[]
  trackedProcessPaths: ConfigImportPreviewEntry[]
  customAppArgs: ConfigImportPreviewEntry[]
  droppedCount: number
  warnings: string[]
}

// Module-level singleton: only one import can be in-flight at a time.
// Starting a new preview (preview-import-config) always clears any previous
// pending entry first, so concurrent preview requests don't leave orphaned
// tokens that could be applied by a racing apply-import-config call.
let pendingImport: {
  token: string
  filePath: string
  config: Record<string, unknown>
  expiresAt: number
} | null = null

type StoreConfigChangeReason =
  'import-config' | 'save-settings' | 'save-profile' | 'save-profiles' | 'set-migration-flags'

interface StoreConfigChangePayload {
  reason: StoreConfigChangeReason
  keys: string[]
}

function notifyStoreConfigChanged(payload: StoreConfigChangePayload) {
  sendToRenderer(STORE_CONFIG_CHANGED_CHANNEL, payload)
}

/**
 * Tells the user about consent prompts left on screen by elevated handoffs a
 * config change cancelled (#809).
 *
 * PUSHED, not returned, and this is the one place in the codebase where that
 * distinction is load-bearing. The kill results hand their count back to the
 * caller because the caller ASKED to close things and is therefore certain to
 * read the answer. Nobody asks a config write to cancel anything: it is a side
 * effect of the active profile changing, so returning the count means every
 * caller has to know a contract it has no reason to suspect. Four exist for
 * `save-profile` alone (the row dropdown, the editor's save, its delete, its
 * discard-pending restore) and an earlier version returned the count to all four
 * while only the dropdown read it. Because the drain is destructive, the three
 * that ignored it did not merely stay quiet, they consumed the count and
 * destroyed it, leaving the user with a dead consent dialog and no explanation
 * anywhere (Codex P2 on #782). A push cannot be dropped by forgetting to read
 * it, and the sentence is written to stand on its own, so it needs no host toast
 * to be understood.
 */
function reportStrandedConsentPrompts(count: number): void {
  if (count > 0) {
    sendToRenderer(STRANDED_CONSENT_PROMPTS_CHANNEL, count)
  }
}

function clearPendingImport() {
  pendingImport = null
}

function countImportedPreviewItems(config: Record<string, unknown>) {
  let count = 0
  const countRecordItems = (value: unknown) => {
    if (isRecord(value)) count += Object.keys(value).length
  }

  countRecordItems(config.gamePaths)
  countRecordItems(config.appPaths)
  countRecordItems(config.appArgs)

  if (isRecord(config.profiles)) {
    Object.values(config.profiles).forEach((profileEntry) => {
      if (!isRecord(profileEntry)) return

      if (Array.isArray(profileEntry.trackedProcessPaths)) {
        count += profileEntry.trackedProcessPaths.length
      }

      if (Array.isArray(profileEntry.profiles)) {
        profileEntry.profiles.forEach((profile) => {
          if (isRecord(profile) && Array.isArray(profile.trackedProcessPaths)) {
            count += profile.trackedProcessPaths.length
          }
        })
      }
    })
  }

  return count
}

function collectTrackedProcessPathPreviews(profiles: unknown): ConfigImportPreviewEntry[] {
  if (!isRecord(profiles)) return []

  const entries: ConfigImportPreviewEntry[] = []
  Object.entries(profiles).forEach(([gameKey, profileEntry]) => {
    if (!isRecord(profileEntry)) return

    const addPaths = (paths: unknown, suffix = '') => {
      if (!Array.isArray(paths)) return
      paths.forEach((path) => {
        if (typeof path === 'string') entries.push({ key: `${gameKey}${suffix}`, path })
      })
    }

    addPaths(profileEntry.trackedProcessPaths)

    if (Array.isArray(profileEntry.profiles)) {
      profileEntry.profiles.forEach((profile) => {
        if (!isRecord(profile)) return
        const profileName = typeof profile.name === 'string' ? `/${profile.name}` : ''
        addPaths(profile.trackedProcessPaths, profileName)
      })
    }
  })

  return entries
}

export function buildImportPreviewSummary(
  rawConfig: Record<string, unknown>,
  supportedConfig: Record<string, unknown>
): ConfigImportPreviewSummary {
  const gamePaths = isRecord(supportedConfig.gamePaths)
    ? Object.entries(supportedConfig.gamePaths).flatMap(([key, path]) =>
        typeof path === 'string' ? [{ key, path }] : []
      )
    : []
  const appPaths = isRecord(supportedConfig.appPaths)
    ? Object.entries(supportedConfig.appPaths).flatMap(([key, path]) =>
        typeof path === 'string' ? [{ key, path }] : []
      )
    : []
  const customAppArgs = isRecord(supportedConfig.appArgs)
    ? Object.entries(supportedConfig.appArgs).flatMap(([key, args]) =>
        typeof args === 'string' ? [{ key, args }] : []
      )
    : []
  const trackedProcessPaths = collectTrackedProcessPathPreviews(supportedConfig.profiles)
  const previewItemCount =
    gamePaths.length + appPaths.length + customAppArgs.length + trackedProcessPaths.length
  const droppedCount = Math.max(0, countImportedPreviewItems(rawConfig) - previewItemCount)
  const warnings =
    droppedCount > 0
      ? [`${droppedCount} unsupported or invalid path/argument entries were dropped.`]
      : []

  return {
    changedKeys: Object.keys(supportedConfig).sort(),
    gamePaths,
    appPaths,
    trackedProcessPaths,
    customAppArgs,
    droppedCount,
    warnings
  }
}

async function readAndSanitizeConfig(filePath: string) {
  const stat = await fs.promises.stat(filePath)

  if (stat.size > MAX_CONFIG_IMPORT_BYTES) {
    throw new Error('Config file exceeds the 1 MB size limit.')
  }

  const rawConfig = await fs.promises.readFile(filePath, 'utf8')
  const parsedConfig: unknown = JSON.parse(rawConfig)
  if (!isRecord(parsedConfig)) {
    throw new Error('Config file must contain a JSON object.')
  }
  const supportedConfig = sanitizeImportedConfig(parsedConfig)
  const summary = buildImportPreviewSummary(parsedConfig, supportedConfig)

  return { supportedConfig, summary }
}

/**
 * Atomically replaces the entire store with `supportedConfig`. On failure the
 * pre-import snapshot is restored so the app is never left in a half-written
 * state. Runtime settings (zoom, tray) are re-applied in both branches so the
 * window and tray remain consistent with whatever store state ends up active.
 *
 * The wildcard `keys: ['*']` signals the renderer to treat all settings as
 * potentially dirty rather than surgically diffing individual keys.
 */
function applySanitizedConfig(supportedConfig: Record<string, unknown>) {
  const snapshot = { ...store.store }

  try {
    store.clear()
    setStoreEntries(supportedConfig)
    // Import replaces the whole store; carry local-only UX flags (e.g.
    // onboardingSeen) over from the snapshot so they don't reset on import. #641
    for (const key of LOCAL_ONLY_STORE_KEYS) {
      if (key in snapshot) store.set(key, snapshot[key])
    }
    migrateProfilesToNamedSets()
    applyRuntimeConfigSettings()
    applyTrayVisibility(store.get('showTrayIcon') !== false)
    // An import is the user replacing their configuration wholesale, so any
    // pending elevated handoff is now waiting on a profile that may not exist
    // any more. Approving its prompt afterwards would start a companion from
    // the config they just replaced (Codex P2 on #842).
    //
    // Cancels ALL of them rather than diffing, and that is a different rule from
    // `save-profile` on purpose. There the outgoing and incoming profiles are
    // two known sets, so a leaving diff is well defined; here every game's
    // profiles changed at once and there is no "the profile being left". Same
    // reasoning that keeps `killLaunchedApps` game-wide for "close everything".
    // The cost of over-cancelling is a prompt the user must re-trigger; the cost
    // of under-cancelling is an app from a config that no longer exists.
    //
    // Deliberately AFTER the writes and the migrate: anything above throwing
    // restores the old config, and cancelling a prompt that is still valid for
    // the restored config would be the worse mistake.
    //
    // Both mechanisms, for the same reason the switch needs both: a handoff
    // younger than the grace window is not in the registry yet, so the abort
    // signal is the only thing that reaches it. Unscoped here, unlike the
    // switch's per-game abort, because an import replaces every game's config at
    // once (CodeRabbit on #842).
    abortActiveLaunches()
    cancelPendingElevatedHandoffs()
    reportStrandedConsentPrompts(drainStrandedConsentPrompts())
    notifyStoreConfigChanged({ reason: 'import-config', keys: ['*'] })
    // An import replaces every profile, so it can turn tracking on or off for
    // any of them (#591). Both branches publish, because a rollback restores a
    // different set of profiles than the one that was briefly live.
    publishRunningApps('config').catch((err) => {
      console.error('Failed to publish running apps after a profile change:', err)
    })
  } catch (err) {
    store.clear()
    setStoreEntries(snapshot)
    applyRuntimeConfigSettings()
    applyTrayVisibility(store.get('showTrayIcon') !== false)
    publishRunningApps('config').catch((err) => {
      console.error('Failed to publish running apps after a profile change:', err)
    })
    throw err
  }
}

// Shared by 'get-settings' and 'save-settings' so the latter can hand the
// renderer the actual on-disk truth to re-baseline from, rather than the
// renderer's own (possibly-rejected) copy of what it tried to save. #669
function getPersistedSettings() {
  return {
    appPaths: store.get('appPaths'),
    gamePaths: store.get('gamePaths'),
    appNames: store.get('appNames'),
    appArgs: store.get('appArgs'),
    customSlots: store.get('customSlots'),
    accentPreset: store.get('accentPreset'),
    accentCustom: store.get('accentCustom'),
    accentBgTint: store.get('accentBgTint'),
    themeMode: store.get('themeMode'),
    focusActiveTitle: store.get('focusActiveTitle'),
    launchDelayMs: store.get('launchDelayMs'),
    startWithWindows: store.get('startWithWindows'),
    startMinimized: store.get('startMinimized'),
    minimizeToTray: store.get('minimizeToTray'),
    showTrayIcon: store.get('showTrayIcon'),
    autoCheckUpdates: store.get('autoCheckUpdates'),
    gracefulCloseEnabled: store.get('gracefulCloseEnabled'),
    zoomFactor: getStoredZoomFactor()
  }
}

function setStoreEntries(values: Record<string, unknown>) {
  Object.entries(values).forEach(([key, value]) => {
    store.set(key, value)
  })
}

function getSanitizedProfileSet(gameKey: string, profileSet: unknown) {
  if (!KNOWN_GAME_KEYS.has(gameKey) || !isStoredProfileSet(profileSet)) {
    return undefined
  }

  const storedCustomSlots = store.get('customSlots')
  const baseSlots =
    typeof storedCustomSlots === 'number' && Number.isFinite(storedCustomSlots)
      ? storedCustomSlots
      : 1
  // Widen the allowed slot count so a profile saved in parallel with a
  // customSlots increase isn't silently stripped before save-settings lands.
  // For example, if the renderer increments customSlots and saves the profile
  // in the same batch, the profile IPC arrives before save-settings; without
  // this expansion the new slot IDs would be filtered out as out-of-range.
  const effectiveCustomSlots = Math.min(
    MAX_CUSTOM_SLOTS,
    Math.max(baseSlots, getHighestReferencedCustomSlot(profileSet))
  )

  const supportedConfig = getSupportedConfigValues({
    customSlots: effectiveCustomSlots,
    profiles: { [gameKey]: profileSet }
  })
  const profiles = supportedConfig.profiles

  if (!isRecord(profiles)) {
    return undefined
  }

  const sanitizedProfileSet = profiles[gameKey]
  return isStoredProfileSet(sanitizedProfileSet) ? sanitizedProfileSet : undefined
}

function getSanitizedProfileRecord(profiles: unknown) {
  if (!isRecord(profiles)) {
    return undefined
  }

  const safeProfiles: Record<string, unknown> = {}

  Object.entries(profiles).forEach(([gameKey, profileSet]) => {
    const sanitizedProfileSet = getSanitizedProfileSet(gameKey, profileSet)

    if (sanitizedProfileSet) {
      safeProfiles[gameKey] = sanitizedProfileSet
    }
  })

  return Object.keys(safeProfiles).length > 0 ? safeProfiles : undefined
}

export function registerConfigHandlers(): void {
  // export-config: writes only the sanitised subset of the store (via
  // getSupportedConfigValues) so internal migration flags and transient keys
  // are never leaked into exported files.
  ipcMain.handle('export-config', async () => {
    try {
      const options = {
        title: 'Export SimLauncher Config',
        defaultPath: CONFIG_FILE_NAME,
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      }
      const mainWindow = getMainWindow()
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true }
      }

      await fs.promises.writeFile(
        result.filePath,
        JSON.stringify(getSupportedConfigValues(store.store), null, 2),
        'utf8'
      )
      return { success: true, filePath: result.filePath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to export config:', err)
      return { success: false, error: message }
    }
  })

  // preview-import-config → apply-import-config two-step:
  // The preview step sanitises the file and stores a short-lived token so the
  // apply step can verify it is confirming the exact config the user reviewed
  // (not a different file that was swapped in on disk between the two calls).
  // cancel-import-config lets the renderer explicitly discard the pending entry
  // rather than waiting for the TTL, e.g. when the user closes the diff dialog.
  ipcMain.handle('preview-import-config', async () => {
    try {
      clearPendingImport()
      const options: OpenDialogOptions = {
        title: 'Import SimLauncher Config',
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      }
      const mainWindow = getMainWindow()
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      const filePath = result.filePaths[0]
      const { supportedConfig, summary } = await readAndSanitizeConfig(filePath)
      const token = crypto.randomBytes(IMPORT_PREVIEW_TOKEN_BYTES).toString('base64url')
      pendingImport = {
        token,
        filePath,
        config: supportedConfig,
        expiresAt: Date.now() + IMPORT_PREVIEW_TTL_MS
      }

      return { success: true, token, filePath, summary }
    } catch (err) {
      clearPendingImport()
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to preview config import:', err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('apply-import-config', async (_event, token: unknown) => {
    try {
      if (typeof token !== 'string' || !pendingImport || pendingImport.token !== token) {
        return { success: false, error: 'Import preview expired or is no longer valid.' }
      }

      if (Date.now() > pendingImport.expiresAt) {
        clearPendingImport()
        return { success: false, error: 'Import preview expired. Please choose the config again.' }
      }

      const { filePath, config } = pendingImport
      clearPendingImport()
      applySanitizedConfig(config)

      return { success: true, filePath }
    } catch (err) {
      clearPendingImport()
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to apply config import:', err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('cancel-import-config', async (_event, token: unknown) => {
    if (typeof token === 'string' && pendingImport?.token === token) {
      clearPendingImport()
    }

    return { success: true }
  })

  ipcMain.handle('get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('get-startup-notice', () => {
    const notice = consumeConfigRecoveryNotice()
    return notice ? formatConfigRecoveryNotice(notice) : null
  })

  ipcMain.handle('set-zoom', (_event, factor: unknown) => {
    const zoomFactor = requireSafeZoomFactor(factor)
    const webContents = getMainWindow()?.webContents
    if (!webContents) return
    // Skip same-value calls: re-setting the current zoom on a still-hidden
    // window suppresses 'ready-to-show' on Electron 42 (#382), and the
    // renderer's boot-time set-zoom is always same-value (both sides read the
    // same store).
    if (Math.abs(webContents.getZoomFactor() - zoomFactor) < 0.001) return
    webContents.setZoomFactor(zoomFactor)
  })

  ipcMain.handle('get-settings', () => {
    return getPersistedSettings()
  })

  ipcMain.handle('save-settings', (_event, patch: unknown) => {
    if (!isRecord(patch)) return { settings: getPersistedSettings(), dropped: [] }

    const safe = sanitizeSettingsPatch(patch)
    const dropped = getDroppedSettingsEntries(patch)
    const changedKeys = Object.keys(safe)
    if (changedKeys.length > 0) {
      setStoreEntries(safe)
      if (changedKeys.includes('showTrayIcon')) {
        applyTrayVisibility(store.get('showTrayIcon') !== false)
      }
      // Applied on SAVE, not on toggle (#676). The renderer used to write this
      // straight to the OS when the switch moved, so a Discard left an HKCU Run
      // entry behind that contradicted both the UI and the store until the next
      // app start re-applied it (window.ts). Read back through getStoredBoolean
      // rather than trusting the patch, so this is the same spelling as the two
      // startup call sites and cannot drift from what was actually persisted.
      //
      // The OS write must not be able to fail the save. The store is the source
      // of truth and window.ts re-applies it from there on every window
      // creation, so a failed write converges on the next app start; that repair
      // path is exactly why this bug was one unexpected boot rather than a
      // permanent one. Letting it reject instead would report "failed to save"
      // for a patch that did persist, and leave the renderer dirty against a
      // store that already agrees with it (CodeRabbit on #831).
      if (changedKeys.includes('startWithWindows')) {
        try {
          app.setLoginItemSettings({ openAtLogin: getStoredBoolean('startWithWindows') })
        } catch (err) {
          console.error('Failed to apply the login item setting:', err)
        }
      }
      notifyStoreConfigChanged({ reason: 'save-settings', keys: changedKeys })
    }

    // The renderer re-baselines from `settings` (the actual on-disk truth)
    // rather than its own pre-save copy, so entries the sanitizer rejected
    // above are never silently re-shown as saved. #669
    return { settings: getPersistedSettings(), dropped }
  })

  ipcMain.handle('get-profiles', () => {
    return store.get('profiles')
  })

  ipcMain.handle('save-profile', (_event, gameKey: unknown, profileSet: unknown) => {
    if (typeof gameKey !== 'string' || !gameKey) return
    const sanitizedProfileSet = getSanitizedProfileSet(gameKey, profileSet)
    if (!sanitizedProfileSet) return
    // Computed BEFORE the write, because the outgoing side only exists on disk
    // until the next line replaces it.
    const leavingEntries = getProfileSwitchLeavingEntries(gameKey, sanitizedProfileSet)
    const storedProfiles = store.get('profiles')
    const profiles = isRecord(storedProfiles) ? storedProfiles : {}
    profiles[gameKey] = sanitizedProfileSet
    store.set('profiles', profiles)
    // A pending UAC handoff has never started, so it is in no tasklist snapshot,
    // so `switch-profile-apps` can never see it: it decides what to stop from
    // exactly such a snapshot and only calls the kill path when that set is
    // non-empty. Worse, the renderer often does not reach that handler at all,
    // because it gates the whole IPC on a diff the handoff contributes zero to
    // (GameRow) and falls through to this save instead. Approving the old prompt
    // afterwards then starts a companion belonging to a profile the user has
    // already left (#782).
    //
    // Here rather than in the switch handler because THIS is the call the
    // renderer cannot skip: every switch saves, whether or not it stops
    // anything. Scoped to the leaving paths, so a plain profile edit (same
    // `activeProfileId`) cancels nothing, and a switch never touches a prompt
    // for an app the incoming profile also enables.
    let strandedConsentPrompts = 0
    if (leavingEntries.length > 0) {
      // A pending handoff is reachable through TWO different mechanisms
      // depending on its age, and this switch has to use both.
      //
      // Before the grace window expires the handoff is not in the registry at
      // all: `spawn.ts` only registers it when the timer fires, so until then
      // the abort signal is the only handle on it. That is the whole first ten
      // seconds of an unanswered prompt, and it is reachable because the row
      // only blocks switching when `isRunning && isLaunchBlocked` and an app
      // parked on a UAC prompt has started nothing, so `isRunning` is false
      // (Codex P1 on #842).
      //
      // `killProfileApps` already aborts on the way in, which is why the switch
      // was covered whenever it stopped something. This save is exactly the path
      // that skips the kill: a handoff contributes nothing to the tasklist diff
      // the renderer gates that IPC on. Without this line the save was doing
      // half of what the kill does, and the surviving half of #782 was simply
      // the faster user.
      //
      // Whole-game rather than per-entry, matching `killProfileApps`: the
      // sequence in flight belongs to the profile being left, and the user has
      // left it.
      abortActiveLaunches(gameKey)
      // And the post-grace half, from the registry. Matched by SLOT, not by
      // path. Two slots can point at one exe (#357), so a path match here would
      // cancel the retained slot's prompt alongside the leaving one, which is
      // the same over-cancel this fix exists to remove (CodeRabbit on #782).
      const leavingIds = new Set(leavingEntries.map(getProfileLaunchEntryId))
      cancelPendingElevatedHandoffs(gameKey, (handoff) =>
        leavingIds.has(
          getProfileLaunchEntryId({ key: handoff.appKey ?? '', path: handoff.appPath })
        )
      )
      // Killing the host does NOT remove the consent prompt, so every cancel
      // above leaves a dialog on screen that now does nothing (#809). The count
      // is a single module-level scalar drained by whoever reports it, so this
      // has to drain it here for two separate reasons: the user is never told
      // otherwise, AND the stale count would be picked up by the next kill,
      // including one for a completely different game, which would attribute
      // the warning to an operation that stranded nothing (Codex P2 on #782).
      strandedConsentPrompts = drainStrandedConsentPrompts()
    }
    reportStrandedConsentPrompts(strandedConsentPrompts)
    notifyStoreConfigChanged({ reason: 'save-profile', keys: ['profiles'] })
    // Republish so a tracking toggle takes effect on save rather than on the
    // next poll (#591). Saving a profile changes which processes are surfaced
    // at all, and the tasklist scan is the only other thing that would notice,
    // up to 12s later on the SLOW cadence. This is also what finally gives the
    // 'config' change reason a producer; it has been declared and unused.
    publishRunningApps('config').catch((err) => {
      console.error('Failed to publish running apps after a profile change:', err)
    })
  })

  ipcMain.handle('save-profiles', (_event, profiles: unknown) => {
    const sanitizedProfiles = getSanitizedProfileRecord(profiles)
    if (!sanitizedProfiles) return
    store.set('profiles', sanitizedProfiles)
    notifyStoreConfigChanged({ reason: 'save-profiles', keys: ['profiles'] })
    // Same reason as save-profile above: this is the bulk write, so it can
    // change tracking for several games at once.
    publishRunningApps('config').catch((err) => {
      console.error('Failed to publish running apps after a profile change:', err)
    })
  })

  ipcMain.handle('get-migration-flags', () => {
    return {
      migrated: store.get('migrated'),
      profileUtilityOrderMigrated: store.get('profileUtilityOrderMigrated'),
      profileSetsMigrated: store.get('profileSetsMigrated')
    }
  })

  // Migration flags are set by the renderer after it completes one-time data
  // migrations. The allowlist here prevents the renderer from writing arbitrary
  // store keys through this channel.
  ipcMain.handle('set-migration-flags', (_event, patch: unknown) => {
    if (!isRecord(patch)) return
    const MIGRATION_KEYS = [
      'migrated',
      'profileUtilityOrderMigrated',
      'profileSetsMigrated'
    ] as const
    const safe: Record<string, boolean> = {}
    for (const key of MIGRATION_KEYS) {
      if (key in patch && typeof patch[key] === 'boolean') safe[key] = patch[key] as boolean
    }
    const changedKeys = Object.keys(safe)
    if (changedKeys.length > 0) {
      setStoreEntries(safe)
      notifyStoreConfigChanged({ reason: 'set-migration-flags', keys: changedKeys })
    }
  })

  // onboardingSeen is a LOCAL-only UX flag: the first-run onboarding modal is
  // shown once, then this is set so it never reappears. Kept out of the config
  // export/import surface (not in EXPECTED_CONFIG_KEYS) so it never travels
  // between machines. No store-config-changed broadcast is needed: the modal
  // manages its own dismissal via renderer state. #641
  ipcMain.handle('get-onboarding-seen', () => {
    return store.get('onboardingSeen')
  })

  ipcMain.handle('set-onboarding-seen', (_event, seen: unknown) => {
    if (typeof seen !== 'boolean') return
    store.set('onboardingSeen', seen)
  })
}
