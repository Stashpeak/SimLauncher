import { useEffect, useRef, useState } from 'react'

export interface LaunchEndOptions {
  /**
   * Marks this as a fresh game launch (not a profile switch or relaunch-missing,
   * which reuse the same cooldown while the game is already running). Only a
   * primary launch fires `onLaunchSettled`, so the "now running" cue isn't spoken
   * after a switch/relaunch.
   */
  primaryLaunch?: boolean
}

export interface UseLaunchBlockOptions {
  /**
   * Called once the post-launch cooldown for a PRIMARY launch lapses — i.e. a
   * fresh game launch has fully settled. Only fires when a cooldown actually ran
   * (apps were started) AND the launch was flagged `primaryLaunch`. Not called
   * for profile switches / relaunch-missing, if a new launch pre-empts the
   * cooldown, or if the component unmounts first.
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
   * starts before it expires. Pass `{ primaryLaunch: true }` for a fresh launch
   * so the settled cue fires (omit it for switches / relaunch-missing).
   */
  handleLaunchEnd: (
    finishedGameKey: string,
    cooldownMs?: number,
    options?: LaunchEndOptions
  ) => void
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

  const handleLaunchEnd = (
    finishedGameKey: string,
    cooldownMs = 0,
    options: LaunchEndOptions = {}
  ) => {
    // Captured per-launch so the scheduled timer fires the settled cue only for a
    // fresh launch — never after a profile switch / relaunch-missing.
    const isPrimaryLaunch = options.primaryLaunch === true

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
        if (isPrimaryLaunch) {
          onLaunchSettledRef.current?.(finishedGameKey)
        }
      }, cooldownMs)

      return currentGameKey
    })
  }

  return { launchingGameKey, handleLaunchStart, handleLaunchEnd }
}
