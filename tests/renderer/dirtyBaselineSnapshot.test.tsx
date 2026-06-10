/**
 * Regression tests for #480: after the settings store-changed listener
 * reloads state, it must re-baseline via `resetDirty(loadedSnapshot)` — the
 * no-argument form serializes the currentState captured by an earlier
 * render's closure, leaving a phantom diff on whatever the reload changed
 * (the ghost "Utility Apps" dirty dot after every profile save). These tests
 * pin the snapshot contract of useDirtyTracking:
 *   1. resetDirty(snapshot) where snapshot equals the live state → clean,
 *      including per-section subsets.
 *   2. resetDirty(staleSnapshot) that differs from live state → dirty, and
 *      only the differing key's subset reports dirty (the #480 symptom).
 */

import { describe, expect, test } from 'vitest'
import { act, useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDirtyTracking } from '../../src/renderer/src/hooks/useDirtyTracking'

interface TrackedState {
  profiles: Record<string, string>
  gamePaths: Record<string, string>
}

interface ProbeApi {
  isDirty: boolean
  profilesSubsetDirty: boolean
  gamePathsSubsetDirty: boolean
  setState: (next: TrackedState) => void
  resetDirty: (snapshot?: TrackedState) => void
}

function Probe({ onRender }: { onRender: (api: ProbeApi) => void }) {
  const [state, setState] = useState<TrackedState>({
    profiles: { iracing: 'Default' },
    gamePaths: { iracing: 'C:/iracing.exe' }
  })
  const { isDirty, resetDirty, getDirtySubset } = useDirtyTracking(state, false)
  const onRenderRef = useRef(onRender)
  onRenderRef.current = onRender

  // getDirtySubset/resetDirty are recreated whenever state or the baseline
  // change, so these deps re-publish fresh values after every update.
  useEffect(() => {
    onRenderRef.current({
      isDirty,
      profilesSubsetDirty: getDirtySubset(['profiles']),
      gamePathsSubsetDirty: getDirtySubset(['gamePaths']),
      setState,
      resetDirty
    })
  }, [isDirty, getDirtySubset, resetDirty])

  return null
}

async function renderProbe(): Promise<{ unmount: () => void; getApi: () => ProbeApi }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let captured: ProbeApi | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(<Probe onRender={(api) => (captured = api)} />)
  })

  if (!captured) {
    throw new Error('Probe did not initialize')
  }

  return {
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    },
    getApi: () => {
      if (!captured) {
        throw new Error('Probe did not capture state')
      }
      return captured
    }
  }
}

describe('useDirtyTracking snapshot re-baseline (#480)', () => {
  test('resetDirty(snapshot) matching the live state clears dirty and subsets', async () => {
    const harness = await renderProbe()
    try {
      const reloaded: TrackedState = {
        profiles: { iracing: 'Default', acc: 'New Profile' },
        gamePaths: { iracing: 'C:/iracing.exe' }
      }

      // Simulates the store-changed reload: state updates, then the listener
      // re-baselines from the exact snapshot it just loaded.
      await act(async () => {
        harness.getApi().setState(reloaded)
      })
      expect(harness.getApi().isDirty).toBe(true)

      await act(async () => {
        harness.getApi().resetDirty(reloaded)
      })

      expect(harness.getApi().isDirty).toBe(false)
      expect(harness.getApi().profilesSubsetDirty).toBe(false)
      expect(harness.getApi().gamePathsSubsetDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })

  test('a stale snapshot leaves exactly the differing key dirty (the #480 symptom)', async () => {
    const harness = await renderProbe()
    try {
      const reloaded: TrackedState = {
        profiles: { iracing: 'Default', acc: 'New Profile' },
        gamePaths: { iracing: 'C:/iracing.exe' }
      }
      const staleSnapshot: TrackedState = {
        profiles: { iracing: 'Default' },
        gamePaths: { iracing: 'C:/iracing.exe' }
      }

      await act(async () => {
        harness.getApi().setState(reloaded)
      })
      await act(async () => {
        harness.getApi().resetDirty(staleSnapshot)
      })

      // Baseline poisoned by the stale closure: profiles differ, gamePaths
      // don't — the phantom dot appears on exactly one section.
      expect(harness.getApi().isDirty).toBe(true)
      expect(harness.getApi().profilesSubsetDirty).toBe(true)
      expect(harness.getApi().gamePathsSubsetDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })
})
