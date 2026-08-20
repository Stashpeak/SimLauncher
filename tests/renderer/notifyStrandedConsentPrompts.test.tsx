/**
 * #782: the stranded-consent-prompt note is delivered by a PUSH from main to the
 * toast layer, not by a value returned from `save-profile`.
 *
 * Why it moved here from GameRow. Cancelling a pending elevated launch is a side
 * effect of the active profile changing, and four callers change it: the row's
 * profile dropdown, the editor's save, its delete, and its discard-pending
 * restore. Only the dropdown ever read the returned count, and because the
 * counter is a module-level scalar that the read DRAINS, the other three did not
 * merely stay silent -- they consumed the count and destroyed it, leaving the
 * user with a consent dialog that does nothing and no explanation anywhere
 * (Codex P2 on #782, found on the delete path).
 *
 * So the contract worth pinning is no longer "GameRow folds the note into its
 * switch toast". It is "a pushed count becomes a visible warning toast, whoever
 * caused it". That is what this file tests, and it is why the two save-path
 * tests that used to live in gameRowStrandedConsentPrompt.test.tsx are gone: the
 * behaviour they described is now impossible to express at a single caller.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { formatStrandedConsentPrompts } from '../../src/shared/strandedConsentPrompts'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The toast progress bar is WAAPI-driven; jsdom doesn't implement
  // Element.animate, so stub it to a no-op animation when a real toast renders.
  Element.prototype.animate = vi.fn(() => ({ cancel: vi.fn() })) as never
})

// Captured so a test can fire the channel the way main does. The unsubscribe is
// real rather than a no-op so the unmount assertion below means something.
let pushStrandedConsentPrompts: ((count: number) => void) | null = null
let subscriberCount = 0

vi.mock('../../src/renderer/src/lib/electron', () => ({
  onAppLaunchError: () => () => {},
  onProcessNameMismatchWarning: () => () => {},
  onStrandedConsentPrompts: (cb: (count: number) => void) => {
    pushStrandedConsentPrompts = cb
    subscriberCount += 1
    return () => {
      pushStrandedConsentPrompts = null
      subscriberCount -= 1
    }
  }
}))

import { NotifyProvider } from '../../src/renderer/src/components/Notify'

const SINGULAR = formatStrandedConsentPrompts(1)!
const PLURAL = formatStrandedConsentPrompts(2)!

async function renderProvider(): Promise<{ unmount: () => void }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(<NotifyProvider>{null}</NotifyProvider>)
  })
  return {
    unmount: () => {
      act(() => root?.unmount())
      container.remove()
    }
  }
}

async function push(count: number): Promise<void> {
  if (!pushStrandedConsentPrompts) throw new Error('nothing subscribed to the push channel')
  await act(async () => {
    pushStrandedConsentPrompts!(count)
  })
}

// Toasts are portaled to document.body, not into the provider's container.
function allToastText(): string {
  return document.body.textContent ?? ''
}

beforeEach(() => {
  document.body.innerHTML = ''
  pushStrandedConsentPrompts = null
  subscriberCount = 0
})

describe('stranded consent prompt push (#782)', () => {
  test('a pushed count becomes a warning toast', async () => {
    const { unmount } = await renderProvider()

    await push(1)

    expect(allToastText()).toContain(SINGULAR)
    unmount()
  })

  // The wording is composed at the surface that shows it, so the plural form has
  // to be reached through the push and not only through the formatter's own unit
  // test -- an implementation that hardcoded the singular sentence would pass the
  // test above and still tell the user one prompt when three are on screen.
  test('the plural wording is used when more than one prompt was stranded', async () => {
    const { unmount } = await renderProvider()

    await push(3)

    expect(allToastText()).toContain(PLURAL)
    expect(allToastText()).not.toContain(SINGULAR)
    unmount()
  })

  // Main only pushes above zero, but the formatter returning undefined must not
  // reach `notify`: an empty toast is worse than no toast, and 'undefined' has
  // rendered into a toast here before (#809).
  test('a zero count renders nothing at all', async () => {
    const { unmount } = await renderProvider()

    await push(0)

    expect(allToastText()).not.toContain('permission prompt')
    expect(allToastText()).not.toContain('undefined')
    unmount()
  })

  test('the subscription is torn down on unmount', async () => {
    const { unmount } = await renderProvider()
    expect(subscriberCount).toBe(1)

    unmount()

    expect(subscriberCount).toBe(0)
  })
})
