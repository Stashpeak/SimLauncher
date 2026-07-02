/**
 * Covers the Escape-to-dismiss support added to useFocusTrap (#515). Two of the
 * three modal surfaces (ImportPreviewDialog, ColorPickerPopover) had no Escape
 * handler; they now pass onEscape through the shared hook, which closes on
 * Escape in the capture phase + stopImmediatePropagation so the key can't leak
 * to background keydown handlers.
 */

import { afterEach, expect, test, vi } from 'vitest'
import { useRef } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useFocusTrap } from '../../src/renderer/src/hooks/useFocusTrap'

function Harness({ onEscape }: { onEscape?: () => void }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(true, ref, undefined, onEscape)
  return (
    <div ref={ref}>
      <button type="button">inside</button>
    </div>
  )
}

let activeRoot: Root | null = null
let activeContainer: HTMLDivElement | null = null

async function render(onEscape?: () => void): Promise<HTMLButtonElement> {
  activeContainer = document.createElement('div')
  document.body.appendChild(activeContainer)
  await act(async () => {
    activeRoot = createRoot(activeContainer!)
    activeRoot.render(<Harness onEscape={onEscape} />)
  })
  return activeContainer.querySelector('button')!
}

function pressEscape(target: Element): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  })
}

afterEach(() => {
  if (activeRoot) act(() => activeRoot!.unmount())
  activeContainer?.remove()
  activeRoot = null
  activeContainer = null
})

test('Escape invokes onEscape when provided', async () => {
  const onEscape = vi.fn()
  const button = await render(onEscape)

  pressEscape(button)

  expect(onEscape).toHaveBeenCalledTimes(1)
})

test('Escape is stopped in the capture phase so background handlers do not also fire', async () => {
  const onEscape = vi.fn()
  const background = vi.fn()
  document.addEventListener('keydown', background)
  const button = await render(onEscape)

  pressEscape(button)

  expect(onEscape).toHaveBeenCalledTimes(1)
  expect(background).not.toHaveBeenCalled()
  document.removeEventListener('keydown', background)
})

test('Escape with no onEscape is a no-op and lets the event reach background handlers', async () => {
  const background = vi.fn()
  document.addEventListener('keydown', background)
  const button = await render(undefined)

  pressEscape(button)

  expect(background).toHaveBeenCalledTimes(1)
  document.removeEventListener('keydown', background)
})

// #641: a color picker opened from within the onboarding modal stacks two traps.
// Both register document-capture Escape listeners; without a stack the outer
// (first-registered) one would stopImmediatePropagation and skip onboarding
// instead of just closing the picker.
test('with stacked traps, only the topmost (most recently opened) reacts to Escape', async () => {
  const outerEscape = vi.fn()
  const innerEscape = vi.fn()

  const outerContainer = document.createElement('div')
  document.body.appendChild(outerContainer)
  const outerRoot = createRoot(outerContainer)
  await act(async () => {
    outerRoot.render(<Harness onEscape={outerEscape} />)
  })

  const innerContainer = document.createElement('div')
  document.body.appendChild(innerContainer)
  const innerRoot = createRoot(innerContainer)
  await act(async () => {
    innerRoot.render(<Harness onEscape={innerEscape} />)
  })

  // Topmost (inner) trap handles Escape; the outer one underneath does not.
  pressEscape(innerContainer.querySelector('button')!)
  expect(innerEscape).toHaveBeenCalledTimes(1)
  expect(outerEscape).not.toHaveBeenCalled()

  // Close the inner trap → the outer becomes topmost and now handles Escape.
  await act(async () => innerRoot.unmount())
  innerContainer.remove()

  pressEscape(outerContainer.querySelector('button')!)
  expect(outerEscape).toHaveBeenCalledTimes(1)
  expect(innerEscape).toHaveBeenCalledTimes(1)

  await act(async () => outerRoot.unmount())
  outerContainer.remove()
})
