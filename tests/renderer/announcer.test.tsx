/**
 * Regression test for #541 (a11y: dedicated sr-only announcer).
 *
 * Runtime feedback used to ride on a single polite toast whose live-region
 * child was an `aria-label`led `<button>` — Narrator announced it unreliably and
 * appended "— dismiss notification" to every status, and errors shared the
 * polite channel so they never interrupted.
 *
 * Contract pinned here:
 *   1. notify() routes by type — success/warn to the polite region, error to the
 *      assertive region.
 *   2. announce() speaks without a toast and honours the politeness argument.
 *   3. The visual toast is aria-hidden, not in the tab order, and carries no
 *      "dismiss notification" text into the a11y tree.
 */

import { beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The toast progress bar is WAAPI-driven; jsdom doesn't implement
  // Element.animate, so stub it to a no-op animation when a real toast renders.
  Element.prototype.animate = vi.fn(() => ({ cancel: vi.fn() })) as never
})

// Notify subscribes to two main-process push channels at mount. Stub the
// electron bridge so the module doesn't touch window.electronAPI (undefined in
// jsdom); each subscriber just returns its no-op unsubscribe.
vi.mock('../../src/renderer/src/lib/electron', () => ({
  onAppLaunchError: () => () => {},
  onProcessNameMismatchWarning: () => () => {}
}))

import { NotifyProvider, useNotify } from '../../src/renderer/src/components/Notify'

let api: ReturnType<typeof useNotify> | null = null

function Capture(): null {
  api = useNotify()
  return null
}

async function renderProvider(): Promise<{
  container: HTMLDivElement
  polite: HTMLElement
  assertive: HTMLElement
  unmount: () => void
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(
      <NotifyProvider>
        <Capture />
      </NotifyProvider>
    )
  })
  const polite = container.querySelector('[aria-live="polite"]')
  const assertive = container.querySelector('[aria-live="assertive"]')
  if (!polite || !assertive) throw new Error('announcer live regions not found')
  return {
    container,
    polite: polite as HTMLElement,
    assertive: assertive as HTMLElement,
    unmount: () => {
      act(() => root?.unmount())
      container.remove()
    }
  }
}

describe('Notify announcer (#541)', () => {
  test('notify routes success to polite and error to assertive, with no dismiss pollution', async () => {
    const { polite, assertive, unmount } = await renderProvider()

    act(() => api!.notify('Launching iRacing', 'success'))
    expect(polite.textContent).toContain('Launching iRacing')
    expect(assertive.textContent ?? '').not.toContain('Launching iRacing')

    act(() => api!.notify('iRacing failed to launch', 'error'))
    expect(assertive.textContent).toContain('iRacing failed to launch')
    expect(polite.textContent ?? '').not.toContain('iRacing failed to launch')

    expect(polite.textContent ?? '').not.toMatch(/dismiss/i)
    expect(assertive.textContent ?? '').not.toMatch(/dismiss/i)

    unmount()
  })

  test('announce speaks without a toast and honours politeness', async () => {
    const { container, polite, assertive, unmount } = await renderProvider()

    act(() => api!.announce('Update version 1.2.3 available'))
    expect(polite.textContent).toContain('Update version 1.2.3 available')
    // No visual toast for a plain announce().
    expect(document.body.querySelector('.toast-card')).toBeNull()
    expect(container.querySelector('.toast-card')).toBeNull()

    act(() => api!.announce('Save failed', 'assertive'))
    expect(assertive.textContent).toContain('Save failed')

    unmount()
  })

  test('the visual toast is aria-hidden, unfocusable, and carries no accessible name', async () => {
    const { unmount } = await renderProvider()

    act(() => api!.notify('Switched to Wet Setup', 'success'))
    const card = document.body.querySelector('.toast-card') as HTMLButtonElement | null
    expect(card).not.toBeNull()
    expect(card!.tabIndex).toBe(-1)
    expect(card!.hasAttribute('aria-label')).toBe(false)
    // The card sits inside an aria-hidden subtree so it is not double-announced.
    expect(card!.closest('[aria-hidden="true"]')).not.toBeNull()

    unmount()
  })
})
