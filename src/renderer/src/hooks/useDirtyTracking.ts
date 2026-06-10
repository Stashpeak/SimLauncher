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
  // even when currentState itself didn't change (#279). Wrapped in an object so
  // every reset has a fresh identity: resetting to a string EQUAL to the
  // previous baseline would otherwise bail out of the state update, skip the
  // comparison effect, and leave the forced `isDirty=false` inconsistent with
  // what getDirtySubset derives at render time (#480 — the ghost section dot
  // with no save bar).
  const [baseline, setBaseline] = useState<{ json: string } | null>(null)

  useEffect(() => {
    // Capture the baseline once loading has finished.
    if (!loading && baseline === null) {
      setBaseline({ json: JSON.stringify(currentState) })
    }
  }, [loading, currentState, baseline])

  useEffect(() => {
    if (baseline === null) return

    setIsDirty(JSON.stringify(currentState) !== baseline.json)
  }, [currentState, baseline])

  // Memoized so long-lived subscribers (the settings store-changed listener)
  // don't resubscribe every render; prefer passing the explicit snapshot —
  // the currentState fallback reflects the render this callback was created
  // in, which can lag behind freshly-loaded state (#480).
  const resetDirty = useCallback(
    (newState?: T) => {
      // Optimistically clear; the comparison effect re-derives against the
      // committed state right after (the fresh baseline identity guarantees it
      // runs), so a baseline that doesn't actually match stays visibly dirty.
      setBaseline({ json: JSON.stringify(newState ?? currentState) })
      setIsDirty(false)
    },
    [currentState]
  )

  // Whether any of the given top-level keys differ from the captured baseline.
  // Powers per-section dirty indicators (#279) off the same baseline as isDirty;
  // recreated when the baseline resets so the dots clear after a save.
  const getDirtySubset = useCallback(
    (keys: (keyof T)[]): boolean => {
      if (baseline === null) return false
      const parsed = JSON.parse(baseline.json) as T
      return keys.some((key) => JSON.stringify(currentState[key]) !== JSON.stringify(parsed[key]))
    },
    [currentState, baseline]
  )

  return { isDirty, resetDirty, getDirtySubset }
}
