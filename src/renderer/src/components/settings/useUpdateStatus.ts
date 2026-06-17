import { useCallback, useEffect, useState } from 'react'
import type { ProgressInfo } from 'electron-updater'
import {
  checkForUpdates,
  getVersion,
  installUpdate,
  onUpdateAvailable,
  onUpdateDownloaded,
  onUpdateDownloadProgress,
  onUpdateError,
  onUpdateNotAvailable
} from '../../lib/electron'
import type { Announce } from '../Notify'
import type { UpdateErrorInfo, UpdateInfo, UpdateStatus } from './types'

type Notify = (message: string, type: 'success' | 'warn' | 'error', durationMs?: number) => void

export interface UseUpdateStatusResult {
  appVersion: string
  checkingUpdate: boolean
  installingUpdate: boolean
  updateProgress: number | null
  updateStatus: UpdateStatus
  handleManualCheck: () => Promise<void>
  handleInstallUpdate: () => Promise<void>
}

export function useUpdateStatus({
  updateInfo,
  notify,
  announce
}: {
  updateInfo: UpdateInfo
  notify: Notify
  announce: Announce
}): UseUpdateStatusResult {
  const [appVersion, setAppVersion] = useState<string>('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(null)

  useEffect(() => {
    // Track all auto-clear timers so they can be cancelled on unmount; leaking
    // a timer that calls setState on an unmounted hook causes a React warning.
    const statusTimers: number[] = []
    const clearStatusLater = (delayMs: number) => {
      const timer = window.setTimeout(() => setUpdateStatus(null), delayMs)
      statusTimers.push(timer)
    }

    async function load() {
      const version = await getVersion()
      setAppVersion(version)
    }
    load()

    // When an update is found, clear the spinner but leave status null so the
    // "Download & Install" button (rendered when updateInfo is truthy) takes over
    // the UI — no intermediate status message is needed.
    const unsubscribeAvailable = onUpdateAvailable(() => {
      setCheckingUpdate(false)
      setUpdateStatus(null)
    })
    const unsubscribeNotAvailable = onUpdateNotAvailable(() => {
      setCheckingUpdate(false)
      setUpdateStatus('up-to-date')
      clearStatusLater(3000)
    })
    const unsubscribeProgress = onUpdateDownloadProgress((progress: ProgressInfo) => {
      if (typeof progress?.percent === 'number') {
        setUpdateProgress(progress.percent)
      }
    })
    const unsubscribeDownloaded = onUpdateDownloaded(() => {
      setCheckingUpdate(false)
      setInstallingUpdate(false)
      setUpdateProgress(null)
      setUpdateStatus('downloaded')
    })
    const unsubscribeError = onUpdateError((error: UpdateErrorInfo) => {
      setCheckingUpdate(false)
      setInstallingUpdate(false)
      setUpdateProgress(null)
      if (error?.isNetworkError) {
        // Offline (common on a dedicated rig) is not a real failure — show a
        // calm INLINE notice only (no toast), like "up to date" does. The inline
        // status carries role="status" in AboutSection, so it's still announced
        // to a screen reader without a redundant toast of the same text (#595).
        setUpdateStatus('offline')
      } else {
        setUpdateStatus('error')
        notify(error?.message || 'Update check failed', 'error')
      }
      clearStatusLater(4000)
    })

    return () => {
      unsubscribeAvailable()
      unsubscribeNotAvailable()
      unsubscribeProgress()
      unsubscribeDownloaded()
      unsubscribeError()
      statusTimers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [notify])

  const handleManualCheck = useCallback(async () => {
    setCheckingUpdate(true)
    setUpdateStatus(null)

    try {
      await checkForUpdates()
    } catch (err) {
      setCheckingUpdate(false)
      setUpdateStatus('error')
      notify('Update check failed', 'error')
      console.error(err)
    }
  }, [notify])

  const handleInstallUpdate = useCallback(async () => {
    if (!updateInfo) {
      return
    }

    if (
      window.confirm(
        `Download and install version ${updateInfo.version}? SimLauncher will restart when ready.`
      )
    ) {
      setInstallingUpdate(true)
      setUpdateProgress(null)
      setUpdateStatus(null)
      // The download has no screen-reader-visible text (the button is
      // aria-live=off so it doesn't announce every percent), so announce that
      // the install started. Success ends in an app restart; failures are
      // announced via notify().
      announce('Downloading update…')

      try {
        await installUpdate()
      } catch (err) {
        setInstallingUpdate(false)
        setUpdateProgress(null)
        setUpdateStatus('error')
        notify('Failed to install update', 'error')
        console.error(err)
      }
    }
  }, [announce, notify, updateInfo])

  return {
    appVersion,
    checkingUpdate,
    installingUpdate,
    updateProgress,
    updateStatus,
    handleManualCheck,
    handleInstallUpdate
  }
}
