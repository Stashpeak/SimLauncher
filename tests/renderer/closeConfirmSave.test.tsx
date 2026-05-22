/**
 * Regression test for Codex P1 finding (#404):
 * `handleCloseConfirmSave` previously called `forceClose()` after
 * `requestSaveAll()` resolved, but the underlying settings save path swallows
 * persistence errors. A failed write would silently close the window and
 * destroy unsaved changes. The fix threads success/failure back from
 * `requestSaveAll()`; this test pins that contract by mocking a failing save
 * handler and asserting that:
 *   1. `forceClose` is NOT invoked, and
 *   2. an error toast is fired via `useNotify`.
 */

import { describe, expect, test, vi, beforeEach } from 'vitest'
import { act, useCallback, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const forceCloseMock = vi.fn(async () => undefined)
const notifyMock = vi.fn()

vi.mock('../../src/renderer/src/lib/electron', () => ({
  forceClose: () => forceCloseMock()
}))

// Avoid rendering the real toast portal — jsdom does not implement
// Element.animate, which Notify.tsx invokes during mount. We only need
// `useNotify().notify` to be observable.
vi.mock('../../src/renderer/src/components/Notify', () => {
  return {
    useNotify: () => ({ notify: notifyMock }),
    NotifyProvider: ({ children }: { children: React.ReactNode }) => children
  }
})

import { AppDirtyProvider, useAppDirty } from '../../src/renderer/src/contexts/AppDirtyContext'
import { useNotify } from '../../src/renderer/src/components/Notify'
import { forceClose } from '../../src/renderer/src/lib/electron'

interface ProbeApi {
  triggerCloseConfirmSave: () => Promise<void>
  registerSettingsSave: (handler: () => Promise<boolean> | boolean) => void
}

function Probe({ onReady }: { onReady: (api: ProbeApi) => void }) {
  const { registerSaveHandler, requestSaveAll } = useAppDirty()
  const { notify } = useNotify()
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  const triggerCloseConfirmSave = useCallback(async () => {
    let success: boolean
    try {
      success = await requestSaveAll()
    } catch (err) {
      console.error('Failed to save before close', err)
      success = false
    }
    if (!success) {
      notify('Failed to save changes. Window not closed.', 'error', 4000)
      return
    }
    await forceClose()
  }, [notify, requestSaveAll])

  useEffect(() => {
    onReadyRef.current({
      triggerCloseConfirmSave,
      registerSettingsSave: (handler) => registerSaveHandler('settings', handler)
    })
  }, [registerSaveHandler, triggerCloseConfirmSave])

  return null
}

async function renderProbe(): Promise<{ unmount: () => void; getApi: () => ProbeApi }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let captured: ProbeApi | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppDirtyProvider>
        <Probe onReady={(api) => (captured = api)} />
      </AppDirtyProvider>
    )
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

describe('handleCloseConfirmSave failure propagation (#404)', () => {
  beforeEach(() => {
    forceCloseMock.mockClear()
    notifyMock.mockClear()
  })

  test('does NOT call forceClose when the save handler returns false; fires error notify', async () => {
    const harness = await renderProbe()
    try {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const failingSave = vi.fn(async () => false)

      await act(async () => {
        harness.getApi().registerSettingsSave(failingSave)
      })

      await act(async () => {
        await harness.getApi().triggerCloseConfirmSave()
      })

      expect(failingSave).toHaveBeenCalledTimes(1)
      expect(forceCloseMock).not.toHaveBeenCalled()
      expect(notifyMock).toHaveBeenCalledWith(
        'Failed to save changes. Window not closed.',
        'error',
        4000
      )
      consoleSpy.mockRestore()
    } finally {
      harness.unmount()
    }
  })

  test('does NOT call forceClose when the save handler throws', async () => {
    const harness = await renderProbe()
    try {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const throwingSave = vi.fn(async () => {
        throw new Error('disk write failed')
      })

      await act(async () => {
        harness.getApi().registerSettingsSave(throwingSave)
      })

      await act(async () => {
        await harness.getApi().triggerCloseConfirmSave()
      })

      expect(throwingSave).toHaveBeenCalledTimes(1)
      expect(forceCloseMock).not.toHaveBeenCalled()
      expect(notifyMock).toHaveBeenCalledWith(
        'Failed to save changes. Window not closed.',
        'error',
        4000
      )
      consoleSpy.mockRestore()
    } finally {
      harness.unmount()
    }
  })

  test('DOES call forceClose when every save handler returns true', async () => {
    const harness = await renderProbe()
    try {
      const successfulSave = vi.fn(async () => true)

      await act(async () => {
        harness.getApi().registerSettingsSave(successfulSave)
      })

      await act(async () => {
        await harness.getApi().triggerCloseConfirmSave()
      })

      expect(successfulSave).toHaveBeenCalledTimes(1)
      expect(forceCloseMock).toHaveBeenCalledTimes(1)
      expect(notifyMock).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })
})
