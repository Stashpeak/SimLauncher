/**
 * Regression test for #979 (moving a companion to the end of the launch order
 * with the keyboard dropped focus to <body>).
 *
 * The keyboard reorder buttons (#515) were `disabled` at the ends of the list,
 * so the press that moved a companion into first or last place disabled the
 * very button that had focus. A focused control that becomes `disabled` loses
 * focus, and a keyboard or Narrator user started over from the title bar. The
 * buttons now follow #830: `aria-disabled` with the click handler dropped, so
 * the end-of-list button keeps focus, announces itself as unavailable, and
 * does nothing when pressed again.
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

const ENTRIES: ProfileUtility[] = UTILITIES.map((utility) => ({
  id: utility.key,
  enabled: true
}))

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
    enabledUtilityEntries: ENTRIES,
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

// The enabled-list half of useProfileEditor.moveEnabledUtility. Every entry
// here is enabled, so the disabled tail it re-appends is always empty.
function moveEntry(
  entries: ProfileUtility[],
  draggedId: string,
  targetId: string,
  placement: 'before' | 'after'
): ProfileUtility[] {
  const next = [...entries]
  const [moved] = next.splice(
    next.findIndex((entry) => entry.id === draggedId),
    1
  )
  const targetIndex = next.findIndex((entry) => entry.id === targetId)
  next.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, moved)
  return next
}

let currentOrder: string[] = []

// Owns the order as real state so each press re-renders the list the way the
// profile editor does: the focus question only exists once React has moved
// the rows and re-derived which buttons sit at the ends.
function StatefulHarness({ props }: { props: SectionProps }): ReactNode {
  const [entries, setEntries] = useState(props.enabledUtilityEntries)
  currentOrder = entries.map((entry) => entry.id)
  return (
    <ProfileUtilitiesSection
      {...props}
      enabledUtilityEntries={entries}
      onMoveEnabledUtility={(draggedId, targetId, placement) =>
        setEntries((current) => moveEntry(current, draggedId, targetId, placement))
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

function reorderButton(label: string, direction: 'up' | 'down'): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="Move ${label} ${direction} in launch order"]`
  )
  if (!button) throw new Error(`No ${direction} button found for "${label}"`)
  return button
}

// Enter and Space on a focused button reach React as this click; jsdom does
// not synthesize it from the key events, so the test dispatches it directly.
async function press(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
  })
}

function expectUnavailableButFocusable(button: HTMLButtonElement): void {
  expect(button.getAttribute('aria-disabled')).toBe('true')
  // The whole point: a `disabled` button is not focusable, so the press that
  // makes it unavailable is the press that throws focus to <body>.
  expect(button.hasAttribute('disabled')).toBe(false)
  expect(button.disabled).toBe(false)
}

describe('ProfileUtilitiesSection reorder buttons at the ends of the list (#979)', () => {
  test('the first entry cannot move up and the last cannot move down, and both say so without leaving the tab order', async () => {
    const onMoveEnabledUtility = vi.fn()
    await render(<ProfileUtilitiesSection {...buildProps({ onMoveEnabledUtility })} />)

    const firstUp = reorderButton('Track Titan', 'up')
    const lastDown = reorderButton('Custom App 1', 'down')
    for (const button of [firstUp, lastDown]) {
      expectUnavailableButFocusable(button)
      // jsdom applies no stylesheet: the dimmed look is the #830 App.css rule,
      // which matches on this class (pinned in gameRowBlockedActions.test.tsx).
      expect(button.classList.contains('icon-action')).toBe(true)
    }

    await press(firstUp)
    await press(lastDown)

    // With `disabled` gone, the DOM no longer swallows these clicks, so keeping
    // them inert is now the component's job.
    expect(onMoveEnabledUtility).not.toHaveBeenCalled()
  })

  // The negative half: the same kind of click on buttons that are not at an end.
  test('the buttons between the ends still move their entry', async () => {
    const onMoveEnabledUtility = vi.fn()
    await render(<ProfileUtilitiesSection {...buildProps({ onMoveEnabledUtility })} />)

    expect(reorderButton('Track Titan', 'down').getAttribute('aria-disabled')).toBeNull()
    expect(reorderButton('Custom App 1', 'up').getAttribute('aria-disabled')).toBeNull()

    await press(reorderButton('Track Titan', 'down'))
    await press(reorderButton('Custom App 1', 'up'))

    expect(onMoveEnabledUtility.mock.calls).toEqual([
      ['tracktitan', 'secondmonitor', 'after'],
      ['customapp1', 'secondmonitor', 'before']
    ])
  })

  // The reported repro. React moves the pressed row to the end and then hands
  // focus back to the element that had it; a `disabled` button refuses that,
  // so before the fix focus landed on <body> here in jsdom just as in Chromium.
  test('pressing "down" until a companion is last keeps focus on that button', async () => {
    await render(<StatefulHarness props={buildProps({})} />)

    const button = reorderButton('Track Titan', 'down')
    button.focus()
    await press(button)
    await press(button)

    expect(currentOrder).toEqual(['secondmonitor', 'customapp1', 'tracktitan'])
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(reorderButton('Track Titan', 'down'))
    expect(container.contains(document.activeElement)).toBe(true)
    expectUnavailableButFocusable(reorderButton('Track Titan', 'down'))

    // Pressed again at the end: nothing moves and focus stays put.
    await press(button)
    expect(currentOrder).toEqual(['secondmonitor', 'customapp1', 'tracktitan'])
    expect(document.activeElement).toBe(reorderButton('Track Titan', 'down'))
  })

  // The mirror case. Moving up, React moves the other rows and leaves the
  // pressed one where it is, and jsdom does not implement the browser rule that
  // blurs a focused control when it becomes `disabled`. So the focus check
  // alone passes without the fix here; the attribute checks after it do not.
  test('pressing "up" until a companion is first keeps focus on that button', async () => {
    await render(<StatefulHarness props={buildProps({})} />)

    const button = reorderButton('Custom App 1', 'up')
    button.focus()
    await press(button)
    await press(button)

    expect(currentOrder).toEqual(['customapp1', 'tracktitan', 'secondmonitor'])
    expect(document.activeElement).toBe(reorderButton('Custom App 1', 'up'))
    expectUnavailableButFocusable(reorderButton('Custom App 1', 'up'))

    await press(button)
    expect(currentOrder).toEqual(['customapp1', 'tracktitan', 'secondmonitor'])
    expect(document.activeElement).toBe(reorderButton('Custom App 1', 'up'))
  })
})
