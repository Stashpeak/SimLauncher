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
  error?: string
}

declare global {
  interface Window {
    electronAPI: {
      launchProfile: (gameKey: string, apps: string[]) => Promise<LaunchResult>
      browsePath: (inputId: string) => Promise<BrowsePathResult>
      onAppLaunchError: (cb: (data: unknown) => void) => Unsubscribe
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      getRunningApps: () => Promise<RunningApp[]>
      killLaunchedApps: (gameKey?: string) => Promise<void>
      onUpdateAvailable: (cb: (info: any) => void) => Unsubscribe
      onUpdateDownloaded: (cb: (info: any) => void) => Unsubscribe
      onUpdateNotAvailable: (cb: (info: any) => void) => Unsubscribe
      installUpdate: () => Promise<void>
      checkForUpdates: () => Promise<void>
      storeGet: (key: string) => Promise<unknown>
      storeSet: (key: string, value: unknown) => Promise<void>
      getAssetData: (filename: string) => Promise<string | null>
      getFileIcon: (filePath: string) => Promise<string | null>
      getVersion: () => Promise<string>
    }
  }
}
