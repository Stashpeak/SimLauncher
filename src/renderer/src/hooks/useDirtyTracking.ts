import { useEffect, useRef, useState } from 'react'

/**
 * A simple hook to track if a state object has changed from its initial value.
 * Optimized for Settings and Profile data structures.
 */
export function useDirtyTracking<T>(currentState: T, loading: boolean = false) {
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

  return { isDirty, resetDirty }
}
