/**
 * #945 and #836: the profile editor says what process tracking and auto-close
 * actually do, and controls that do nothing without tracking say so.
 *
 * - #945: the auto-close sublabel said "a few seconds" for a 15 s wait and
 *   never mentioned the two-minute session floor, so a quick test of the
 *   toggle looked broken. The numbers now come from the values main runs on;
 *   the literal strings below pin what the user reads.
 * - #836: turning tracking off made a profile switch silently leave every app
 *   as it was, and left "Allow close apps controls" and "Allow relaunch
 *   controls" settable but meaningless. The tracking toggle now says what off
 *   means, and the two toggles are disabled the way auto-close already was,
 *   keeping their accessible name and stored value (#762, #801).
 */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ProfileBehaviorSection } from '../../src/renderer/src/components/profile-editor/ProfileBehaviorSection'
import { ProcessTrackingSection } from '../../src/renderer/src/components/profile-editor/ProcessTrackingSection'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let container: HTMLDivElement
let root: Root | null = null

async function render(node: ReactNode): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(node)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  onKillChange.mockClear()
  onRelaunchChange.mockClear()
})

function row(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`)
  if (!found) throw new Error(`No "${label}" switch`)
  return found
}

function behaviorSection(trackingEnabled: boolean): ReactNode {
  return (
    <ProfileBehaviorSection
      launchAutomatically
      gamePosition="first"
      trackingEnabled={trackingEnabled}
      closeAppsOnGameExit
      onLaunchAutomaticallyChange={vi.fn()}
      onGamePositionChange={vi.fn()}
      onTrackingEnabledChange={vi.fn()}
      onCloseAppsOnGameExitChange={vi.fn()}
    />
  )
}

const onKillChange = vi.fn()
const onRelaunchChange = vi.fn()

function trackingSection(trackingEnabled: boolean): ReactNode {
  return (
    <ProcessTrackingSection
      trackingEnabled={trackingEnabled}
      killControlsEnabled
      relaunchControlsEnabled={false}
      trackedProcessPaths={[]}
      onKillControlsEnabledChange={onKillChange}
      onRelaunchControlsEnabledChange={onRelaunchChange}
      onAddTrackedProcess={vi.fn()}
      onBrowseTrackedProcess={vi.fn()}
      onRemoveTrackedProcess={vi.fn()}
      onTrackedProcessPathChange={vi.fn()}
    />
  )
}

describe('auto-close states its real timing (#945)', () => {
  test('the sublabel names the two-minute floor and the 15 second wait', async () => {
    await render(behaviorSection(true))
    const autoClose = row('Close apps when the game exits')
    expect(autoClose.getAttribute('aria-description')).toBe(
      'After watching 2+ minutes of play, waits 15 s so tools can save'
    )
    expect(autoClose.textContent).toContain(
      'After watching 2+ minutes of play, waits 15 s so tools can save'
    )
  })
})

describe('process tracking says what it gates (#836)', () => {
  test('on: the tracking toggle says what it is needed for', async () => {
    await render(behaviorSection(true))
    expect(row('Track running indicator for this game').getAttribute('aria-description')).toBe(
      'Needed to close, relaunch and switch apps'
    )
  })

  test('off: the tracking toggle says a profile switch leaves apps alone', async () => {
    await render(behaviorSection(false))
    const tracking = row('Track running indicator for this game')
    expect(tracking.getAttribute('aria-description')).toBe(
      'Off: switching profiles leaves apps running'
    )
    // The tracking toggle itself is never the one disabled.
    expect(tracking.getAttribute('aria-disabled')).toBeNull()
  })

  test('off: close and relaunch controls are unavailable, keep their name and value, and say why', async () => {
    await render(trackingSection(false))
    for (const [label, checked] of [
      ['Allow close apps controls', 'true'],
      ['Allow relaunch controls', 'false']
    ] as const) {
      const toggle = row(label)
      expect(toggle.getAttribute('aria-disabled')).toBe('true')
      expect(toggle.getAttribute('aria-label')).toBe(label)
      expect(toggle.getAttribute('aria-description')).toBe('Needs the running indicator above')
      expect(toggle.getAttribute('aria-checked')).toBe(checked)
      await act(async () => {
        toggle.click()
      })
    }
    expect(onKillChange).not.toHaveBeenCalled()
    expect(onRelaunchChange).not.toHaveBeenCalled()
  })

  test('on: close and relaunch controls work and carry no tracking note', async () => {
    await render(trackingSection(true))
    const kill = row('Allow close apps controls')
    expect(kill.getAttribute('aria-disabled')).toBeNull()
    expect(kill.getAttribute('aria-description')).toBeNull()
    await act(async () => {
      kill.click()
    })
    expect(onKillChange).toHaveBeenCalledTimes(1)
  })
})
