import { useCallback, useEffect, useState } from 'react'
import type { Game } from '../lib/config'
import {
  getRunningApps,
  onRunningAppsChanged,
  subscribeRunningApps,
  unsubscribeRunningApps
} from '../lib/electron'

export type RunningApp = {
  path: string
  name: string
  gameKey: string
  warning?: string
  elevated?: boolean
  tracked?: boolean
}

export type RunningAppsChangeReason = 'initial' | 'launch' | 'exit' | 'kill' | 'config' | 'scan'

export interface RunningAppsChangedPayload {
  apps: RunningApp[]
  reason: RunningAppsChangeReason
  updatedAt: number
}

export interface UseRunningAppsResult {
  runningApps: RunningApp[]
  runningStatus: Record<string, boolean>
  refreshRunningState: (isMounted?: () => boolean) => Promise<void>
}

export function useRunningApps(configuredGames: Game[]): UseRunningAppsResult {
  const [runningApps, setRunningApps] = useState<RunningApp[]>([])
  const [runningStatus, setRunningStatus] = useState<Record<string, boolean>>({})

  const clearRunningState = useCallback(() => {
    setRunningApps((current) => (current.length === 0 ? current : []))
    setRunningStatus((current) => (Object.keys(current).length === 0 ? current : {}))
  }, [])

  const applyRunningApps = useCallback(
    (apps: RunningApp[] | undefined) => {
      const nextApps: RunningApp[] = apps || []
      setRunningApps(nextApps)

      const newStatus: Record<string, boolean> = {}
      configuredGames.forEach((game) => {
        newStatus[game.key] = nextApps.some((app) => app.gameKey === game.key)
      })
      setRunningStatus(newStatus)
    },
    [configuredGames]
  )

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

        applyRunningApps(apps)
      } catch (err) {
        console.error('Running apps refresh error:', err)
      }
    },
    [applyRunningApps, clearRunningState, configuredGames.length]
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

    const unsubscribe = onRunningAppsChanged((payload: RunningAppsChangedPayload) => {
      if (isMounted()) {
        applyRunningApps(payload.apps)
      }
    })

    subscribeRunningApps()
      .then((payload: RunningAppsChangedPayload) => {
        if (isMounted()) {
          applyRunningApps(payload.apps)
        }
      })
      .catch((err: unknown) => {
        console.error('Running apps subscription error:', err)
        refreshRunningState(isMounted)
      })

    return () => {
      mounted = false
      unsubscribe()
      unsubscribeRunningApps().catch((err: unknown) => {
        console.error('Running apps unsubscribe error:', err)
      })
    }
  }, [applyRunningApps, clearRunningState, configuredGames.length, refreshRunningState])

  return { runningApps, runningStatus, refreshRunningState }
}
