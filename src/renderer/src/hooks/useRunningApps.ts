import { useCallback, useEffect, useState } from 'react'
import type { Game } from '../lib/config'
import { getRunningApps } from '../lib/electron'

export type RunningApp = { path: string; name: string; gameKey: string; warning?: string }

export function useRunningApps(configuredGames: Game[]) {
  const [runningApps, setRunningApps] = useState<RunningApp[]>([])
  const [runningStatus, setRunningStatus] = useState<Record<string, boolean>>({})

  const clearRunningState = useCallback(() => {
    setRunningApps((current) => (current.length === 0 ? current : []))
    setRunningStatus((current) => (Object.keys(current).length === 0 ? current : {}))
  }, [])

  const refreshRunningState = useCallback(
    async (isMounted: () => boolean = () => true) => {
      try {
        if (configuredGames.length === 0) {
          if (isMounted()) {
            clearRunningState()
          }
          return
        }

        const apps = await getRunningApps()
        if (!isMounted()) return

        const nextApps = apps || []
        setRunningApps(nextApps)

        const newStatus: Record<string, boolean> = {}
        configuredGames.forEach((game) => {
          newStatus[game.key] = nextApps.some((app) => app.gameKey === game.key)
        })
        setRunningStatus(newStatus)
      } catch (err) {
        console.error('Consolidated polling error:', err)
      }
    },
    [clearRunningState, configuredGames]
  )

  useEffect(() => {
    let mounted = true
    const isMounted = () => mounted

    if (configuredGames.length === 0) {
      clearRunningState()
      return () => {
        mounted = false
      }
    }

    refreshRunningState(isMounted)
    const intervalId = window.setInterval(() => refreshRunningState(isMounted), 2000)

    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [clearRunningState, configuredGames.length, refreshRunningState])

  return { runningApps, runningStatus, refreshRunningState }
}
