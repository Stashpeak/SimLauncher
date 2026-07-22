/**
 * #765 — the "Profile name" field must keep its visible <label> programmatically
 * associated with the <input> (htmlFor/id via useId), so screen readers announce
 * the field and clicking the label focuses it. Guards the a11y association
 * against regressions (someone dropping htmlFor/id or breaking the id match) and
 * proves the native label association stands on its own without a redundant
 * aria-label.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ProfileNameSection } from '../../src/renderer/src/components/profile-editor/ProfileNameSection'

let root: Root | null = null
let container: HTMLElement | null = null

async function renderSection(): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container as HTMLElement)
    root.render(<ProfileNameSection profileName="Default" onProfileNameChange={() => {}} />)
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
})

describe('ProfileNameSection label association (#765)', () => {
  test('the visible label is programmatically associated with the input', async () => {
    const view = await renderSection()

    const label = view.querySelector('label')
    const input = view.querySelector('input')

    expect(label?.textContent?.trim()).toBe('Profile name')
    expect(input).not.toBeNull()

    // useId gives the input a non-empty id and the label points at it. jsdom
    // resolves HTMLLabelElement.control via htmlFor/id, so this is null the
    // moment the pairing breaks — the exact regression this test guards.
    expect(input?.id).toBeTruthy()
    expect(label?.htmlFor).toBe(input?.id)
    expect(label?.control).toBe(input)
  })

  test('the label supplies the accessible name without a redundant aria-label', async () => {
    const view = await renderSection()

    const input = view.querySelector('input')

    // The <label> is the single source of the accessible name; a leftover
    // aria-label would be redundant ARIA (and drift if the visible text changes).
    expect(input?.hasAttribute('aria-label')).toBe(false)
  })
})
