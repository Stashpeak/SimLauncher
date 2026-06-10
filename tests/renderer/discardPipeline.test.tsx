/**
 * Regression tests for #478: the App-level discard flow bumps refreshKey
 * (remounting GameList/SettingsProvider) right after requesting discards, so
 * `requestDiscardAll` must AWAIT the registered handlers — GameRow's pending
 * "+" profile cleanup writes to the store, and remounting first reloads the
 * orphan before the delete lands. These tests pin the pipeline contract:
 *   1. requestDiscardAll resolves only after async handler work completes,
 *      profile scope before settings scope.
 *   2. A throwing handler doesn't block the other scope (and still resolves).
 */

import { describe, expect, test, vi } from 'vitest'
import { act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  AppDirtyProvider,
  useAppDirty,
  type DiscardHandler
} from '../../src/renderer/src/contexts/AppDirtyContext'

interface ProbeApi {
  requestDiscardAll: () => Promise<void>
  registerProfileDiscard: (handler: DiscardHandler | null) => void
  registerSettingsDiscard: (handler: DiscardHandler | null) => void
}

function Probe({ onReady }: { onReady: (api: ProbeApi) => void }) {
  const { requestDiscardAll, registerDiscardHandler } = useAppDirty()
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    onReadyRef.current({
      requestDiscardAll,
      registerProfileDiscard: (handler) => registerDiscardHandler('profile-editor', handler),
      registerSettingsDiscard: (handler) => registerDiscardHandler('settings', handler)
    })
  }, [registerDiscardHandler, requestDiscardAll])

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

describe('requestDiscardAll pipeline (#478)', () => {
  test('awaits async profile discard work before resolving; profile runs before settings', async () => {
    const harness = await renderProbe()
    try {
      const order: string[] = []

      await act(async () => {
        harness.getApi().registerProfileDiscard(async () => {
          // Simulates GameRow's discardPendingProfile: store read + write.
          await new Promise((resolve) => setTimeout(resolve, 10))
          order.push('profile')
        })
        harness.getApi().registerSettingsDiscard(() => {
          order.push('settings')
        })
      })

      await act(async () => {
        await harness.getApi().requestDiscardAll()
      })

      expect(order).toEqual(['profile', 'settings'])
    } finally {
      harness.unmount()
    }
  })

  test('a throwing profile discard does not block the settings discard and still resolves', async () => {
    const harness = await renderProbe()
    try {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const settingsDiscard = vi.fn()

      await act(async () => {
        harness.getApi().registerProfileDiscard(() => {
          throw new Error('boom')
        })
        harness.getApi().registerSettingsDiscard(settingsDiscard)
      })

      await act(async () => {
        await harness.getApi().requestDiscardAll()
      })

      expect(settingsDiscard).toHaveBeenCalledTimes(1)
      consoleSpy.mockRestore()
    } finally {
      harness.unmount()
    }
  })

  test('resolves when no handlers are registered', async () => {
    const harness = await renderProbe()
    try {
      await act(async () => {
        await harness.getApi().requestDiscardAll()
      })
    } finally {
      harness.unmount()
    }
  })
})
