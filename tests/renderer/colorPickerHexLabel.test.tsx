/**
 * The "HEX" text next to the color input must be a real <label> associated with
 * the <input> (htmlFor/id via useId), so clicking it focuses the field. Mirrors
 * profileNameSectionLabel.test.tsx (#765), with one deliberate difference: this
 * input KEEPS its aria-label, because "HEX" on its own is a poor accessible
 * name. The second test pins that down so nobody removes it while making the
 * two components look alike.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ColorPickerPopover } from '../../src/renderer/src/components/ColorPickerPopover'

let root: Root | null = null
let container: HTMLElement | null = null

async function renderPopover(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  const anchor = createRef<HTMLElement>()
  anchor.current = document.createElement('button')
  document.body.appendChild(anchor.current)

  await act(async () => {
    root = createRoot(container as HTMLElement)
    root.render(
      <ColorPickerPopover
        color="#AD46FF"
        onChange={() => {}}
        onClose={() => {}}
        anchorRef={anchor}
      />
    )
  })
}

// The popover portals to document.body, so it is not inside `container`.
function hexInput(): HTMLInputElement | null {
  return document.body.querySelector('input[type="text"]')
}

function hexLabel(): HTMLLabelElement | null {
  return document.body.querySelector('label')
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

describe('ColorPickerPopover HEX label association', () => {
  test('the HEX text is programmatically associated with the input', async () => {
    await renderPopover()

    const label = hexLabel()
    const input = hexInput()

    expect(label?.textContent?.trim()).toBe('HEX')
    expect(input).not.toBeNull()

    // jsdom resolves HTMLLabelElement.control through htmlFor/id, so this goes
    // null the moment the pairing breaks. Before this change the text was a
    // <span> in a <div> and clicking it did nothing.
    expect(input?.id).toBeTruthy()
    expect(label?.htmlFor).toBe(input?.id)
    expect(label?.control).toBe(input)
  })

  test('the input keeps its own accessible name rather than inheriting "HEX"', async () => {
    const input = (await renderPopover(), hexInput())

    // Deliberately the opposite of ProfileNameSection (#765), where the visible
    // label IS the name. "HEX" would be a useless name on its own, so the
    // aria-label wins the name computation and the label only adds the click
    // target. Removing it would silently downgrade the announced name.
    expect(input?.getAttribute('aria-label')).toBe('Hex color value')
  })
})
