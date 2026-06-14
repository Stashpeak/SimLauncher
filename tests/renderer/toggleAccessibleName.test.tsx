/**
 * Regression test for #520 (a11y semantic pass).
 *
 * Toggle's `<input>` used to set `aria-label={ariaLabel || id}`. That fallback
 * was unreached until the settings rows started linking a real
 * `<label htmlFor={id}>` and passing `id` WITHOUT an `aria-label` — at which
 * point the fallback injected the raw React `useId()` string (e.g. ":r0:") as
 * the input's aria-label, which OVERRIDES the associated label. A labelled
 * switch would then announce as ":r0:" instead of its visible text.
 *
 * Contract pinned here:
 *   1. With an `id` and no `aria-label`, the input has NO aria-label attribute,
 *      so an external <label htmlFor> provides the accessible name.
 *   2. An explicit `aria-label` is still honoured (used by presentational /
 *      label-less toggles).
 */

import { describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { Toggle } from '../../src/renderer/src/components/Toggle'

async function render(ui: React.ReactNode): Promise<{
  container: HTMLDivElement
  unmount: () => void
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(ui)
  })
  return {
    container,
    unmount: () => {
      act(() => root?.unmount())
      container.remove()
    }
  }
}

function getCheckbox(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="checkbox"]')
  if (!input) throw new Error('toggle checkbox not found')
  return input as HTMLInputElement
}

describe('Toggle accessible name (#520)', () => {
  test('with an id and no aria-label, the input has no aria-label so a <label htmlFor> can name it', async () => {
    const { container, unmount } = await render(
      <>
        <label htmlFor="demo-toggle">Start with Windows</label>
        <Toggle id="demo-toggle" checked={false} onChange={vi.fn()} />
      </>
    )
    const input = getCheckbox(container)
    expect(input.id).toBe('demo-toggle')
    // The core regression assertion: must NOT fall back to aria-label={id}.
    expect(input.hasAttribute('aria-label')).toBe(false)
    unmount()
  })

  test('an explicit aria-label is still applied (presentational / label-less use)', async () => {
    const { container, unmount } = await render(
      <Toggle checked onChange={vi.fn()} aria-label="Mute notifications" />
    )
    expect(getCheckbox(container).getAttribute('aria-label')).toBe('Mute notifications')
    unmount()
  })
})
