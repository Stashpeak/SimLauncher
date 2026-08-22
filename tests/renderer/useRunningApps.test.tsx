/**
 * Push-subscription lifecycle of useRunningApps: the hook drives the entire
 * "what is running" UI (status dots, kill/relaunch controls), so a broken
 * subscribe/unsubscribe cycle either freezes the UI on stale data or leaks
 * main-process subscribers after unmount.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { Game } from '../../src/renderer/src/lib/config'
import {
  useRunningApps,
  type RunningAppsChangedPayload,
  type UseRunningAppsResult
} from '../../src/renderer/src/hooks/useRunningApps'

const getRunningAppsMock = vi.fn()
const subscribeRunningAppsMock = vi.fn()
const unsubscribeRunningAppsMock = vi.fn()
const removeChangeListenerMock = vi.fn()
let changeListener: ((payload: RunningAppsChangedPayload) => void) | null = null

vi.mock('../../src/renderer/src/lib/electron', () => ({
  getRunningApps: (...args: unknown[]) => getRunningAppsMock(...args),
  subscribeRunningApps: (...args: unknown[]) => subscribeRunningAppsMock(...args),
  unsubscribeRunningApps: (...args: unknown[]) => unsubscribeRunningAppsMock(...args),
  onRunningAppsChanged: (listener: (payload: RunningAppsChangedPayload) => void) => {
    changeListener = listener
    return removeChangeListenerMock
  }
}))

const GAMES: Game[] = [
  { key: 'iracing', name: 'iRacing', icon: 'assets/iracing.png' },
  { key: 'acc', name: 'ACC', icon: 'assets/acc.png' }
]

const IRACING_APP = {
  path: 'C:/Games/iRacingUI.exe',
  name: 'iRacingUI.exe',
  gameKey: 'iracing',
  tracked: false
}

function payload(
  apps: RunningAppsChangedPayload['apps'],
  reason: RunningAppsChangedPayload['reason'] = 'scan',
  closableGameKeys: string[] = []
): RunningAppsChangedPayload {
  return { apps, reason, updatedAt: 1, closableGameKeys }
}

function Probe({
  games,
  onCapture
}: {
  games: Game[]
  onCapture: (result: UseRunningAppsResult) => void
}) {
  onCapture(useRunningApps(games))
  return null
}

async function mountProbe(games: Game[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let captured: UseRunningAppsResult | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(<Probe games={games} onCapture={(result) => (captured = result)} />)
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
  changeListener = null
  subscribeRunningAppsMock.mockResolvedValue(payload([], 'initial'))
  unsubscribeRunningAppsMock.mockResolvedValue(undefined)
  getRunningAppsMock.mockResolvedValue([])
})

describe('useRunningApps push-subscription lifecycle', () => {
  test('applies the initial subscription snapshot to apps and per-game status', async () => {
    subscribeRunningAppsMock.mockResolvedValue(payload([IRACING_APP], 'initial'))
    const harness = await mountProbe(GAMES)
    try {
      expect(harness.getResult().runningApps).toEqual([IRACING_APP])
      expect(harness.getResult().runningStatus).toEqual({ iracing: true, acc: false })
    } finally {
      harness.unmount()
    }
  })

  test('push events update the running state without polling', async () => {
    const harness = await mountProbe(GAMES)
    try {
      expect(harness.getResult().runningStatus).toEqual({ iracing: false, acc: false })

      await act(async () => {
        changeListener?.(payload([IRACING_APP], 'launch'))
      })
      expect(harness.getResult().runningStatus).toEqual({ iracing: true, acc: false })

      await act(async () => {
        changeListener?.(payload([], 'exit'))
      })
      expect(harness.getResult().runningApps).toEqual([])
      expect(harness.getResult().runningStatus).toEqual({ iracing: false, acc: false })
    } finally {
      harness.unmount()
    }
  })

  test('falls back to a one-shot poll when the subscription fails', async () => {
    subscribeRunningAppsMock.mockRejectedValue(new Error('ipc broken'))
    getRunningAppsMock.mockResolvedValue([IRACING_APP])

    const harness = await mountProbe(GAMES)
    try {
      expect(harness.getResult().runningStatus).toEqual({ iracing: true, acc: false })
    } finally {
      harness.unmount()
    }
  })

  test('unmount tears down both the renderer listener and the main-process subscription', async () => {
    const harness = await mountProbe(GAMES)

    harness.unmount()

    expect(removeChangeListenerMock).toHaveBeenCalledTimes(1)
    expect(unsubscribeRunningAppsMock).toHaveBeenCalledTimes(1)
  })

  // The one-shot poll answers with apps only, and it is what runs immediately
  // after every kill click and profile switch. Treating that silence as
  // "nothing left to close" would hide the secondary Close Apps control the
  // moment a partial kill failure makes it most needed (#673).
  test('the one-shot refresh leaves the pushed closable set alone', async () => {
    const harness = await mountProbe(GAMES)
    try {
      await act(async () => {
        changeListener?.(payload([IRACING_APP], 'launch', ['iracing']))
      })
      expect(Array.from(harness.getResult().closableGameKeys)).toEqual(['iracing'])

      getRunningAppsMock.mockResolvedValue([IRACING_APP])
      await act(async () => {
        await harness.getResult().refreshRunningState()
      })

      expect(Array.from(harness.getResult().closableGameKeys)).toEqual(['iracing'])
    } finally {
      harness.unmount()
    }
  })

  test('a push with an empty closable set still clears it', async () => {
    const harness = await mountProbe(GAMES)
    try {
      await act(async () => {
        changeListener?.(payload([IRACING_APP], 'launch', ['iracing']))
      })
      expect(harness.getResult().closableGameKeys.size).toBe(1)

      await act(async () => {
        changeListener?.(payload([IRACING_APP], 'kill', []))
      })

      expect(harness.getResult().closableGameKeys.size).toBe(0)
    } finally {
      harness.unmount()
    }
  })

  test('with no configured games it never subscribes and reports empty state', async () => {
    const harness = await mountProbe([])
    try {
      expect(subscribeRunningAppsMock).not.toHaveBeenCalled()
      expect(harness.getResult().runningApps).toEqual([])
      expect(harness.getResult().runningStatus).toEqual({})
    } finally {
      harness.unmount()
    }
  })
})
