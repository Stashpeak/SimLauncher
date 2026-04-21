import { useCallback, useEffect, useState } from 'react'
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
import type { UpdateInfo, UpdateStatus } from './types'

type Notify = (message: string, type: 'success' | 'warn' | 'error', durationMs?: number) => void

export function useUpdateStatus({
  updateInfo,
  notify
}: {
  updateInfo: UpdateInfo
  notify: Notify
}) {
  const [appVersion, setAppVersion] = useState<string>('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(null)

  useEffect(() => {
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

    const unsubscribeAvailable = onUpdateAvailable(() => {
      setCheckingUpdate(false)
      setUpdateStatus(null)
    })
    const unsubscribeNotAvailable = onUpdateNotAvailable(() => {
      setCheckingUpdate(false)
      setUpdateStatus('up-to-date')
      clearStatusLater(3000)
    })
    const unsubscribeProgress = onUpdateDownloadProgress((progress) => {
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
    const unsubscribeError = onUpdateError((error) => {
      setCheckingUpdate(false)
      setInstallingUpdate(false)
      setUpdateProgress(null)
      setUpdateStatus('error')
      notify(error?.message || 'Update check failed', 'error')
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
  }, [notify, updateInfo])

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
