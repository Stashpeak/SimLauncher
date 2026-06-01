import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A simple hook to track if a state object has changed from its initial value.
 * Optimized for Settings and Profile data structures.
 */
export interface UseDirtyTrackingResult<T> {
  isDirty: boolean
  resetDirty: (newState?: T) => void
  getDirtySubset: (keys: (keyof T)[]) => boolean
}

export function useDirtyTracking<T>(
  currentState: T,
  loading: boolean = false
): UseDirtyTrackingResult<T> {
  const [isDirty, setIsDirty] = useState(false)
  const initialSnapshot = useRef<string | null>(null)

  useEffect(() => {
    // Capture initial state once loading is finished
    if (!loading && initialSnapshot.current === null) {
      initialSnapshot.current = JSON.stringify(currentState)
    }
  }, [loading, currentState])

  useEffect(() => {
    if (initialSnapshot.current === null) return

    setIsDirty(JSON.stringify(currentState) !== initialSnapshot.current)
  }, [currentState])

  const resetDirty = (newState?: T) => {
    initialSnapshot.current = JSON.stringify(newState ?? currentState)
    setIsDirty(false)
  }

  // Whether any of the given top-level keys differ from the captured baseline.
  // Powers per-section dirty indicators (#279) off the same baseline as isDirty.
  const getDirtySubset = useCallback(
    (keys: (keyof T)[]): boolean => {
      if (initialSnapshot.current === null) return false
      const baseline = JSON.parse(initialSnapshot.current) as T
      return keys.some((key) => JSON.stringify(currentState[key]) !== JSON.stringify(baseline[key]))
    },
    [currentState]
  )

  return { isDirty, resetDirty, getDirtySubset }
}
