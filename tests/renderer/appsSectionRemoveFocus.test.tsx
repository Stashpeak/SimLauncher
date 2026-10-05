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
  initialCustomSlots = 2,
  notify = vi.fn()
}: {
  initialAppPaths: Record<string, string>
  initialCustomSlots?: number
  // Hoistable so a test can assert on it directly, instead of an inline
  // vi.fn() the test has no handle on (#1007 review: nothing proved the
  // dropped-handler half of the #830 shape, only the DOM attribute).
  notify?: (message: string, type: 'success' | 'error' | 'warn', duration?: number) => void
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
    notify,
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
  initialCustomSlots = 2,
  notify?: (message: string, type: 'success' | 'error' | 'warn', duration?: number) => void
): Promise<void> {
  // Named #root because useFocusTrap inerts that element while the confirm is up.
  container = document.createElement('div')
  container.id = 'root'
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppsHarness
        initialAppPaths={initialAppPaths}
        initialCustomSlots={initialCustomSlots}
        notify={notify}
      />
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

// `^=` rather than an exact match: the blocked survivor's aria-label appends
// the unavailable reason (e.g. "Remove Custom App 1. At least one custom app
// slot is required"), same shape as GameRowActions.tsx's blocked controls.
function removeButton(label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label^="Remove ${label}"]`)
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

// removeSlotData's focus fallback (#1007) is deferred to the next animation
// frame, same pattern as ProfileUtilitiesSection's refocus, so a test that
// removes the highest-numbered slot has to wait one out too.
async function settleFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

describe('AppsSection: removing one of two custom apps from the keyboard (#1007)', () => {
  test('through the real confirm dialog, focus stays on a control in the list instead of <body>', async () => {
    const notify = vi.fn()
    // Custom App 1 has an executable configured, so Remove opens the
    // destructive-action confirm (useCustomSlots.handleRemoveCustomSlot);
    // Custom App 2 is empty, matching the reported "one of two... pointing
    // at an exe" repro.
    await render({ customapp1: 'C:/apps/custom1.exe' }, 2, notify)

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

    // Unlike a native `disabled` button, this one still receives hover and
    // focus (that is the point of #830's shape), so its accessible name has
    // to say why it does nothing instead of just repeating the action name.
    expect(survivor.getAttribute('aria-label')).toBe(
      'Remove Custom App 1. At least one custom app slot is required'
    )

    // Clicking the now-unavailable button does nothing: no second confirm,
    // and (the other half of the #830 shape) no live-but-gated handler either
    // -- the onClick is dropped, not just visually disabled.
    await press(survivor)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })

  test('removing the highest-numbered slot (not the one the fix special-cases) still keeps focus off <body>, through the dialog', async () => {
    // Two slots, exe in slot 2 this time: slot 1's row is what the #1007 fix
    // relied on staying mounted (its data just gets overwritten by the
    // shift), but removing slot 2 unmounts the very row whose button was
    // clicked, since there is no higher slot left to shift into it. Nothing
    // survives for ConfirmDialog's useFocusTrap restore to land on unless
    // removeSlotData's own fallback focuses a survivor.
    await render({ customapp2: 'C:/apps/custom2.exe' })

    const button = removeButton('Custom App 2')
    button.focus()
    await press(button)
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()

    await press(dialogButton('Remove App'))
    await settleFrame()

    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(container.querySelectorAll('button[aria-label^="Remove "]').length).toBe(1)
    expect(document.activeElement).not.toBe(document.body)
    expect(container.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(removeButton('Custom App 1'))
  })

  test('removing the highest-numbered slot silently (no exe, no dialog) still keeps focus off <body>', async () => {
    // Both slots empty: handleRemoveCustomSlot takes the no-confirm branch
    // straight into removeSlotData, so there is no ConfirmDialog restore
    // attempt at all here, only removeSlotData's own fallback.
    await render({}, 2)

    const button = removeButton('Custom App 2')
    button.focus()
    await press(button)
    await settleFrame()

    expect(container.querySelectorAll('button[aria-label^="Remove "]').length).toBe(1)
    expect(document.activeElement).not.toBe(document.body)
    expect(container.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(removeButton('Custom App 1'))
  })

  test('a non-last slot renders no aria-disabled attribute at all', async () => {
    // Three slots so one remains available after a hypothetical removal:
    // proves `|| undefined` keeps the attribute out of the DOM rather than
    // always rendering aria-disabled="false".
    await render({}, 3)
    const button = removeButton('Custom App 3')
    expect(button.getAttribute('aria-disabled')).toBeNull()
  })
})
