/**
 * Tabbing to a Settings section heading drew a square focus ring while every
 * other ring in the app is rounded (#955). The heading's disclosure button gets
 * its ring from the shared `button:focus-visible` fallback in App.css, and an
 * outline follows the element's own border-radius, which the button did not
 * have. The fallback cannot supply one, because the same rule serves round
 * controls too, so the radius belongs on the button, and that is what this pins.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { SettingsSection } from '../../src/renderer/src/components/settings/SettingsSection'

let root: Root | null = null
let container: HTMLElement | null = null

// A radius on all four corners. A one-sided class such as `rounded-l-full`
// would still leave two square corners on the ring.
const ALL_CORNERS = /^rounded(-(sm|md|lg|xl|2xl|3xl|full))?$/

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
})

describe('SettingsSection heading focus ring (#955)', () => {
  test('the disclosure button carries its own radius, so the ring is rounded', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container as HTMLElement)
      root.render(
        <SettingsSection title="Config" sectionKey="config" open={false} onOpenChange={vi.fn()}>
          <p>content</p>
        </SettingsSection>
      )
    })

    const disclosure = container.querySelector('button[aria-expanded]')
    expect(disclosure).not.toBeNull()
    // The browser draws the ring around the focused element itself, so the
    // radius has to be on the button, not on the heading or the label span.
    expect(Array.from(disclosure?.classList ?? []).some((name) => ALL_CORNERS.test(name))).toBe(
      true
    )
  })
})
