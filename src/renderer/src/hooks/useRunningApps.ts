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

// 'config' fires when the set of tracked paths changes without a process event.
// 'scan' is a periodic reconciliation poll from the main process.
export type RunningAppsChangeReason = 'initial' | 'launch' | 'exit' | 'kill' | 'config' | 'scan'

export interface RunningAppsChangedPayload {
  apps: RunningApp[]
  /**
   * Game keys whose companions a Close Apps click would currently close (#673).
   * Absent and empty are NOT the same answer: `[]` is a measured "nothing to
   * close" and clears the state, while omitting the field means the caller had
   * no way to ask (the one-shot `getRunningApps` returns apps only) and leaves
   * the last pushed answer standing. A consumer that folds the two together
   * hides the control on every refresh that follows a kill.
   */
  closableGameKeys?: string[]
  reason: RunningAppsChangeReason
  updatedAt: number
}

export interface UseRunningAppsResult {
  runningApps: RunningApp[]
  runningStatus: Record<string, boolean>
  /** Game keys a Close Apps click would currently act on (#673). */
  closableGameKeys: Set<string>
  refreshRunningState: (isMounted?: () => boolean) => Promise<void>
}

const EMPTY_CLOSABLE_GAME_KEYS: ReadonlySet<string> = new Set<string>()

export function useRunningApps(configuredGames: Game[]): UseRunningAppsResult {
  const [runningApps, setRunningApps] = useState<RunningApp[]>([])
  const [runningStatus, setRunningStatus] = useState<Record<string, boolean>>({})
  const [closableGameKeys, setClosableGameKeys] = useState<Set<string>>(
    EMPTY_CLOSABLE_GAME_KEYS as Set<string>
  )

  const clearRunningState = useCallback(() => {
    // Referential stability: avoid triggering downstream re-renders when
    // state is already empty. Return the same array/object reference so
    // React bails out of the update.
    setRunningApps((current) => (current.length === 0 ? current : []))
    setRunningStatus((current) => (Object.keys(current).length === 0 ? current : {}))
    setClosableGameKeys((current) => (current.size === 0 ? current : new Set<string>()))
  }, [])

  const applyRunningApps = useCallback(
    (apps: RunningApp[] | undefined, closable?: string[]) => {
      const nextApps: RunningApp[] = apps || []
      setRunningApps(nextApps)

      const newStatus: Record<string, boolean> = {}
      configuredGames.forEach((game) => {
        newStatus[game.key] = nextApps.some((app) => app.gameKey === game.key)
      })
      setRunningStatus(newStatus)
      // Absent rather than empty means the caller could not ask: the one-shot
      // `getRunningApps` fallback below returns apps only. Leave the last
      // pushed answer alone rather than overwriting it with a guess, because
      // `refreshRunningState` runs right after every kill and profile switch —
      // and `killLaunchedApps` has already published the authoritative set by
      // then, so clearing here would throw away the newer truth and hide the
      // control until the next scan tick, even when targets are still closable.
      if (closable !== undefined) {
        setClosableGameKeys((current) => {
          const next = new Set(closable)
          if (next.size === current.size && [...next].every((key) => current.has(key))) {
            return current
          }
          return next
        })
      }
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

    // Register the push listener BEFORE calling subscribeRunningApps so that
    // any events emitted synchronously during subscription are not lost.
    const unsubscribe = onRunningAppsChanged((payload: RunningAppsChangedPayload) => {
      if (isMounted()) {
        applyRunningApps(payload.apps, payload.closableGameKeys)
      }
    })

    // subscribeRunningApps asks the main process to begin emitting
    // onRunningAppsChanged events and returns the current snapshot.
    // Falls back to a one-shot getRunningApps poll if the subscription fails
    // (e.g. IPC timeout on startup).
    subscribeRunningApps()
      .then((payload: RunningAppsChangedPayload) => {
        if (isMounted()) {
          applyRunningApps(payload.apps, payload.closableGameKeys)
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

  return { runningApps, runningStatus, closableGameKeys, refreshRunningState }
}
