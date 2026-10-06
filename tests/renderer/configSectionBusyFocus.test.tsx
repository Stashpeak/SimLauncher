/**
 * Regression test for #869 (Settings > Import config lost focus to <body> once
 * the "replace your settings" confirm had been accepted).
 *
 * Export and Import were `disabled` while their native file dialog was up.
 * Accepting the confirm disabled Import in the same commit that closed the
 * confirm, so the confirm's focus trap tried to hand focus back to a disabled
 * button, which refuses it, and focus fell to <body>. The Trust Imported
 * Config preview then captured <body> as its own restore target, so every way
 * out of the flow ended there. Export lost focus the moment it became
 * `disabled`. Both buttons now follow #830: aria-disabled with the click
 * handler dropped while busy, so they keep focus and their place in the tab
 * order, and a busy click does nothing.
 *
 * Everything here is the real chain (useConfigIO, ConfigSection, ConfirmDialog,
 * ImportPreviewDialog, useFocusTrap); only the IPC behind lib/store is faked,
 * as promises the test settles to play the part of the native dialogs.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type {
  ConfigFileResult,
  ConfigImportPreviewResult,
  ConfigImportPreviewSummary
} from '../../src/preload/api'

const exportConfigMock = vi.fn<() => Promise<ConfigFileResult>>()
const previewImportConfigMock = vi.fn<() => Promise<ConfigImportPreviewResult>>()
const applyImportConfigMock = vi.fn<(token: string) => Promise<ConfigFileResult>>()
const cancelImportConfigMock = vi.fn<(token: string) => Promise<ConfigFileResult>>()
const notifyMock = vi.fn()

vi.mock('../../src/renderer/src/lib/store', () => ({
  exportConfig: () => exportConfigMock(),
  previewImportConfig: () => previewImportConfigMock(),
  applyImportConfig: (token: string) => applyImportConfigMock(token),
  cancelImportConfig: (token: string) => cancelImportConfigMock(token)
}))

import { ConfigSection } from '../../src/renderer/src/components/settings/ConfigSection'
import {
  SettingsMetaContext,
  type SettingsMetaContextValue
} from '../../src/renderer/src/components/settings/SettingsMetaContext'
import { useConfigIO } from '../../src/renderer/src/components/settings/useConfigIO'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

interface Pending<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function pending<T>(): Pending<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const SUMMARY: ConfigImportPreviewSummary = {
  changedKeys: ['accentPreset'],
  gamePaths: [],
  appPaths: [],
  trackedProcessPaths: [],
  customAppArgs: [],
  droppedCount: 0,
  warnings: []
}

// The SettingsProvider wiring, minus everything the Config section does not
// read. The dialogs render beside the section and portal to <body>, outside
// #root, exactly as SettingsContext.tsx renders configImportDialogs.
function ConfigHarness(): ReactNode {
  const io = useConfigIO({ notify: notifyMock })
  const meta: SettingsMetaContextValue = {
    loading: false,
    isDirty: false,
    dirtySections: { appearance: false, behavior: false, games: false, apps: false, about: false },
    saveSettings: async () => true,
    exportingConfig: io.exportingConfig,
    importingConfig: io.importingConfig,
    autoCheckUpdates: false,
    onExportConfig: io.handleExportConfig,
    onImportConfig: io.handleImportConfig,
    onAutoCheckUpdatesChange: () => {}
  }
  return (
    <SettingsMetaContext.Provider value={meta}>
      <ConfigSection />
      {io.configImportDialogs}
    </SettingsMetaContext.Provider>
  )
}

// Chromium moves focus to <body> when the focused control becomes `disabled`.
// jsdom does not (the #979 test ran into the same gap), and its blur() is a
// no-op on a control that is no longer focusable, so this stand-in focuses the
// document instead, which is where Chromium leaves it. Without it the three
// Export exits pass against the old `disabled` buttons. The Import cases fail
// either way: jsdom does refuse focus() on a disabled button, and that refusal
// is the trap's restore.
function emulateBlurOnDisable(): () => void {
  const observer = new MutationObserver((records) => {
    for (const { target } of records) {
      if (target === document.activeElement && (target as Element).hasAttribute('disabled')) {
        document.documentElement.focus()
      }
    }
  })
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled']
  })
  return () => observer.disconnect()
}

let picker: Pending<ConfigImportPreviewResult>
let saveDialog: Pending<ConfigFileResult>
let stopBlurOnDisable: () => void = () => {}
let appRoot: HTMLDivElement | null = null
let root: Root | null = null
let exportButton: HTMLButtonElement
let importButton: HTMLButtonElement

beforeEach(() => {
  vi.clearAllMocks()
  picker = pending()
  saveDialog = pending()
  previewImportConfigMock.mockImplementation(() => picker.promise)
  exportConfigMock.mockImplementation(() => saveDialog.promise)
  applyImportConfigMock.mockResolvedValue({ success: true })
  cancelImportConfigMock.mockResolvedValue({ success: true })
  stopBlurOnDisable = emulateBlurOnDisable()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  appRoot?.remove()
  appRoot = null
  stopBlurOnDisable()
})

async function render(): Promise<void> {
  // Named #root because useFocusTrap inerts that element while a dialog is up.
  const host = document.createElement('div')
  host.id = 'root'
  document.body.appendChild(host)
  appRoot = host
  await act(async () => {
    root = createRoot(host)
    root.render(<ConfigHarness />)
  })
  const byLabel = (label: string): HTMLButtonElement => {
    const button = Array.from(host.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label
    )
    if (!button) throw new Error(`No "${label}" button rendered`)
    return button
  }
  // Held from here on rather than looked up again: the label changes while
  // busy, and holding the node is what proves focus came back to the same one.
  exportButton = byLabel('Export config')
  importButton = byLabel('Import config')
}

function openDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]')
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

async function pressEscape(): Promise<void> {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  })
}

// Keyboard path from the issue: focus Import, press it, accept the confirm.
// The picker is then "up" until the test settles `picker`.
async function startImport(): Promise<void> {
  importButton.focus()
  await press(importButton)
  await press(dialogButton('Import Config'))
  expect(previewImportConfigMock).toHaveBeenCalledTimes(1)
}

async function showPreview(): Promise<void> {
  await act(async () => {
    picker.resolve({ success: true, token: 'preview-token', summary: SUMMARY })
  })
  expect(openDialog()?.textContent).toContain('Trust Imported Config')
  expect(openDialog()?.contains(document.activeElement)).toBe(true)
}

function expectBusyButFocusable(button: HTMLButtonElement): void {
  expect(button.getAttribute('aria-disabled')).toBe('true')
  // The whole point: a `disabled` button refuses focus, so the commit that
  // marks it busy is the commit that throws focus to <body>.
  expect(button.hasAttribute('disabled')).toBe(false)
  expect(button.disabled).toBe(false)
  // jsdom applies no stylesheet: the dimmed look is the #830 App.css rule,
  // which matches on this class.
  expect(button.classList.contains('accent-surface-action')).toBe(true)
}

function expectIdle(button: HTMLButtonElement): void {
  expect(button.getAttribute('aria-disabled')).toBeNull()
  expect(button.hasAttribute('disabled')).toBe(false)
}

test('the stand-in for Chromium blurring a control that becomes disabled does fire', async () => {
  const button = document.createElement('button')
  document.body.appendChild(button)
  button.focus()
  expect(document.activeElement).toBe(button)

  button.disabled = true
  // MutationObserver callbacks run as a microtask after the mutation.
  await Promise.resolve()

  expect(document.activeElement).toBe(document.body)
  button.remove()
})

describe('Export and Import config while a native file dialog is up (#869)', () => {
  test('during the file picker, both say they are busy without leaving the tab order, Import keeps focus, and clicks do nothing', async () => {
    await render()
    await startImport()

    expect(openDialog()).toBeNull()
    expect(document.activeElement).toBe(importButton)
    expectBusyButFocusable(exportButton)
    expectBusyButFocusable(importButton)

    // With `disabled` gone the DOM no longer swallows these clicks, so keeping
    // them inert is now the component's job.
    await press(exportButton)
    await press(importButton)
    expect(exportConfigMock).not.toHaveBeenCalled()
    expect(previewImportConfigMock).toHaveBeenCalledTimes(1)
    expect(openDialog()).toBeNull()

    await act(async () => {
      picker.resolve({ success: false, canceled: true })
    })
    expectIdle(exportButton)
    expectIdle(importButton)
  })

  test('during the save dialog, both say they are busy, Export keeps focus, and clicks do nothing', async () => {
    await render()
    exportButton.focus()
    await press(exportButton)

    expect(exportConfigMock).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(exportButton)
    expectBusyButFocusable(exportButton)
    expectBusyButFocusable(importButton)

    await press(exportButton)
    await press(importButton)
    expect(exportConfigMock).toHaveBeenCalledTimes(1)
    expect(openDialog()).toBeNull()

    await act(async () => {
      saveDialog.resolve({ success: false, canceled: true })
    })
    expectIdle(exportButton)
    expectIdle(importButton)
  })
})

describe('every way to back out of the import flow leaves focus on Import config (#869)', () => {
  // A successful Trust and Import is left out on purpose: it still ends on
  // <body>. In the app, onConfigImported bumps App.tsx's refreshKey, the `key`
  // on SettingsProvider, so the settings subtree remounts and the Import button
  // the preview restores to is gone. This harness has no such remount, so a
  // row for it would pass while the app still loses focus.
  test.each<[string, () => Promise<void>]>([
    [
      'cancelling the file picker',
      async () => {
        await act(async () => {
          picker.resolve({ success: false, canceled: true })
        })
      }
    ],
    [
      'the file picker failing',
      async () => {
        await act(async () => {
          picker.resolve({ success: false, error: 'Unreadable file' })
        })
        expect(notifyMock).toHaveBeenCalledWith('Unreadable file', 'error')
      }
    ],
    [
      'Escape on the Trust Imported Config preview',
      async () => {
        await showPreview()
        await pressEscape()
        expect(cancelImportConfigMock).toHaveBeenCalledWith('preview-token')
      }
    ],
    [
      'Cancel Import on the preview',
      async () => {
        await showPreview()
        await press(dialogButton('Cancel Import'))
        expect(cancelImportConfigMock).toHaveBeenCalledWith('preview-token')
      }
    ],
    [
      'a click on the preview backdrop',
      async () => {
        await showPreview()
        const backdrop = openDialog()?.previousElementSibling
        if (!(backdrop instanceof HTMLElement)) throw new Error('No preview backdrop')
        await press(backdrop)
        expect(cancelImportConfigMock).toHaveBeenCalledWith('preview-token')
      }
    ]
  ])('%s', async (_exit, leave) => {
    await render()
    await startImport()
    await leave()

    expect(openDialog()).toBeNull()
    expect(document.activeElement).toBe(importButton)
    expectIdle(importButton)
  })

  // The control from the issue: declining the confirm never set the busy
  // state, so it restored focus before the fix too. Pinned so it stays that way.
  test.each([['Escape'], ['Cancel Import'], ['Cancel']])(
    'declining the "replace your settings" confirm with %s',
    async (exit) => {
      await render()
      importButton.focus()
      await press(importButton)
      expect(openDialog()?.textContent).toContain('replace your current SimLauncher settings')

      if (exit === 'Escape') await pressEscape()
      else await press(dialogButton(exit))

      expect(openDialog()).toBeNull()
      expect(previewImportConfigMock).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(importButton)
    }
  )
})

describe('every way out of the export flow leaves focus on Export config (#869)', () => {
  test.each<[string, ConfigFileResult]>([
    ['cancelling the save dialog', { success: false, canceled: true }],
    ['a successful export', { success: true, filePath: 'D:/backup/simlauncher.json' }],
    ['a failed export', { success: false, error: 'Disk full' }]
  ])('%s', async (_exit, result) => {
    await render()
    exportButton.focus()
    await press(exportButton)
    await act(async () => {
      saveDialog.resolve(result)
    })

    expect(document.activeElement).toBe(exportButton)
    expectIdle(exportButton)
  })
})
