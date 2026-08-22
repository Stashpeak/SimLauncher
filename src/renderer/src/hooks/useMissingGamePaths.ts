import { useCallback, useEffect, useState } from 'react'
import { getMissingGamePaths, onStoreConfigChanged } from '../lib/store'

// Derived from the store binding rather than imported, matching GameList, so
// the reason gate below stays in sync with StoreConfigChangeReason.
type StoreConfigChangePayload = Parameters<typeof onStoreConfigChanged>[0] extends (
  payload: infer Payload
) => void
  ? Payload
  : never

const EMPTY_MISSING_GAME_PATH_KEYS: ReadonlySet<string> = new Set<string>()

export interface UseMissingGamePathsResult {
  /** Game keys whose configured executable no longer resolves on disk (#794). */
  missingGamePathKeys: Set<string>
  refreshMissingGamePaths: () => Promise<void>
}

/**
 * Which configured games have lost their executable, on a cadence that is
 * settled rather than continuous (#794).
 *
 * The answer is config-shaped but the thing that changes it is the FILESYSTEM:
 * a game moved by a Steam library change, uninstalled, or reinstalled to the
 * same path. So the config-change channel alone is not enough, in both
 * directions, and the second one is the dangerous half:
 *
 * - a game that disappears mid-session would show no explanation until the next
 *   restart, which is the silent dead row this issue is about
 * - a game the user REPAIRS (Steam rewrites the same path with no SimLauncher
 *   config write at all) would keep the badge forever. A warning that is wrong
 *   is worse than one that is missing, because the user goes looking for a
 *   problem that no longer exists.
 *
 * Window focus closes both, because leaving to fix a path and coming back is
 * the shape of every real repair. `visibilitychange` is here too rather than as
 * a duplicate: a window restored from the tray can become visible without
 * taking focus.
 *
 * Deliberately NOT refreshed from the running-apps push. That fires every 2
 * seconds and would reintroduce exactly the flicker this cadence avoids.
 */
export function useMissingGamePaths(): UseMissingGamePathsResult {
  const [missingGamePathKeys, setMissingGamePathKeys] = useState<Set<string>>(
    EMPTY_MISSING_GAME_PATH_KEYS as Set<string>
  )

  const applyKeys = useCallback((keys: string[]) => {
    // Referential stability: the common answer is "nothing is missing" on every
    // refresh, and a fresh Set each time would re-render every row for no
    // change.
    setMissingGamePathKeys((current) => {
      const next = new Set(keys)
      if (next.size === current.size && keys.every((key) => current.has(key))) {
        return current
      }
      return next
    })
  }, [])

  const refreshMissingGamePaths = useCallback(async () => {
    try {
      applyKeys(await getMissingGamePaths())
    } catch (err) {
      // Leave the last answer standing. Clearing here would retract a true
      // warning because one IPC round-trip failed.
      console.error('Failed to read missing game paths', err)
    }
  }, [applyKeys])

  useEffect(() => {
    const alive = { current: true }

    const refresh = async () => {
      try {
        const keys = await getMissingGamePaths()
        if (!alive.current) return
        applyKeys(keys)
      } catch (err) {
        console.error('Failed to read missing game paths', err)
      }
    }

    void refresh()

    // Same gate as GameList's own settings reload: only 'import-config' (full
    // store replace) and 'save-settings' can carry gamePaths. Profile writes
    // and migration flags cannot, so they earn no round-trip.
    const unsubscribe = onStoreConfigChanged((payload: StoreConfigChangePayload) => {
      if (payload.reason !== 'import-config' && payload.reason !== 'save-settings') return
      void refresh()
    })

    const handleFocus = () => void refresh()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      alive.current = false
      unsubscribe()
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [applyKeys])

  return { missingGamePathKeys, refreshMissingGamePaths }
}
