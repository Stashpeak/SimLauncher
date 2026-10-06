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
 *   means, and the two toggles are unavailable the way auto-close already was.
 *
 * Each row shows a short line and carries the full reason as a tooltip and as
 * its accessible description. An unavailable row is in the #830 shape:
 * focusable and hoverable so that tooltip can open, but it never toggles.
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

const onKillChange = vi.fn()
const onRelaunchChange = vi.fn()
const onCloseOnExitChange = vi.fn()

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  onKillChange.mockClear()
  onRelaunchChange.mockClear()
  onCloseOnExitChange.mockClear()
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
      onCloseAppsOnGameExitChange={onCloseOnExitChange}
    />
  )
}

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

// The short line is what the row shows; the full reason is its description.
function expectCopy(element: HTMLElement, sublabel: string, tooltip: string): void {
  expect(element.textContent).toContain(sublabel)
  expect(element.getAttribute('aria-description')).toBe(tooltip)
}

async function focusAndReadTooltip(element: HTMLElement): Promise<string | null> {
  await act(async () => {
    element.focus()
  })
  return document.body.querySelector('[role="tooltip"]')?.textContent ?? null
}

async function press(element: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

const AUTO_CLOSE_TOOLTIP =
  "Closes this profile's apps after SimLauncher has watched the game run for at least 2 minutes and then seen it exit. It waits 15 seconds first so tools like Garage61 can finish uploading."
const TRACKING_REQUIRED_TOOLTIP =
  'Turn on "Track running indicator for this game" above. Without it SimLauncher cannot see what is running.'

describe('auto-close states its real timing (#945)', () => {
  test('short line and full reason both carry the two-minute floor and the 15 second wait', async () => {
    await render(behaviorSection(true))
    const autoClose = row('Close apps when the game exits')
    expectCopy(autoClose, 'After 2 min, waits 15 s', AUTO_CLOSE_TOOLTIP)
    expect(await focusAndReadTooltip(autoClose)).toBe(AUTO_CLOSE_TOOLTIP)
  })
})

describe('process tracking says what it gates (#836)', () => {
  test('on: the tracking toggle says what it is needed for', async () => {
    await render(behaviorSection(true))
    expectCopy(
      row('Track running indicator for this game'),
      'Needed to close and switch apps',
      'Close Apps, relaunch, auto-close and the app swap on a profile switch all need SimLauncher to see what is running.'
    )
  })

  test("off: the tracking toggle says the apps are the user's to manage", async () => {
    await render(behaviorSection(false))
    const tracking = row('Track running indicator for this game')
    expectCopy(
      tracking,
      'Off: you manage the apps',
      "SimLauncher is not watching this game. Switching profiles leaves running apps alone, and Close Apps and relaunch are not offered. Launch still starts the profile's apps."
    )
    // The tracking toggle itself is never the one made unavailable.
    expect(tracking.getAttribute('aria-disabled')).toBeNull()
  })

  test('off: every dependent toggle is unavailable, keeps its name and value, and says why', async () => {
    await render(
      <>
        {behaviorSection(false)}
        {trackingSection(false)}
      </>
    )
    for (const [label, checked] of [
      ['Close apps when the game exits', 'true'],
      ['Allow close apps controls', 'true'],
      ['Allow relaunch controls', 'false']
    ] as const) {
      const toggle = row(label)
      expect(toggle.getAttribute('aria-disabled')).toBe('true')
      expect(toggle.getAttribute('aria-label')).toBe(label)
      expect(toggle.getAttribute('aria-checked')).toBe(checked)
      expectCopy(toggle, 'Needs tracking', TRACKING_REQUIRED_TOOLTIP)
    }
  })

  // The reason a dimmed row used to be unreachable: pointer-events-none and
  // tabIndex -1 meant neither hover nor Tab could open anything on it.
  test('off: a dimmed toggle can be reached by Tab and shows why, but never toggles', async () => {
    await render(trackingSection(false))
    const kill = row('Allow close apps controls')
    expect(kill.tabIndex).toBe(0)
    expect(await focusAndReadTooltip(kill)).toBe(TRACKING_REQUIRED_TOOLTIP)
    expect(document.activeElement).toBe(kill)

    await act(async () => {
      kill.click()
    })
    await press(kill, ' ')
    await press(kill, 'Enter')
    expect(onKillChange).not.toHaveBeenCalled()
  })

  test('on: close and relaunch controls work and carry no tracking note', async () => {
    await render(trackingSection(true))
    const kill = row('Allow close apps controls')
    expect(kill.getAttribute('aria-disabled')).toBeNull()
    expect(kill.getAttribute('aria-description')).toBeNull()
    expect(kill.textContent).not.toContain('Needs tracking')
    await act(async () => {
      kill.click()
    })
    await press(kill, ' ')
    expect(onKillChange).toHaveBeenCalledTimes(2)
  })
})
