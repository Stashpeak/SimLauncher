import type { ProgressInfo, UpdateInfo } from 'electron-updater'

export interface Settings {
  appPaths: Record<string, string>
  gamePaths: Record<string, string>
  appNames: Record<string, string>
  appArgs: Record<string, string>
  customSlots: number
  accentPreset: string
  accentCustom: string
  accentBgTint: boolean
  themeMode: 'light' | 'dark' | 'system'
  focusActiveTitle: boolean
  launchDelayMs: number
  startWithWindows: boolean
  startMinimized: boolean
  minimizeToTray: boolean
  showTrayIcon: boolean
  autoCheckUpdates: boolean
  zoomFactor: number
}

// WritableSettings is a type alias rather than a distinct type so the renderer
// can pass a Partial<WritableSettings> to saveSettings without casting, while
// keeping the door open to narrowing it (e.g. omitting read-only computed
// fields) without changing the Settings surface.
export type WritableSettings = Settings

export type DroppedSettingsRecordField = 'gamePaths' | 'appPaths' | 'appNames' | 'appArgs'

export interface DroppedSettingsEntry {
  field: DroppedSettingsRecordField
  key: string
}

/**
 * Result of a 'save-settings' call. `settings` is the actual on-disk state
 * after the save (not an echo of the request), so the renderer can re-baseline
 * dirty-tracking from the persisted truth instead of its own pre-save copy.
 * `dropped` lists entries the main-process sanitizer rejected (bad extension,
 * over the length cap) so the renderer can warn instead of showing a plain
 * success message when data was silently not saved. #669
 */
export interface SaveSettingsResult {
  settings: Settings
  dropped: DroppedSettingsEntry[]
}

export interface MigrationFlags {
  migrated: boolean
  profileUtilityOrderMigrated: boolean
  profileSetsMigrated: boolean
}

export type StoreConfigChangeReason =
  | 'import-config'
  | 'save-settings'
  | 'save-profile'
  | 'save-profiles'
  | 'set-migration-flags'

export interface StoreConfigChangePayload {
  reason: StoreConfigChangeReason
  /**
   * Store keys that changed. A single-element array `['*']` means all keys
   * should be treated as dirty (used after a full config import/replace).
   */
  keys: string[]
}

export type Unsubscribe = () => void

export interface RunningApp {
  path: string
  name: string
  gameKey: string
  /** True when the process path matches a configured tracked-process entry for the game. */
  tracked?: boolean
  /** Human-readable warning set when process name detection heuristics are uncertain. */
  warning?: string
  /** True when the process was detected as running with elevated (admin) privileges. */
  elevated?: boolean
}

/**
 * Describes why the running-apps list was re-published. The renderer uses this
 * to decide animation and notification behaviour:
 * - 'initial': first emission after subscribe, used to populate state without animation.
 * - 'launch' / 'exit' / 'kill': explicit user actions.
 * - 'config': store change caused the tracked-app list to differ (paths edited).
 * - 'scan': periodic or on-demand re-evaluation of the OS process list, e.g.
 *   after dismiss-app-icon.
 */
export type RunningAppsChangeReason = 'initial' | 'launch' | 'exit' | 'kill' | 'config' | 'scan'

export interface RunningAppsChangedPayload {
  apps: RunningApp[]
  reason: RunningAppsChangeReason
  updatedAt: number
}

export interface ProcessNameMismatchWarningPayload {
  app: string
  warning: string
}

export interface BrowsePathResult {
  filePath: string | null
  inputId: string
}

/**
 * Reason codes for a per-process kill failure, surfaced in KillFailure so the
 * renderer can show a specific message rather than a generic error:
 * - 'access_denied': the process requires elevation to terminate (UAC).
 * - 'still_running': the termination signal was sent but the process did not
 *   exit within the expected window.
 * - 'unknown': any other OS-level error.
 */
export type KillFailureReason = 'access_denied' | 'still_running' | 'unknown'

export interface KillFailure {
  appName: string
  appPath: string
  reason: KillFailureReason
}

export interface LaunchResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  launchedCount?: number
  skippedCount?: number
  elevatedCount?: number
  failedCount?: number
  killFailures?: KillFailure[]
}

export interface KillResult {
  success: boolean
  message?: string
  error?: string
  closedCount: number
  failedCount: number
  failures: KillFailure[]
}

export interface ConfigFileResult {
  success: boolean
  canceled?: boolean
  error?: string
  filePath?: string
}

export interface ConfigImportPreviewEntry {
  key: string
  path?: string
  args?: string
}

export interface ConfigImportPreviewSummary {
  changedKeys: string[]
  gamePaths: ConfigImportPreviewEntry[]
  appPaths: ConfigImportPreviewEntry[]
  trackedProcessPaths: ConfigImportPreviewEntry[]
  customAppArgs: ConfigImportPreviewEntry[]
  droppedCount: number
  warnings: string[]
}

