/**
 * Ctrl+Z did nothing in the HEX field (#888). The input was controlled by a
 * value transformed on every keystroke (uppercased, `#` prepended, an unwanted
 * character dropped), so React wrote the input's value after each keystroke,
 * and Chromium clears a field's native undo stack on every programmatic write.
 *
 * jsdom has no undo stack, so what is pinned is the condition the native one
 * needs: the field's DOM value stays exactly what was typed, also after the
 * parent echoes the colour back, while the parent still receives the stored
 * form (`#` first, uppercase) on every keystroke. The rest pins the edges of
 * the draft: a colour picked elsewhere replaces it, an unwanted character or a
 * cleared field is shown but not stored and leaves on blur, and the old bare
 * `#` fallback on blur still fires.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ColorPickerPopover } from '../../src/renderer/src/components/ColorPickerPopover'

let root: Root | null = null
let container: HTMLElement | null = null
const onChange = vi.fn<(color: string) => void>()

// Re-rendering with a new `color` is what the parent does after onChange
// (the echo) and what a drag on the picker or a preset swatch does (a change
// that did not come from the field).
async function render(color: string): Promise<void> {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  const anchor = createRef<HTMLElement>()
  await act(async () => {
    root?.render(
      <ColorPickerPopover color={color} onChange={onChange} onClose={() => {}} anchorRef={anchor} />
    )
  })
}

// The popover portals to document.body, so it is not inside `container`.
function hexInput(): HTMLInputElement {
  const input = document.body.querySelector('input[type="text"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('HEX input not rendered')
  return input
}

// React listens for the native `input` event and reads the value through the
// element's own descriptor, so a test has to set it the way a keystroke would:
// via the prototype setter, past React's value tracker, then dispatch.
async function typeInto(value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('HTMLInputElement value setter not found')
  await act(async () => {
    const input = hexInput()
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function blur(): Promise<void> {
  await act(async () => {
    hexInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  onChange.mockReset()
})

describe('ColorPickerPopover HEX field keeps what was typed (#888)', () => {
  test('the field shows the keystrokes as typed while the parent gets the stored form', async () => {
    await render('#AD46FF')

    await typeInto('ad4')
    expect(onChange).toHaveBeenLastCalledWith('#AD4')
    expect(hexInput().value).toBe('ad4')

    // The parent echoes the stored form back; the draft must survive it,
    // because a value write here is exactly what emptied the undo stack.
    await render('#AD4')
    expect(hexInput().value).toBe('ad4')

    await typeInto('ad46ff')
    expect(onChange).toHaveBeenLastCalledWith('#AD46FF')
    await render('#AD46FF')
    expect(hexInput().value).toBe('ad46ff')
  })

  test('a value pasted without # is stored with it', async () => {
    await render('#AD46FF')

    await typeInto('3080d8')
    expect(onChange).toHaveBeenLastCalledWith('#3080D8')
  })

  test('a colour picked elsewhere replaces the draft', async () => {
    await render('#AD46FF')
    await typeInto('ad4')
    await render('#AD4')

    // A drag on the picker reports lowercase; the field shows the stored form.
    await render('#3080d8')
    expect(hexInput().value).toBe('#3080D8')
  })

  test('an unwanted character is shown but not stored, and leaves on blur', async () => {
    await render('#AD46FF')

    await typeInto('#AD4z')
    expect(onChange).not.toHaveBeenCalled()
    expect(hexInput().value).toBe('#AD4z')

    await blur()
    expect(onChange).not.toHaveBeenCalled()
    expect(hexInput().value).toBe('#AD46FF')
  })

  test('a cleared field is not stored, and shows the colour again on blur', async () => {
    await render('#AD46FF')

    await typeInto('')
    expect(onChange).not.toHaveBeenCalled()
    expect(hexInput().value).toBe('')

    await blur()
    expect(hexInput().value).toBe('#AD46FF')
  })

  test('blur on a bare # still falls back to the placeholder colour', async () => {
    await render('#AD46FF')

    await typeInto('#')
    expect(onChange).toHaveBeenLastCalledWith('#')
    await render('#')

    await blur()
    expect(onChange).toHaveBeenLastCalledWith('#AD46FF')
    expect(hexInput().value).toBe('#AD46FF')
  })
})
