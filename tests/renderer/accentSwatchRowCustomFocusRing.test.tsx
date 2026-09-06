/**
 * Tabbing to the custom accent swatch drew a square focus ring around a round
 * control (#887). The preset swatches carry `rounded-full` on the <button>
 * itself, so the ring follows the circle; the custom swatch only had it on the
 * layers inside the button, so the ring followed the button's rectangular box.
 * The fix is the class on the button, and that is what this pins, against the
 * presets so the two cannot drift apart again.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { AccentSwatchRow } from '../../src/renderer/src/components/AccentSwatchRow'

let root: Root | null = null
let container: HTMLElement | null = null

async function renderRow(): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container as HTMLElement)
    root.render(
      <AccentSwatchRow
        accentPreset="#008c99"
        accentCustom=""
        isCustomColor={false}
        onAccentChange={vi.fn()}
        onCustomColorChange={vi.fn()}
      />
    )
  })
  return container
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

describe('AccentSwatchRow custom swatch focus ring (#887)', () => {
  test('the custom swatch button is round itself, like every preset button', async () => {
    const row = await renderRow()
    const buttons = Array.from(row.querySelectorAll('button'))
    const presets = buttons.filter((button) =>
      button.getAttribute('aria-label')?.startsWith('Accent color ')
    )
    const custom = buttons.find((button) =>
      button.getAttribute('aria-label')?.startsWith('Custom accent color')
    )

    expect(presets.length).toBeGreaterThan(0)
    expect(custom).toBeDefined()

    // The ring is drawn by the browser around the element that has focus, so
    // the roundness has to be on the button, not on a child.
    for (const preset of presets) {
      expect(preset.classList.contains('rounded-full')).toBe(true)
    }
    expect(custom?.classList.contains('rounded-full')).toBe(true)
  })
})
