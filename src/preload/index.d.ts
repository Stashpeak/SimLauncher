export {}

type Unsubscribe = () => void

interface RunningApp {
  path: string
  name: string
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
      launchProfile: (apps: string[]) => Promise<LaunchResult>
      browsePath: (inputId: string) => Promise<BrowsePathResult>
      onAppLaunchError: (cb: (data: unknown) => void) => Unsubscribe
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      getRunningApps: () => Promise<RunningApp[]>
      killLaunchedApps: () => Promise<void>
      onUpdateAvailable: (cb: (info: unknown) => void) => Unsubscribe
      onUpdateDownloaded: (cb: (info: unknown) => void) => Unsubscribe
      installUpdate: () => Promise<void>
      storeGet: (key: string) => Promise<unknown>
      storeSet: (key: string, value: unknown) => Promise<void>
      getAssetData: (filename: string) => Promise<string | null>
      getFileIcon: (filePath: string) => Promise<string | null>
    }
  }
}
