import { useEffect, useRef, useState } from 'react'

export interface UseLaunchBlockResult {
  launchingGameKey: string | null
  handleLaunchStart: (gameKey: string) => void
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
