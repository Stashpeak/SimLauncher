/**
 * #959: the custom launch-delay field could not be cleared. parseFloat('') is
 * NaN, the onChange guard skipped the commit, and React's controlled-input
 * restore wrote the unchanged committed value right back into the DOM node
 * before the next keystroke could land. The same guard made some values
 * untypable: typing "4" then "5" toward "4.5" produces an intermediate "45",
 * which parses to 45000ms, which the clamp snapped to 30000 and the field
 * visibly jumped to "30" mid-edit.
 *
 * Mirrors colorPickerHexUndo.test.tsx's pattern for the #888 HEX field this
 * control now follows: a local draft shows exactly what was typed, decoupled
 * from the clamped value committed to shared state, and an external change
 * (a preset click, the parent re-rendering with a new launchDelayMs after the
 * commit echoes back) takes over the draft the same way a picked colour
 * replaces the HEX draft.
 *
 * A half-typed type="number" value like "4." cannot be reproduced through
 * jsdom's own number-input value sanitization the way Chromium's would be,
 * so the full "clear the field, type 4.5, save, reopen" round trip and the
 * focus-ring look are CDP checks instead (see the PR's cdp_checks), not
 * faked here.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { BehaviorSection } from '../../src/renderer/src/components/settings/BehaviorSection'
import { BehaviorContext } from '../../src/renderer/src/components/settings/BehaviorContext'

let root: Root | null = null
let container: HTMLElement | null = null
const onLaunchDelayMsChange = vi.fn<(delayMs: number) => void>()

// Re-rendering with a new launchDelayMs is what the parent does after the
// onChange commit echoes back through shared state, and what a preset click
// does (a change that did not come from this field's own typing).
async function render(launchDelayMs: number): Promise<void> {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root?.render(
      <BehaviorContext.Provider
        value={{
          startWithWindows: false,
          startMinimized: false,
          minimizeToTray: false,
          showTrayIcon: true,
          gracefulCloseEnabled: false,
          launchDelayMs,
          onStartWithWindowsChange: vi.fn(),
          onStartMinimizedChange: vi.fn(),
          onMinimizeToTrayChange: vi.fn(),
          onShowTrayIconChange: vi.fn(),
          onGracefulCloseEnabledChange: vi.fn(),
          onLaunchDelayMsChange
        }}
      >
        <BehaviorSection />
      </BehaviorContext.Provider>
    )
  })
}

function delayInput(): HTMLInputElement {
  const input = container?.querySelector('input[aria-label="Custom launch delay in seconds"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('launch delay input not rendered')
  return input
}

// React listens for the native `input` event and reads the value through the
// element's own descriptor, so a test has to set it the way a keystroke
// would: via the prototype setter, past React's value tracker, then dispatch.
async function typeInto(value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('HTMLInputElement value setter not found')
  await act(async () => {
    const input = delayInput()
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function blur(): Promise<void> {
  await act(async () => {
    delayInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
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
  onLaunchDelayMsChange.mockReset()
})

describe('BehaviorSection custom launch-delay field keeps what was typed (#959)', () => {
  test('clearing the field is shown, not silently reverted', async () => {
    await render(3000)
    expect(delayInput().value).toBe('3')

    await typeInto('')
    // The old bug: parseFloat('') is NaN, the commit is skipped, and the
    // controlled value snapped straight back to '3' before the next
    // keystroke could land.
    expect(onLaunchDelayMsChange).not.toHaveBeenCalled()
    expect(delayInput().value).toBe('')
  })

  test('typing "4" then "5" does not jump the field to the clamp ceiling', async () => {
    await render(3000)

    await typeInto('4')
    expect(onLaunchDelayMsChange).toHaveBeenLastCalledWith(4000)
    // The parent echoes the committed value back; the draft must survive it
    // because it is exactly what the HEX field's analogous echo-write did.
    await render(4000)
    expect(delayInput().value).toBe('4')

    // "45" parses to 45s, which shared state clamps to 30s - but the field
    // must keep showing exactly the digits typed, not the clamped 30.
    await typeInto('45')
    expect(onLaunchDelayMsChange).toHaveBeenLastCalledWith(30000)
    await render(30000)
    expect(delayInput().value).toBe('45')
  })

  test('clearing then typing 4.5 reaches a value no preset can reach', async () => {
    // jsdom's own type="number" value sanitization rejects a half-typed
    // intermediate like "4." (it reads back as ''), unlike a real browser,
    // so only the start (cleared) and end (settled on 4.5) of this edit are
    // checked here; the mid-typing shape is a CDP check instead.
    await render(3000)

    await typeInto('')
    expect(onLaunchDelayMsChange).not.toHaveBeenCalled()

    await typeInto('4.5')
    expect(onLaunchDelayMsChange).toHaveBeenLastCalledWith(4500)
    expect(delayInput().value).toBe('4.5')
  })

  test('a preset click replaces the draft', async () => {
    await render(3000)
    await typeInto('45')
    await render(30000)
    expect(delayInput().value).toBe('45')

    // A preset click is an external change: it overrides whatever is
    // mid-typed, same as a colour picked elsewhere replaces the HEX draft.
    await render(1500)
    expect(delayInput().value).toBe('1.5')
  })

  test('blur restores the value in effect, discarding an unfinished draft', async () => {
    await render(3000)

    await typeInto('')
    expect(delayInput().value).toBe('')

    await blur()
    expect(delayInput().value).toBe('3')
    // Blur never calls back into shared state (unlike handleSave's
    // normalizeLaunchDelayMs fallback) - an unfinished draft must not
    // silently commit anything on its own just by losing focus.
    expect(onLaunchDelayMsChange).not.toHaveBeenCalled()
  })
})
