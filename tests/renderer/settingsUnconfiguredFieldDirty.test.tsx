/**
 * Regression tests for #958: the store never persists an empty-string entry
 * for a custom arg or a game path (the main-process sanitizers drop one), but
 * the renderer's record setters write the key unconditionally. Typing into a
 * never-configured field and clearing it again left a `{"key":""}` entry the
 * `{}` baseline never had, so the whole-snapshot JSON compare in
 * useDirtyTracking never cleared, the sticky save bar stayed up, and the
 * per-section dot (getDirtySubset) stayed lit too.
 *
 * Exercises useSettingsState's currentSettingsState memo directly (rather
 * than the full SettingsProvider) because that memo is exactly where the fix
 * belongs: both isDirty and getDirtySubset derive from the same normalized
 * snapshot, so a fix here covers both without touching useDirtyTracking
 * itself (which useProfileEditor also relies on, and which has no analogous
 * bug - see #958's own reasoning for not fixing it there).
 */

import { describe, expect, test } from 'vitest'
import { act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useSettingsState } from '../../src/renderer/src/components/settings/useSettingsState'
import { useDirtyTracking } from '../../src/renderer/src/hooks/useDirtyTracking'

interface ProbeApi {
  isDirty: boolean
  appsSubsetDirty: boolean
  gamesSubsetDirty: boolean
  setAppArgs: (updater: (current: Record<string, string>) => Record<string, string>) => void
  setGamePaths: (updater: (current: Record<string, string>) => Record<string, string>) => void
  setLoading: (loading: boolean) => void
}

function Probe({ onRender }: { onRender: (api: ProbeApi) => void }) {
  const {
    state: { loading },
    setters,
    currentSettingsState
  } = useSettingsState()
  // Mirrors SettingsContext.tsx: the dirty baseline is only captured once
  // loading flips false, exactly like the real SettingsProvider.
  const { isDirty, getDirtySubset } = useDirtyTracking(currentSettingsState, loading)
  const onRenderRef = useRef(onRender)
  onRenderRef.current = onRender

  useEffect(() => {
    onRenderRef.current({
      isDirty,
      appsSubsetDirty: getDirtySubset(['appArgs']),
      gamesSubsetDirty: getDirtySubset(['gamePaths']),
      setAppArgs: setters.setAppArgs,
      setGamePaths: setters.setGamePaths,
      setLoading: setters.setLoading
    })
  }, [isDirty, getDirtySubset, setters])

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

describe('unconfigured field dirty state (#958)', () => {
  test('typing into and clearing an unconfigured custom-args field leaves no dirty state', async () => {
    const harness = await renderProbe()
    try {
      await act(async () => {
        harness.getApi().setLoading(false)
      })
      expect(harness.getApi().isDirty).toBe(false)

      await act(async () => {
        harness.getApi().setAppArgs((prev) => ({ ...prev, customapp1: '-novid' }))
      })
      expect(harness.getApi().isDirty).toBe(true)
      expect(harness.getApi().appsSubsetDirty).toBe(true)

      await act(async () => {
        harness.getApi().setAppArgs((prev) => ({ ...prev, customapp1: '' }))
      })

      expect(harness.getApi().isDirty).toBe(false)
      expect(harness.getApi().appsSubsetDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })

  test('typing into and clearing an unconfigured game path leaves no dirty state', async () => {
    const harness = await renderProbe()
    try {
      await act(async () => {
        harness.getApi().setLoading(false)
      })
      expect(harness.getApi().isDirty).toBe(false)

      await act(async () => {
        harness.getApi().setGamePaths((prev) => ({ ...prev, iracing: 'C:/iRacing.exe' }))
      })
      expect(harness.getApi().isDirty).toBe(true)
      expect(harness.getApi().gamesSubsetDirty).toBe(true)

      await act(async () => {
        harness.getApi().setGamePaths((prev) => ({ ...prev, iracing: '' }))
      })

      expect(harness.getApi().isDirty).toBe(false)
      expect(harness.getApi().gamesSubsetDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })
})
