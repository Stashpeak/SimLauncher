import { useCallback, useEffect, useState } from 'react'

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
  // Baseline snapshot (JSON) kept in state, not a ref, so that resetting it
  // after a save recomputes derived values (getDirtySubset → per-section dots)
  // even when currentState itself didn't change (#279).
  const [baseline, setBaseline] = useState<string | null>(null)

  useEffect(() => {
    // Capture the baseline once loading has finished.
    if (!loading && baseline === null) {
      setBaseline(JSON.stringify(currentState))
    }
  }, [loading, currentState, baseline])

  useEffect(() => {
    if (baseline === null) return

    setIsDirty(JSON.stringify(currentState) !== baseline)
  }, [currentState, baseline])

  const resetDirty = (newState?: T) => {
    setBaseline(JSON.stringify(newState ?? currentState))
    setIsDirty(false)
  }

  // Whether any of the given top-level keys differ from the captured baseline.
  // Powers per-section dirty indicators (#279) off the same baseline as isDirty;
  // recreated when the baseline resets so the dots clear after a save.
  const getDirtySubset = useCallback(
    (keys: (keyof T)[]): boolean => {
      if (baseline === null) return false
      const parsed = JSON.parse(baseline) as T
      return keys.some((key) => JSON.stringify(currentState[key]) !== JSON.stringify(parsed[key]))
    },
    [currentState, baseline]
  )

  return { isDirty, resetDirty, getDirtySubset }
}
