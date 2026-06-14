import { useEffect, useRef, useState } from 'react'

export interface UseLaunchBlockOptions {
  /**
   * Called once the post-launch cooldown for a game lapses — i.e. the launch
   * sequence has fully settled. Only fires when a cooldown actually ran (apps
   * were started), so it is a reliable "now running" signal. Not called if a new
   * launch pre-empts the cooldown or the component unmounts first.
   */
  onLaunchSettled?: (gameKey: string) => void
}

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

export function useLaunchBlock(options: UseLaunchBlockOptions = {}): UseLaunchBlockResult {
  const { onLaunchSettled } = options
  const [launchingGameKey, setLaunchingGameKey] = useState<string | null>(null)
  const launchBlockTimeoutRef = useRef<number | null>(null)

  // Read the latest callback from the cooldown timer without re-subscribing or
  // baking a stale closure into the scheduled timeout.
  const onLaunchSettledRef = useRef(onLaunchSettled)
  onLaunchSettledRef.current = onLaunchSettled

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
        launchBlockTimeoutRef.current = null
        // A new launch would have cleared this timeout in handleLaunchStart, so
        // reaching here means this game's sequence settled uninterrupted.
        setLaunchingGameKey((latestGameKey) =>
          latestGameKey === finishedGameKey ? null : latestGameKey
        )
        onLaunchSettledRef.current?.(finishedGameKey)
      }, cooldownMs)

      return currentGameKey
    })
  }

  return { launchingGameKey, handleLaunchStart, handleLaunchEnd }
}