export interface ConfigImportPreviewResult extends ConfigFileResult {
  /**
   * Opaque single-use token generated server-side. Must be passed back to
   * `applyImportConfig` or `cancelImportConfig` to complete or discard the
   * pending import. The token expires after 5 minutes.
   */
  token?: string
  summary?: ConfigImportPreviewSummary
}

export interface UpdateAvailability {
  version: string
}

/**
 * Payload for the 'update-error' channel. `isNetworkError` is true when the
 * failure is just a connectivity problem (offline rig) rather than a real
 * updater fault, so the renderer can show a calmer message.
 */
export interface UpdateErrorPayload {
  message: string
  isNetworkError: boolean
}

/**
 * A one-shot notice the main process surfaces to the renderer on startup (e.g.
 * the persisted config was unreadable and had to be reset). Pulled once via
 * getStartupNotice and shown as a toast; the type maps to a toast variant.
 */
export interface StartupNotice {
  type: 'success' | 'warn' | 'error'
  message: string
}

export interface ElectronAPI {
  launchProfile: (gameKey: string) => Promise<LaunchResult>
  relaunchMissingProfile: (gameKey: string) => Promise<LaunchResult>
  getProfileSwitchDiff: (
    gameKey: string,
    fromProfileId: string,
    toProfileId: string
  ) => Promise<{ toStopCount: number; toStartCount: number }>
  switchProfileApps: (
    gameKey: string,
    fromProfileId: string,
    toProfileId: string
  ) => Promise<LaunchResult>
  browsePath: (inputId: string) => Promise<BrowsePathResult>
  onAppLaunchError: (cb: (data: unknown) => void) => Unsubscribe
  onProcessNameMismatchWarning: (
    cb: (data: ProcessNameMismatchWarningPayload) => void
  ) => Unsubscribe
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  forceClose: () => Promise<void>
  forceMinimizeToTray: () => Promise<void>
  setRendererDirty: (isDirty: boolean) => Promise<void>
  setPendingMinimizeToTray: (value: boolean | null) => Promise<void>
  onCloseRequested: (cb: (payload: { minimizeMode: boolean }) => void) => Unsubscribe
  restartApp: () => Promise<void>
  onWindowMaximizedChanged: (cb: (isMaximized: boolean) => void) => Unsubscribe
  getRunningApps: () => Promise<RunningApp[]>
  subscribeRunningApps: () => Promise<RunningAppsChangedPayload>
  unsubscribeRunningApps: () => Promise<void>
  onRunningAppsChanged: (cb: (payload: RunningAppsChangedPayload) => void) => Unsubscribe
  killLaunchedApps: (gameKey?: string) => Promise<KillResult>
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => Unsubscribe
  onUpdateDownloaded: (cb: (info: UpdateInfo) => void) => Unsubscribe
  onUpdateReadyWhileDirty: (cb: (info: UpdateInfo) => void) => Unsubscribe
  onUpdateNotAvailable: (cb: (info: UpdateInfo) => void) => Unsubscribe
  onUpdateDownloadProgress: (cb: (progress: ProgressInfo) => void) => Unsubscribe
  onUpdateError: (cb: (error: UpdateErrorPayload) => void) => Unsubscribe
  installUpdate: () => Promise<unknown>
  checkForUpdates: () => Promise<unknown>
  getUpdateInfo: () => Promise<UpdateAvailability | null>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<WritableSettings>) => Promise<SaveSettingsResult>
  getProfiles: () => Promise<Record<string, unknown>>
  saveProfile: (gameKey: string, profileSet: unknown) => Promise<void>
  saveProfiles: (profiles: unknown) => Promise<void>
  getMigrationFlags: () => Promise<MigrationFlags>
  setMigrationFlags: (patch: Partial<MigrationFlags>) => Promise<void>
  getOnboardingSeen: () => Promise<boolean>
  setOnboardingSeen: (seen: boolean) => Promise<void>
  onStoreConfigChanged: (cb: (payload: StoreConfigChangePayload) => void) => Unsubscribe
  exportConfig: () => Promise<ConfigFileResult>
  previewImportConfig: () => Promise<ConfigImportPreviewResult>
  applyImportConfig: (token: string) => Promise<ConfigFileResult>
  cancelImportConfig: (token: string) => Promise<ConfigFileResult>
  setLoginItem: (openAtLogin: boolean) => Promise<void>
  setZoom: (factor: number) => Promise<void>
  getAssetData: (filename: string) => Promise<string | null>
  getFileIcon: (filePath: string) => Promise<string | null>
  getVersion: () => Promise<string>
  getStartupNotice: () => Promise<StartupNotice | null>
  openLogsFolder: () => Promise<string>
  openExternalUrl: (url: string) => Promise<boolean>
  dismissAppIcon: (
    appPath: string,
    gameKey: string
  ) => Promise<{ success: boolean; error?: string }>
}
