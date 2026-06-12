import { useEffect, useRef, useState } from 'react'

export interface UseLaunchBlockResult {
  /** The game currently in its launch sequence, or null when idle. */
  launchingGameKey: string | null
  handleLaunchStart: (gameKey: string) => void
  /**
   * Signals that the launch sequence for `finishedGameKey` is done.
   * If `cooldownMs` > 0 the block stays active for that duration after the
   * launch so that the UI remains locked during process-startup time (prevents
   * accidental double-launches). The cooldown is cancelled if a new launch
   * starts before it expires.
   */
  handleLaunchEnd: (finishedGameKey: string, cooldownMs?: number) => void
}

export function useLaunchBlock(): UseLaunchBlockResult {
  const [launchingGameKey, setLaunchingGameKey] = useState<string | null>(null)
  const launchBlockTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (launchBlockTimeoutRef.current !== null) {
        window.clearTimeout(launchBlockTimeoutRef.current)
      }
    }
  }, [])

  const handleLaunchStart = (gameKey: string) => {
    if (launchBlockTimeoutRef.current !== null) {
      window.clearTimeout(launchBlockTimeoutRef.current)
      launchBlockTimeoutRef.current = null
    }

    setLaunchingGameKey(gameKey)
  }

  const handleLaunchEnd = (finishedGameKey: string, cooldownMs = 0) => {
    setLaunchingGameKey((currentGameKey) => {
      // Guard: a new launch for a different game may have started while this
      // one was in flight — leave that key untouched.
      if (currentGameKey !== finishedGameKey) {
        return currentGameKey
      }

      if (cooldownMs <= 0) {
        return null
      }

      launchBlockTimeoutRef.current = window.setTimeout(() => {
        setLaunchingGameKey((latestGameKey) =>
          latestGameKey === finishedGameKey ? null : latestGameKey
        )
        launchBlockTimeoutRef.current = null
      }, cooldownMs)

      return currentGameKey
    })
  }

  return { launchingGameKey, handleLaunchStart, handleLaunchEnd }
}
