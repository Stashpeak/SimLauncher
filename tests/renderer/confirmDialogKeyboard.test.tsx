/**
 * Regression test for #476 (caught by the 0.9.9 pre-release smoke test):
 * ConfirmDialog's window-level capture keydown handler mapped Enter to
 * `onSave()` unconditionally and never called `preventDefault()`. Pressing
 * Enter on a focused Cancel button therefore ran BOTH the focused button's
 * native activation (cancel) AND the dialog-level default-confirm (Save &
 * Close) — in the close-window flow the app quit after a keyboard cancel.
 *
 * The fix treats Enter as the default-confirm shortcut only while focus is
 * outside the dialog's buttons; a focused button is left to its own native
 * activation. These tests pin that contract:
 *   1. Enter with a dialog button focused does NOT call `onSave`.
 *   2. Enter with focus elsewhere (dialog container) still confirms.
 *   3. Escape still cancels regardless of focus.
 */

import { describe, expect, test, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// useFocusTrap manipulates focus and toggles `inert` on #root; none of that is
// under test here and jsdom lacks pieces of it, so stub it out.
vi.mock('../../src/renderer/src/hooks/useFocusTrap', () => ({
  useFocusTrap: () => {}
}))

import { ConfirmDialog } from '../../src/renderer/src/components/ConfirmDialog'

const onSave = vi.fn()
const onDiscard = vi.fn()
const onCancel = vi.fn()

async function renderDialog(): Promise<{ unmount: () => void }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(
      <ConfirmDialog
        isOpen
        title="Unsaved changes"
        message="Save before closing?"
        onSave={onSave}
        onDiscard={onDiscard}
        onCancel={onCancel}
      />
    )
  })

  return {
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    }
  }
}

function getButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label
  )
  if (!button) throw new Error(`Button "${label}" not found`)
  return button
}

function pressKey(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

describe('ConfirmDialog keyboard activation (#476)', () => {
  beforeEach(() => {
    onSave.mockClear()
    onDiscard.mockClear()
    onCancel.mockClear()
  })

  test('Enter on a focused Cancel button does NOT fire the Save action', async () => {
    const harness = await renderDialog()
    try {
      const cancelButton = getButton('Cancel')
      cancelButton.focus()
      pressKey(cancelButton, 'Enter')

      // Native activation (the click) is the browser's job; the dialog-level
      // shortcut must stay out of the way entirely.
      expect(onSave).not.toHaveBeenCalled()
      expect(onDiscard).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })

  test('Enter on a focused Discard button does NOT fire the Save action', async () => {
    const harness = await renderDialog()
    try {
      const discardButton = getButton('Discard')
      discardButton.focus()
      pressKey(discardButton, 'Enter')

      expect(onSave).not.toHaveBeenCalled()
      expect(onCancel).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })

  test('Enter with focus outside the buttons confirms via onSave exactly once', async () => {
    const harness = await renderDialog()
    try {
      const dialog = document.querySelector('[role="alertdialog"]')
      if (!dialog) throw new Error('Dialog not found')
      pressKey(dialog, 'Enter')

      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onDiscard).not.toHaveBeenCalled()
      expect(onCancel).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })

  test('Escape cancels even while a button is focused', async () => {
    const harness = await renderDialog()
    try {
      const saveButton = getButton('Save Changes')
      saveButton.focus()
      pressKey(saveButton, 'Escape')

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSave).not.toHaveBeenCalled()
      expect(onDiscard).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })

  test('mouse click on Cancel fires only onCancel', async () => {
    const harness = await renderDialog()
    try {
      const cancelButton = getButton('Cancel')
      act(() => {
        cancelButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSave).not.toHaveBeenCalled()
      expect(onDiscard).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })
})
