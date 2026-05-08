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
  autoCheckUpdates: boolean
  zoomFactor: number
}

export type WritableSettings = Settings

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
  keys: string[]
}

export type Unsubscribe = () => void

export interface RunningApp {
  path: string
  name: string
  gameKey: string
  tracked?: boolean
  warning?: string
  elevated?: boolean
}

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
  token?: string
  summary?: ConfigImportPreviewSummary
}

export interface UpdateAvailability {
  version: string
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
  restartApp: () => Promise<void>
  getRunningApps: () => Promise<RunningApp[]>
  subscribeRunningApps: () => Promise<RunningAppsChangedPayload>
  unsubscribeRunningApps: () => Promise<void>
  onRunningAppsChanged: (cb: (payload: RunningAppsChangedPayload) => void) => Unsubscribe
  killLaunchedApps: (gameKey?: string) => Promise<KillResult>
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => Unsubscribe
  onUpdateDownloaded: (cb: (info: UpdateInfo) => void) => Unsubscribe
  onUpdateNotAvailable: (cb: (info: UpdateInfo) => void) => Unsubscribe
  onUpdateDownloadProgress: (cb: (progress: ProgressInfo) => void) => Unsubscribe
  onUpdateError: (cb: (error: Error) => void) => Unsubscribe
  installUpdate: () => Promise<unknown>
  checkForUpdates: () => Promise<unknown>
  getUpdateInfo: () => Promise<UpdateAvailability | null>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<WritableSettings>) => Promise<void>
  getProfiles: () => Promise<Record<string, unknown>>
  saveProfile: (gameKey: string, profileSet: unknown) => Promise<void>
  saveProfiles: (profiles: unknown) => Promise<void>
  getMigrationFlags: () => Promise<MigrationFlags>
  setMigrationFlags: (patch: Partial<MigrationFlags>) => Promise<void>
  onStoreConfigChanged: (cb: (payload: StoreConfigChangePayload) => void) => Unsubscribe
  exportConfig: () => Promise<ConfigFileResult>
  importConfig: () => Promise<ConfigFileResult>
  previewImportConfig: () => Promise<ConfigImportPreviewResult>
  applyImportConfig: (token: string) => Promise<ConfigFileResult>
  cancelImportConfig: (token: string) => Promise<ConfigFileResult>
  setLoginItem: (openAtLogin: boolean) => Promise<void>
  setZoom: (factor: number) => Promise<void>
  getAssetData: (filename: string) => Promise<string | null>
  getFileIcon: (filePath: string) => Promise<string | null>
  getVersion: () => Promise<string>
  showAppContextMenu: (appPath: string, gameKey: string) => Promise<void>
}
