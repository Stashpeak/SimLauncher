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
  // The announcer is portaled to document.body (so it escapes the `inert` that
  // useFocusTrap sets on #root while a modal is open), not rendered inside the
  // provider's subtree — query the body, not the container.
  const polite = document.body.querySelector('[aria-live="polite"]')
  const assertive = document.body.querySelector('[aria-live="assertive"]')
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

  // Regression: useFocusTrap marks #root `inert` while a modal is open, and
  // aria-live mutations inside an inert subtree are not announced. The announcer
  // therefore MUST live outside #root (portaled to document.body) so a
  // notification fired while a dialog is up still reaches assistive tech — the
  // exact failure mode of the close-confirm save error.
  test('announcer escapes the modal `inert` on #root', async () => {
    // Mimic the real app shell: NotifyProvider mounts inside #root.
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    let appRoot: Root | null = null
    await act(async () => {
      appRoot = createRoot(root)
      appRoot.render(
        <NotifyProvider>
          <Capture />
        </NotifyProvider>
      )
    })

    // The live regions must NOT be inside #root...
    expect(root.querySelector('[aria-live]')).toBeNull()
    // ...they live in document.body, a sibling of #root.
    const assertive = document.body.querySelector('[aria-live="assertive"]') as HTMLElement | null
    expect(assertive).not.toBeNull()
    expect(assertive!.closest('#root')).toBeNull()

    // A modal opening inerts #root. The announcement must stay reachable (no
    // inert ancestor) and carry the message.
    root.setAttribute('inert', '')
    act(() => api!.notify('Failed to save changes. Window not closed.', 'error'))
    expect(assertive!.closest('[inert]')).toBeNull()
    expect(assertive!.textContent).toContain('Failed to save changes')

    act(() => appRoot?.unmount())
    root.remove()
  })
})
