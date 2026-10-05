/**
 * Regression test for #1007 (removing one of two custom apps from the
 * keyboard drops focus to <body>).
 *
 * The Remove button was natively `disabled={customSlots <= 1}`. Removing the
 * focused row's slot shifts the surviving slot's data down into the SAME
 * React-keyed row (customSlots drops from 2 to 1, so this now-only row's
 * button recomputes `customSlots <= 1` to true on the very re-render that
 * follows the click), and ConfirmDialog's useFocusTrap then tries to hand
 * focus back to that button via its restore in useFocusTrap.ts. A `disabled`
 * button refuses focus(), so focus lands on <body>. The button now follows
 * #830: `aria-disabled` with the click handler dropped, so it stays
 * focusable and is announced as unavailable instead.
 *
 * Everything here is the real chain (useCustomSlots, ConfirmDialog,
 * useFocusTrap) through AppsSection; only the surrounding settings state is a
 * minimal stand-in for SettingsContext.
 */

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  AppsContext,
  type AppsContextValue
} from '../../src/renderer/src/components/settings/AppsContext'
import { AppsSection } from '../../src/renderer/src/components/settings/AppsSection'
import { useCustomSlots } from '../../src/renderer/src/components/settings/useCustomSlots'
import { getCustomUtilities, type Profiles } from '../../src/renderer/src/lib/config'
import type { SettingsObjectField } from '../../src/renderer/src/components/settings/saveRace'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

// Stand-in for useSettingsState's dirty-tracking wrapper (SettingsContext.tsx):
// the focus bug does not depend on dirty tracking, so this just applies the
// updater, matching the real wrapper's net effect on state.
function applyUpdate<T>(
  _field: SettingsObjectField,
  setter: Dispatch<SetStateAction<Record<string, T>>>,
  updater: (current: Record<string, T>) => Record<string, T>
): void {
  setter(updater)
}

// Mirrors the relevant slice of SettingsContext/useSettingsState: real
// useCustomSlots wiring (so the confirm dialog and the shift-on-remove math
// are the genuine code paths), with the rest of Settings state trimmed to
// what AppsSection reads.
function AppsHarness({
  initialAppPaths,
  initialCustomSlots = 2
}: {
  initialAppPaths: Record<string, string>
  initialCustomSlots?: number
}): ReactNode {
  const [customSlots, setCustomSlots] = useState(initialCustomSlots)
  const [appPaths, setAppPaths] = useState<Record<string, string>>(initialAppPaths)
  const [appNames, setAppNames] = useState<Record<string, string>>({})
  const [appArgs, setAppArgs] = useState<Record<string, string>>({})
  const [appIcons, setAppIcons] = useState<Record<string, string>>({})
  const [iconLoadErrors, setIconLoadErrors] = useState<Set<string>>(new Set())
  const [profiles, setProfiles] = useState<Profiles>({})

  const { handleRemoveCustomSlot, customSlotRemoveDialog } = useCustomSlots({
    appNames,
    appPaths,
    customSlots,
    notify: vi.fn(),
    updateSettingsObject: applyUpdate,
    setAppPaths,
    setAppNames,
    setAppArgs,
    setAppIcons,
    setIconLoadErrors,
    setProfiles,
    setCustomSlots
  })

  const value: AppsContextValue = {
    appPaths,
    appNames,
    appArgs,
    appIcons,
    utilityIcons: {},
    iconLoadErrors,
    customSlots,
    utilities: getCustomUtilities(customSlots),
    profiles,
    onBrowse: vi.fn(),
    onAppNameChange: vi.fn(),
    onAppPathChange: vi.fn(),
    onAppArgsChange: vi.fn(),
    onIconLoadError: vi.fn(),
    onAddCustomSlot: vi.fn(),
    onRemoveCustomSlot: handleRemoveCustomSlot
  }

  return (
    <AppsContext.Provider value={value}>
      <AppsSection />
      {customSlotRemoveDialog}
    </AppsContext.Provider>
  )
}

let container: HTMLDivElement
let root: Root | null = null

async function render(
  initialAppPaths: Record<string, string>,
  initialCustomSlots = 2
): Promise<void> {
  // Named #root because useFocusTrap inerts that element while the confirm is up.
  container = document.createElement('div')
  container.id = 'root'
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppsHarness initialAppPaths={initialAppPaths} initialCustomSlots={initialCustomSlots} />
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

function removeButton(label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${label}"]`)
  if (!button) throw new Error(`No remove button found for "${label}"`)
  return button
}

function dialogButton(label: string): HTMLButtonElement {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')
  ).find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`No "${label}" button in the open dialog`)
  return button
}

// Enter and Space on a focused button reach React as this click; jsdom does
// not synthesize it from the key events, so the test dispatches it directly.
async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click()
  })
}

describe('AppsSection: removing one of two custom apps from the keyboard (#1007)', () => {
  test('through the real confirm dialog, focus stays on a control in the list instead of <body>', async () => {
    // Custom App 1 has an executable configured, so Remove opens the
    // destructive-action confirm (useCustomSlots.handleRemoveCustomSlot);
    // Custom App 2 is empty, matching the reported "one of two... pointing
    // at an exe" repro.
    await render({ customapp1: 'C:/apps/custom1.exe' })

    const button = removeButton('Custom App 1')
    button.focus()
    expect(document.activeElement).toBe(button)

    await press(button)
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()

    await press(dialogButton('Remove App'))

    // The dialog is gone and the slot count dropped to one.
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(container.querySelectorAll('button[aria-label^="Remove "]').length).toBe(1)

    // The bug: a `disabled` Remove button refuses the focus ConfirmDialog's
    // useFocusTrap restore tries to give it, so this assertion is what fails
    // on main (jsdom reproduces the browser's refusal to focus() a disabled
    // control).
    expect(document.activeElement).not.toBe(document.body)
    expect(container.contains(document.activeElement)).toBe(true)

    // It is specifically the same Remove button, now the only custom slot and
    // therefore unavailable.
    const survivor = removeButton('Custom App 1')
    expect(document.activeElement).toBe(survivor)
    expect(survivor.getAttribute('aria-disabled')).toBe('true')
    expect(survivor.hasAttribute('disabled')).toBe(false)
    expect(survivor.disabled).toBe(false)

    // Clicking the now-unavailable button does nothing (no second confirm).
    await press(survivor)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  test('with more than one slot left, the surviving button has no aria-disabled attribute at all', async () => {
    // Three slots so one remains available after a hypothetical removal:
    // proves `|| undefined` keeps the attribute out of the DOM rather than
    // always rendering aria-disabled="false".
    await render({}, 3)
    const button = removeButton('Custom App 3')
    expect(button.getAttribute('aria-disabled')).toBeNull()
  })
})
