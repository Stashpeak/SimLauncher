export {}

declare global {
  interface Window {
    electronAPI: {
      launchProfile: (apps: string[]) => Promise<unknown>
      browsePath: (inputId: string) => Promise<unknown>
      onAppLaunchError: (cb: (data: unknown) => void) => () => void
      minimize: () => Promise<unknown>
      maximize: () => Promise<unknown>
      close: () => Promise<unknown>
      getRunningApps: () => Promise<{ path: string; name: string }[]>
      killLaunchedApps: () => Promise<unknown>
      onUpdateAvailable: (cb: (info: any) => void) => () => void
      onUpdateDownloaded: (cb: (info: any) => void) => () => void
      installUpdate: () => Promise<unknown>
      storeGet: (key: string) => Promise<unknown>
      storeSet: (key: string, value: unknown) => Promise<unknown>
    }
  }
}
