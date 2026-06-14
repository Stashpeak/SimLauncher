/**
 * Regression test for #543 — the running-app warning trigger must be reachable
 * and operable by keyboard / Narrator, not mouse-only.
 *
 * Previously the warning icon was an <img>/role="img" whose Dismiss menu opened
 * only via onContextMenu (right-click), so keyboard and screen-reader users hit
 * a WCAG 2.1.1 dead end. The trigger is now a real <button> (aria-haspopup) that
 * opens the menu on click / Enter / Space; non-warning icons stay inert.
 */

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const dismissAppIconMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/renderer/src/lib/electron', () => ({
  dismissAppIcon: (...args: unknown[]) => dismissAppIconMock(...args)
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

import {
  RunningAppsStrip,
  type RunningAppIcon
} from '../../src/renderer/src/components/game-list/RunningAppsStrip'

const WARNING_APP: RunningAppIcon = {
  icon: 'data:image/png;base64,AAAA',
  name: 'obs64.exe',
  path: 'C:/Apps/obs64.exe',
  gameKey: 'iracing',
  warning: 'Running under a different process name'
}

const NORMAL_APP: RunningAppIcon = {
  icon: 'data:image/png;base64,BBBB',
  name: 'discord.exe',
  path: 'C:/Apps/discord.exe',
  gameKey: 'iracing'
}

let container: HTMLDivElement
let root: Root | null = null

async function render(apps: RunningAppIcon[]): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<RunningAppsStrip runningAppIcons={apps} cacheInitialized={true} />)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  dismissAppIconMock.mockClear()
})

describe('RunningAppsStrip warning trigger (#543)', () => {
  test('a warning icon is a focusable button that advertises its menu; a normal icon is not', async () => {
    await render([WARNING_APP, NORMAL_APP])

    const buttons = container.querySelectorAll('button')
    // Exactly one trigger button (the warning); the menu's Dismiss button only
    // exists once opened.
    expect(buttons.length).toBe(1)

    const trigger = buttons[0]
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-label')).toContain('obs64.exe')
    expect(trigger.getAttribute('aria-label')).toContain('Running under a different process name')
    // Native buttons are in the tab order (not tabIndex=-1).
    expect(trigger.tabIndex).toBe(0)

    // The non-warning icon is an inert <img>, never a button.
    expect(container.querySelector('img[alt=""]')).not.toBeNull()
  })

  test('clicking the warning trigger opens the Dismiss menu (no mouse-only dead end)', async () => {
    await render([WARNING_APP])

    const trigger = container.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
    expect(trigger).not.toBeNull()
    expect(document.body.querySelector('[role="menuitem"]')).toBeNull()

    await act(async () => {
      trigger.click()
    })

    const menuItem = document.body.querySelector('[role="menuitem"]')
    expect(menuItem).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })
})
