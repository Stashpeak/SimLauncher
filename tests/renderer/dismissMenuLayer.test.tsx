/**
 * #941: the Dismiss menu (right-click or keyboard on a running-app icon or the
 * stuck status dot) portalled to document.body at z-9999. Every dialog
 * portals to body at z-100 or above and useFocusTrap only marks #root inert,
 * so a dialog that opened without a pointer or key on the page (the OS close
 * request with unsaved changes) left the menu above it and clickable: a
 * dismiss could fire while the close decision was pending. The profile menu
 * had the same hole and was moved into #root at z-50 (#940); this pins the
 * same placement for the Dismiss menu, through the strip that uses it. The
 * stuck-status dot shares the hook (useDismissMenu).
 */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../src/renderer/src/lib/electron', () => ({
  dismissAppIcon: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: vi.fn(), announce: vi.fn() }),
  NotifyProvider: ({ children }: { children: React.ReactNode }) => children
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

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

// Mounts the strip into `host` and opens the Dismiss menu from its trigger.
async function openMenu(host: HTMLElement): Promise<HTMLElement> {
  const container = document.createElement('div')
  host.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<RunningAppsStrip runningAppIcons={[WARNING_APP]} cacheInitialized={true} />)
  })
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
  expect(trigger).not.toBeNull()
  await act(async () => {
    trigger!.click()
  })
  const menu = document.body.querySelector<HTMLElement>('[role="menu"]')
  expect(menu).not.toBeNull()
  return menu!
}

describe('the Dismiss menu sits under the dialog layer (#941)', () => {
  test('inside #root at z-50, so a dialog covers it and inerts it with the app', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.appendChild(appRoot)

    const menu = await openMenu(appRoot)
    expect(appRoot.contains(menu)).toBe(true)

    // What useFocusTrap does while a dialog is open.
    appRoot.setAttribute('inert', '')
    expect(menu.closest('[inert]')).toBe(appRoot)

    // Above everything inside the app (nothing there is above z-40), below
    // every dialog (z-100 and up in body). Unlike the profile menu, the
    // floating wrapper here is itself the role="menu" element.
    expect(menu.classList.contains('z-50')).toBe(true)
    expect(menu.classList.contains('z-9999')).toBe(false)
  })

  test('without a #root (as in other tests) it still renders, into body', async () => {
    const menu = await openMenu(document.body)
    expect(document.body.contains(menu)).toBe(true)
    expect(menu.textContent).toContain('Dismiss')
  })
})
