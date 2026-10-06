/**
 * Regression test for #957, first mechanism: the sticky bar's Save button
 * became `disabled` in the same commit as the click that pressed it, and
 * Chromium blurs a focused element that turns disabled, so focus fell to
 * <body> before the save had even started. jsdom does NOT reproduce that blur
 * (it only refuses focus() on a disabled control), so the old markup goes red
 * here on the attribute assertions, and the blur itself is checked on a
 * packaged build.
 *
 * The bar now uses the #830 shape while a save runs: `aria-disabled` with the
 * click handlers dropped, so the button keeps focus and cannot be pressed
 * twice.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const notifyMock = vi.fn()

vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: notifyMock, announce: vi.fn() }),
  NotifyProvider: ({ children }: { children: ReactNode }) => children
}))

import { StickySaveBar } from '../../src/renderer/src/components/StickySaveBar'
import {
  AppDirtyProvider,
  useAppDirty,
  type SaveHandler
} from '../../src/renderer/src/contexts/AppDirtyContext'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

// A dirty profile-editor scope with the given save handler, the way an open
// editor registers itself.
function DirtyProfileScope({ onSave }: { onSave: SaveHandler }): ReactNode {
  const { registerSaveHandler, reportProfileEditorDirty } = useAppDirty()
  useEffect(() => {
    registerSaveHandler('profile-editor', onSave)
    reportProfileEditorDirty('ac:default', true)
  }, [registerSaveHandler, reportProfileEditorDirty, onSave])
  return null
}

let container: HTMLDivElement
let root: Root | null = null

async function render(onSave: SaveHandler, onRequestDiscard = vi.fn()): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppDirtyProvider>
        <DirtyProfileScope onSave={onSave} />
        <StickySaveBar onRequestDiscard={onRequestDiscard} />
      </AppDirtyProvider>
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  notifyMock.mockReset()
})

function barButton(name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((element) =>
    element.textContent?.includes(name)
  )
  if (!button) throw new Error(`No "${name}" button in the bar`)
  return button
}

describe('StickySaveBar keeps focus while a save runs (#957)', () => {
  test('the pressed Save button stays focused and unavailable, and a second press does nothing', async () => {
    let finishSave: (ok: boolean) => void = () => {}
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => (finishSave = resolve)))
    const onRequestDiscard = vi.fn()
    await render(onSave, onRequestDiscard)

    const save = barButton('Save Changes')
    save.focus()
    await act(async () => {
      save.click()
    })

    // The save is in flight. The bug: `disabled` here, which in Chromium
    // blurred the button and put focus on <body>.
    const saving = barButton('Saving')
    expect(saving).toBe(save)
    expect(document.activeElement).toBe(saving)
    expect(saving.getAttribute('aria-disabled')).toBe('true')
    expect(saving.hasAttribute('disabled')).toBe(false)

    // Unavailable means unavailable: neither button runs anything mid-save.
    const discard = barButton('Discard')
    expect(discard.getAttribute('aria-disabled')).toBe('true')
    expect(discard.hasAttribute('disabled')).toBe(false)
    await act(async () => {
      saving.click()
      discard.click()
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onRequestDiscard).not.toHaveBeenCalled()

    // A failed save leaves the bar up and focus where the user pressed.
    await act(async () => {
      finishSave(false)
    })
    expect(notifyMock).toHaveBeenCalledWith('Failed to save changes.', 'error', 4000)
    const again = barButton('Save Changes')
    expect(document.activeElement).toBe(again)
    expect(again.hasAttribute('aria-disabled')).toBe(false)
  })
})
