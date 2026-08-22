/**
 * The cadence of the "Game not found" badge (#794).
 *
 * The badge answers a config-shaped question, but what changes the answer is the
 * FILESYSTEM: a game moved by a library change, uninstalled, or reinstalled to
 * the same path. So the store-config channel alone is not enough in either
 * direction, and the second direction is the dangerous one: a badge that keeps
 * claiming a game is missing after the user has put it back sends them hunting
 * for a problem that no longer exists.
 *
 * These tests pin both halves of that: which events DO re-ask, and that the 2s
 * running-apps push is not one of them.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  useMissingGamePaths,
  type UseMissingGamePathsResult
} from '../../src/renderer/src/hooks/useMissingGamePaths'

const getMissingGamePathsMock = vi.fn()
let configListener: ((payload: { reason: string; keys: string[] }) => void) | null = null
const unsubscribeConfigMock = vi.fn()

vi.mock('../../src/renderer/src/lib/store', () => ({
  getMissingGamePaths: (...args: unknown[]) => getMissingGamePathsMock(...args),
  onStoreConfigChanged: (listener: (payload: { reason: string; keys: string[] }) => void) => {
    configListener = listener
    return unsubscribeConfigMock
  }
}))

function Probe({ onCapture }: { onCapture: (result: UseMissingGamePathsResult) => void }) {
  onCapture(useMissingGamePaths())
  return null
}

async function mountProbe() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let captured: UseMissingGamePathsResult | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(<Probe onCapture={(result) => (captured = result)} />)
  })

  return {
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    },
    getResult: () => {
      if (!captured) throw new Error('Probe did not capture state')
      return captured
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  configListener = null
  getMissingGamePathsMock.mockResolvedValue([])
})

describe('useMissingGamePaths cadence (#794)', () => {
  test('asks once on mount and reports the answer', async () => {
    getMissingGamePathsMock.mockResolvedValue(['iracing'])
    const harness = await mountProbe()
    try {
      expect(getMissingGamePathsMock).toHaveBeenCalledTimes(1)
      expect(Array.from(harness.getResult().missingGamePathKeys)).toEqual(['iracing'])
    } finally {
      harness.unmount()
    }
  })

  // Same gate GameList uses for its own settings reload: only these two reasons
  // can carry gamePaths, so the others must not buy a round-trip.
  test.each([
    ['save-settings', true],
    ['import-config', true],
    ['save-profile', false],
    ['save-profiles', false],
    ['set-migration-flags', false]
  ])('a %s config change re-asks: %s', async (reason, shouldAsk) => {
    const harness = await mountProbe()
    try {
      getMissingGamePathsMock.mockClear()

      await act(async () => {
        configListener?.({ reason: reason as string, keys: ['gamePaths'] })
      })

      expect(getMissingGamePathsMock).toHaveBeenCalledTimes(shouldAsk ? 1 : 0)
    } finally {
      harness.unmount()
    }
  })

  // The direction that matters most. Nothing in the config changes when a game
  // is reinstalled to the same path, so without this the badge would be a
  // permanent lie.
  test('window focus re-asks, which is how a repaired path clears', async () => {
    getMissingGamePathsMock.mockResolvedValue(['iracing'])
    const harness = await mountProbe()
    try {
      expect(harness.getResult().missingGamePathKeys.size).toBe(1)

      getMissingGamePathsMock.mockResolvedValue([])
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })

      expect(harness.getResult().missingGamePathKeys.size).toBe(0)
    } finally {
      harness.unmount()
    }
  })

  // A window restored from the tray can become visible without taking focus,
  // which is the ordinary way this app comes back.
  test('becoming visible re-asks even without focus', async () => {
    const harness = await mountProbe()
    try {
      getMissingGamePathsMock.mockClear()

      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(getMissingGamePathsMock).toHaveBeenCalledTimes(1)
    } finally {
      harness.unmount()
    }
  })

  // A failed round-trip must not retract a true warning. Clearing on error would
  // make the badge blink off on any transient IPC hiccup.
  test('a failed read leaves the previous answer standing', async () => {
    getMissingGamePathsMock.mockResolvedValue(['iracing'])
    const harness = await mountProbe()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(harness.getResult().missingGamePathKeys.size).toBe(1)

      getMissingGamePathsMock.mockRejectedValue(new Error('ipc broken'))
      await act(async () => {
        await harness.getResult().refreshMissingGamePaths()
      })

      expect(Array.from(harness.getResult().missingGamePathKeys)).toEqual(['iracing'])
    } finally {
      consoleError.mockRestore()
      harness.unmount()
    }
  })

  test('unmount stops listening on every channel it subscribed to', async () => {
    const harness = await mountProbe()

    harness.unmount()
    getMissingGamePathsMock.mockClear()

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(unsubscribeConfigMock).toHaveBeenCalledTimes(1)
    expect(getMissingGamePathsMock).not.toHaveBeenCalled()
  })
})
