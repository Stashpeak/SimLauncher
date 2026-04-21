export {}

declare global {
  interface Settings {
    appPaths: Record<string, string>
    gamePaths: Record<string, string>
    appNames: Record<string, string>
    customSlots: number
    accentPreset: string
    accentCustom: string
    accentBgTint: boolean
    focusActiveTitle: boolean
    launchDelayMs: number
    startWithWindows: boolean
    startMinimized: boolean
    minimizeToTray: boolean
    autoCheckUpdates: boolean
    zoomFactor: number
  }

  type WritableSettings = Omit<Settings, 'startWithWindows' | 'zoomFactor'>

  interface MigrationFlags {
    migrated: boolean
    profileUtilityOrderMigrated: boolean
    profileSetsMigrated: boolean
  }
}

type Unsubscribe = () => void

interface RunningApp {
  path: string
  name: string
  gameKey: string
  tracked?: boolean
  warning?: string
}

interface BrowsePathResult {
  filePath: string | null
  inputId: string
}

interface LaunchResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  launchedCount?: number
  skippedCount?: number
  elevatedCount?: number
  failedCount?: number
}

interface KillResult {
  success: boolean
  message?: string
  warning?: string
  error?: string
  closedCount: number
  failedCount: number
}

interface ConfigFileResult {
  success: boolean
  canceled?: boolean
  error?: string
  filePath?: string
}

declare global {
  interface Window {
    electronAPI: {
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
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      getRunningApps: () => Promise<RunningApp[]>
      killLaunchedApps: (gameKey?: string) => Promise<KillResult>
      killProfileApps: (gameKey: string, appPaths: string[]) => Promise<KillResult>
      onUpdateAvailable: (cb: (info: any) => void) => Unsubscribe
      onUpdateDownloaded: (cb: (info: any) => void) => Unsubscribe
      onUpdateNotAvailable: (cb: (info: any) => void) => Unsubscribe
      onUpdateDownloadProgress: (cb: (progress: any) => void) => Unsubscribe
      onUpdateError: (cb: (error: any) => void) => Unsubscribe
      installUpdate: () => Promise<unknown>
      checkForUpdates: () => Promise<unknown>
      getSettings: () => Promise<Settings>
      saveSettings: (patch: Partial<WritableSettings>) => Promise<void>
      getProfiles: () => Promise<Record<string, unknown>>
      saveProfile: (gameKey: string, profileSet: unknown) => Promise<void>
      saveProfiles: (profiles: unknown) => Promise<void>
      getMigrationFlags: () => Promise<MigrationFlags>
      setMigrationFlags: (patch: Partial<MigrationFlags>) => Promise<void>
      exportConfig: () => Promise<ConfigFileResult>
      importConfig: () => Promise<ConfigFileResult>
      setLoginItem: (openAtLogin: boolean) => Promise<void>
      setZoom: (factor: number) => Promise<void>
      getAssetData: (filename: string) => Promise<string | null>
      getFileIcon: (filePath: string) => Promise<string | null>
      getVersion: () => Promise<string>
    }
  }
}
