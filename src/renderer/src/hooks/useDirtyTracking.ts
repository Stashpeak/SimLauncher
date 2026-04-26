import { useEffect, useRef, useState } from 'react'

/**
 * A simple hook to track if a state object has changed from its initial value.
 * Optimized for Settings and Profile data structures.
 */
export function useDirtyTracking<T>(currentState: T, loading: boolean = false) {
  const [isDirty, setIsDirty] = useState(false)
  const initialState = useRef<T | null>(null)

  useEffect(() => {
    // Capture initial state once loading is finished
    if (!loading && initialState.current === null) {
      initialState.current = JSON.parse(JSON.stringify(currentState))
    }
  }, [loading, currentState])

  useEffect(() => {
    if (initialState.current === null) return

    const currentStr = JSON.stringify(currentState)
    const initialStr = JSON.stringify(initialState.current)

    setIsDirty(currentStr !== initialStr)
  }, [currentState])

  const resetDirty = (newState?: T) => {
    initialState.current = JSON.parse(JSON.stringify(newState ?? currentState))
    setIsDirty(false)
  }

  return { isDirty, resetDirty }
}
