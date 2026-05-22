import { describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { AppDirtyProvider, useAppDirty } from '../../src/renderer/src/contexts/AppDirtyContext'

interface CapturedState {
  isAnyDirty: boolean
  isSettingsDirty: boolean
  isProfileEditorDirty: boolean
  reportSettingsDirty: (value: boolean) => void
  reportProfileEditorDirty: (scope: string, isDirty: boolean) => void
}

function Probe({ onCapture }: { onCapture: (state: CapturedState) => void }) {
  const dirty = useAppDirty()
  onCapture({
    isAnyDirty: dirty.isAnyDirty,
    isSettingsDirty: dirty.isSettingsDirty,
    isProfileEditorDirty: dirty.isProfileEditorDirty,
    reportSettingsDirty: dirty.reportSettingsDirty,
    reportProfileEditorDirty: dirty.reportProfileEditorDirty
  })
  return null
}

async function renderProbe(): Promise<{
  unmount: () => void
  getState: () => CapturedState
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let captured: CapturedState | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppDirtyProvider>
        <Probe onCapture={(state) => (captured = state)} />
      </AppDirtyProvider>
    )
  })

  return {
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    },
    getState: () => {
      if (!captured) {
        throw new Error('Probe did not capture state')
      }
      return captured
    }
  }
}

describe('AppDirtyProvider aggregator', () => {
  test('isAnyDirty is false by default', async () => {
    const harness = await renderProbe()
    try {
      expect(harness.getState().isAnyDirty).toBe(false)
      expect(harness.getState().isSettingsDirty).toBe(false)
      expect(harness.getState().isProfileEditorDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })

  test('settings dirty signal lifts isAnyDirty (#388)', async () => {
    const harness = await renderProbe()
    try {
      await act(async () => {
        harness.getState().reportSettingsDirty(true)
      })

      expect(harness.getState().isAnyDirty).toBe(true)
      expect(harness.getState().isSettingsDirty).toBe(true)

      await act(async () => {
        harness.getState().reportSettingsDirty(false)
      })

      expect(harness.getState().isAnyDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })

  test('profile editor dirty signal lifts isAnyDirty (#403)', async () => {
    const harness = await renderProbe()
    try {
      await act(async () => {
        harness.getState().reportProfileEditorDirty('ac:default', true)
      })

      expect(harness.getState().isAnyDirty).toBe(true)
      expect(harness.getState().isProfileEditorDirty).toBe(true)

      await act(async () => {
        harness.getState().reportProfileEditorDirty('ac:default', false)
      })

      expect(harness.getState().isAnyDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })

  test('reporting clean for a different scope does not clear an active dirty scope', async () => {
    const harness = await renderProbe()
    try {
      await act(async () => {
        harness.getState().reportProfileEditorDirty('ac:default', true)
      })

      await act(async () => {
        harness.getState().reportProfileEditorDirty('iracing:default', false)
      })

      // The dirty signal for 'ac:default' should still hold the editor dirty
      expect(harness.getState().isAnyDirty).toBe(true)
      expect(harness.getState().isProfileEditorDirty).toBe(true)
    } finally {
      harness.unmount()
    }
  })

  test('both settings and profile dirty keep isAnyDirty true until both clear (#389)', async () => {
    const harness = await renderProbe()
    try {
      await act(async () => {
        harness.getState().reportSettingsDirty(true)
        harness.getState().reportProfileEditorDirty('ac:default', true)
      })

      expect(harness.getState().isAnyDirty).toBe(true)

      await act(async () => {
        harness.getState().reportSettingsDirty(false)
      })

      expect(harness.getState().isAnyDirty).toBe(true)
      expect(harness.getState().isProfileEditorDirty).toBe(true)

      await act(async () => {
        harness.getState().reportProfileEditorDirty('ac:default', false)
      })

      expect(harness.getState().isAnyDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })
})
