/**
 * Contract for the launch-block cooldown's settled cue (#541).
 *
 * onLaunchSettled drives the screen-reader "X is now running" announcement, so
 * it must fire ONLY for a fresh primary launch that actually held a cooldown —
 * never for a profile switch / relaunch-missing (which reuse the same cooldown
 * while the game is already running), never when no apps started, and never once
 * a newer launch has pre-empted the cooldown.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  useLaunchBlock,
  type UseLaunchBlockResult
} from '../../src/renderer/src/hooks/useLaunchBlock'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let api: UseLaunchBlockResult | null = null
const onLaunchSettled = vi.fn()

function Harness(): null {
  api = useLaunchBlock({ onLaunchSettled })
  return null
}

let container: HTMLDivElement
let root: Root | null = null

beforeEach(async () => {
  vi.useFakeTimers()
  onLaunchSettled.mockClear()
  api = null
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<Harness />)
  })
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('useLaunchBlock onLaunchSettled (#541)', () => {
  test('fires once, with the game key, after a primary launch cooldown lapses', () => {
    act(() => api!.handleLaunchStart('iracing'))
    act(() => api!.handleLaunchEnd('iracing', 10000, { primaryLaunch: true }))
    expect(onLaunchSettled).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(10000))
    expect(onLaunchSettled).toHaveBeenCalledTimes(1)
    expect(onLaunchSettled).toHaveBeenCalledWith('iracing')
  })

  test('does not fire when no cooldown ran (no apps started)', () => {
    act(() => api!.handleLaunchStart('iracing'))
    act(() => api!.handleLaunchEnd('iracing', 0, { primaryLaunch: true }))
    act(() => vi.advanceTimersByTime(60000))
    expect(onLaunchSettled).not.toHaveBeenCalled()
  })

  test('does not fire for non-primary flows (profile switch / relaunch-missing)', () => {
    act(() => api!.handleLaunchStart('iracing'))
    act(() => api!.handleLaunchEnd('iracing', 10000))
    act(() => vi.advanceTimersByTime(10000))
    expect(onLaunchSettled).not.toHaveBeenCalled()
  })

  test('does not fire when a newer launch pre-empts the cooldown', () => {
    act(() => api!.handleLaunchStart('iracing'))
    act(() => api!.handleLaunchEnd('iracing', 10000, { primaryLaunch: true }))
    act(() => vi.advanceTimersByTime(5000))
    act(() => api!.handleLaunchStart('acc'))
    act(() => vi.advanceTimersByTime(10000))
    expect(onLaunchSettled).not.toHaveBeenCalled()
  })
})
