/**
 * Regression test for #1005 (toggling a companion in the profile editor with
 * the keyboard drops focus to <body>).
 *
 * ProfileUtilitiesSection renders enabled and disabled companions in two
 * separate parent grids (one column enabled, two columns + a border
 * disabled). Flipping a switch moves its row from one grid to the other, so
 * React unmounts the old row and mounts a new one in the other grid instead
 * of reusing the DOM node, and the focused checkbox is destroyed along with
 * it. React only restores focus to an element still in the document, so
 * nothing brought it back before this fix.
 *
 * The fix re-focuses the switch by its stable `utility-toggle-${key}` id,
 * which the NEW row's switch carries too, once React has committed the move
 * (option 1 from the issue).
 */

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ProfileUtilitiesSection } from '../../src/renderer/src/components/profile-editor/ProfileUtilitiesSection'
import type { ProfileUtility, Utility } from '../../src/renderer/src/lib/config'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const UTILITIES: Utility[] = [
  { key: 'tracktitan', name: 'Track Titan' },
  { key: 'secondmonitor', name: 'Second Monitor' },
  { key: 'customapp1', name: 'Custom App 1', isCustom: true }
]

type SectionProps = Parameters<typeof ProfileUtilitiesSection>[0]

function buildProps(overrides: Partial<SectionProps>): SectionProps {
  return {
    appPaths: {},
    appNames: {},
    appIconCache: {},
    utilityIcons: {},
    failedIcons: {},
    fetchingIcons: false,
    dragUtilityId: null,
    dropTarget: null,
    utilityByKey: new Map(UTILITIES.map((utility) => [utility.key, utility])),
    availableUtilities: UTILITIES,
    enabledUtilityEntries: [],
    disabledUtilityEntries: [],
    onToggleUtility: vi.fn(),
    onMoveEnabledUtility: vi.fn(),
    onStartUtilityDrag: vi.fn(),
    onDropTargetChange: vi.fn(),
    onDragUtilityIdChange: vi.fn(),
    onIconFailed: vi.fn(),
    ...overrides
  }
}

// Owns the enabled/disabled split as real state, the way useProfileEditor's
// handleToggleUtility does: the focus question only exists once React has
// actually moved the row between grids and re-rendered.
function StatefulHarness({ props }: { props: SectionProps }): ReactNode {
  const [entries, setEntries] = useState<ProfileUtility[]>(
    UTILITIES.map((utility) => ({ id: utility.key, enabled: true }))
  )

  return (
    <ProfileUtilitiesSection
      {...props}
      enabledUtilityEntries={entries.filter((entry) => entry.enabled)}
      disabledUtilityEntries={entries.filter((entry) => !entry.enabled)}
      onToggleUtility={(key) =>
        setEntries((current) =>
          current.map((entry) => (entry.id === key ? { ...entry, enabled: !entry.enabled } : entry))
        )
      }
    />
  )
}

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
})

function toggleSwitch(key: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#utility-toggle-${key}`)
  if (!input) throw new Error(`No toggle switch found for "${key}"`)
  return input
}

// Space on a focused checkbox reaches React as this click; jsdom does not
// synthesize it from the key event, so the test dispatches it directly. The
// fix's refocus is deferred to the next animation frame (matching
// useProfileMenu.ts's focusTrigger), so the test waits one out too.
async function pressAndSettle(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.click()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

describe('ProfileUtilitiesSection companion toggle focus (#1005)', () => {
  test('toggling a focused switch off keeps focus on that companion, now in the disabled grid', async () => {
    await render(<StatefulHarness props={buildProps({})} />)

    const switchEl = toggleSwitch('secondmonitor')
    switchEl.focus()
    expect(document.activeElement).toBe(switchEl)

    await pressAndSettle(switchEl)

    const movedSwitch = toggleSwitch('secondmonitor')
    expect(movedSwitch.checked).toBe(false)
    // The bug: React unmounted the old row (now a different DOM node) and
    // nothing brought focus back on main, so this is what fails without the
    // fix (document.activeElement lands on <body>).
    expect(document.activeElement).toBe(movedSwitch)
    expect(container.contains(document.activeElement)).toBe(true)
  })

  test('toggling a focused switch back on keeps focus on that companion, back in the enabled grid', async () => {
    await render(<StatefulHarness props={buildProps({})} />)

    // Turn it off first (unfocused), then focus it in the disabled grid and
    // toggle it back on, to cover the opposite direction (#1005 was reported
    // for "either direction"). Settling this setup click (not just an act())
    // matters: an un-settled refocus rAF from it would otherwise leak into
    // the assertion below and mask a broken disabled-grid refocus.
    await pressAndSettle(toggleSwitch('secondmonitor'))

    const disabledSwitch = toggleSwitch('secondmonitor')
    disabledSwitch.focus()
    expect(document.activeElement).toBe(disabledSwitch)

    await pressAndSettle(disabledSwitch)

    const movedSwitch = toggleSwitch('secondmonitor')
    expect(movedSwitch.checked).toBe(true)
    expect(document.activeElement).toBe(movedSwitch)
    expect(container.contains(document.activeElement)).toBe(true)
  })

  // Pins the current call shape so a change shows up as a deliberate diff
  // instead of silent drift, the way the three existing focus-restore tests
  // this file's sibling comment names do (gameRowProfileMenuConfirmClose,
  // gameRowProfileMenuPortal, useFocusTrapEscape). Not a claim that
  // preventScroll is correct here: #948's own rule is for focus handed back
  // to where the user just was, and a toggle always lands on a new grid
  // position, so whether that position can end up out of view is a real
  // question this test does not answer, left for a CDP check instead.
  test('refocuses the moved switch with a single focus() call, options pinned for now', async () => {
    await render(<StatefulHarness props={buildProps({})} />)

    const switchEl = toggleSwitch('secondmonitor')
    switchEl.focus()

    // Drive the toggle without settling yet, so the spy can be attached to
    // the NEW row's switch (a different DOM node after the remount) before
    // the deferred rAF fires and calls focus() on it.
    await act(async () => {
      switchEl.click()
    })
    const movedSwitch = toggleSwitch('secondmonitor')
    const focusSpy = vi.spyOn(movedSwitch, 'focus')

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    expect(focusSpy.mock.calls).toEqual([[{ preventScroll: true }]])
  })
})
