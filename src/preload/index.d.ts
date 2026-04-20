export {}

type Unsubscribe = () => void

interface RunningApp {
  path: string
  name: string
  gameKey: string
  tracked?: boolean
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
      getProfileSwitchDiff: (gameKey: string, fromProfileId: string, toProfileId: string) => Promise<{ toStopCount: number; toStartCount: number }>
      switchProfileApps: (gameKey: string, fromProfileId: string, toProfileId: string) => Promise<LaunchResult>
      browsePath: (inputId: string) => Promise<BrowsePathResult>
      onAppLaunchError: (cb: (data: unknown) => void) => Unsubscribe
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      getRunningApps: () => Promise<RunningApp[]>
      killLaunchedApps: (gameKey?: string) => Promise<void>
      killProfileApps: (gameKey: string, appPaths: string[]) => Promise<void>
      onUpdateAvailable: (cb: (info: any) => void) => Unsubscribe
      onUpdateDownloaded: (cb: (info: any) => void) => Unsubscribe
      onUpdateNotAvailable: (cb: (info: any) => void) => Unsubscribe
      onUpdateDownloadProgress: (cb: (progress: any) => void) => Unsubscribe
      onUpdateError: (cb: (error: any) => void) => Unsubscribe
      installUpdate: () => Promise<unknown>
      checkForUpdates: () => Promise<unknown>
      storeGet: (key: string) => Promise<unknown>
      storeSet: (key: string, value: unknown) => Promise<void>
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
