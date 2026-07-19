/**
 * #737 — a game whose green "Running" dot is driven by a stale process-name-
 * mismatch entry (a launcher stub that self-exited, e.g. BeamNG) must be
 * dismissable from the game icon itself: a right-click / keyboard Dismiss menu
 * mirroring the running-strip warning affordance (#543). A normally-running game
 * icon stays inert (plain dot, no menu).
 */

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const dismissAppIconMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/renderer/src/lib/electron', () => ({
  dismissAppIcon: (...args: unknown[]) => dismissAppIconMock(...args)
}))

// useDismissMenu reads useNotify to surface dismiss failures; capture notify so
// the failure path can be asserted, and stub the provider so no toast portal
// mounts.
const notifyMock = vi.fn()
vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: notifyMock, announce: vi.fn() }),
  NotifyProvider: ({ children }: { children: React.ReactNode }) => children
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

import { GameIcon } from '../../src/renderer/src/components/game-list/GameIcon'

const GAME = { key: 'beamng', name: 'BeamNG.drive', icon: 'assets/beamng.png' }
const GAME_PATH = 'C:/Games/BeamNG.drive/BeamNG.drive.exe'
const WARNING =
  'BeamNG.drive.exe exited shortly after launch. It likely spawned a child process under a different name. Right-click the icon to dismiss this warning.'
const ICON = 'data:image/png;base64,AAAA'

let container: HTMLDivElement
let root: Root | null = null

async function render(element: ReactElement): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(element)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  dismissAppIconMock.mockClear()
  notifyMock.mockClear()
})

describe('GameIcon dismiss menu (#737)', () => {
  test('a normal running dot is inert (no button, no menu affordance)', async () => {
    await render(<GameIcon game={GAME} isRunning={true} iconUrl={ICON} />)
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull()
  })

  test('a stuck-warning dot is a focusable trigger that advertises its menu', async () => {
    await render(
      <GameIcon
        game={GAME}
        isRunning={true}
        iconUrl={ICON}
        warning={WARNING}
        dismissPath={GAME_PATH}
      />
    )
    const trigger = container.querySelector('button')
    expect(trigger).not.toBeNull()
    expect(trigger!.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger!.getAttribute('aria-label')).toContain('BeamNG.drive')
    expect(trigger!.getAttribute('aria-label')).toContain('exited shortly after launch')
    // Native button is in the tab order (keyboard/Narrator reachable, WCAG 2.1.1).
    expect(trigger!.tabIndex).toBe(0)
  })

  test('clicking the trigger opens Dismiss, which dismisses with the game path + key', async () => {
    await render(
      <GameIcon
        game={GAME}
        isRunning={true}
        iconUrl={ICON}
        warning={WARNING}
        dismissPath={GAME_PATH}
      />
    )
    const trigger = container.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
    expect(document.body.querySelector('[role="menuitem"]')).toBeNull()

    await act(async () => {
      trigger.click()
    })

    const menuItem = document.body.querySelector('[role="menuitem"]') as HTMLButtonElement
    expect(menuItem).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      menuItem.click()
    })
    expect(dismissAppIconMock).toHaveBeenCalledWith(GAME_PATH, 'beamng')
  })

  test('an untracked (mismatch stub) warning labels the action "Dismiss Icon"', async () => {
    await render(
      <GameIcon
        game={GAME}
        isRunning={true}
        iconUrl={ICON}
        warning={WARNING}
        dismissPath={GAME_PATH}
      />
    )
    const trigger = container.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
    await act(async () => {
      trigger.click()
    })
    const menuItem = document.body.querySelector('[role="menuitem"]') as HTMLButtonElement
    // Orphaned stub icon: dismissing removes the badge, so "Dismiss Icon".
    expect(menuItem.textContent).toBe('Dismiss Icon for BeamNG.drive')
  })

  test('a tracked (still-running kill-failed) warning labels the action "Dismiss Warning"', async () => {
    // The game exe failed to Close and is still running (tracked): dismissing
    // clears the warning but the live process keeps the dot, so "Dismiss
    // Warning" is the honest label — not "Dismiss Icon" (Codex P2, #764).
    await render(
      <GameIcon
        game={GAME}
        isRunning={true}
        iconUrl={ICON}
        warning={WARNING}
        dismissPath={GAME_PATH}
        tracked={true}
      />
    )
    const trigger = container.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
    await act(async () => {
      trigger.click()
    })
    const menuItem = document.body.querySelector('[role="menuitem"]') as HTMLButtonElement
    expect(menuItem.textContent).toBe('Dismiss Warning for BeamNG.drive')
  })

  test('a warning without isRunning shows no dismissable dot', async () => {
    await render(
      <GameIcon
        game={GAME}
        isRunning={false}
        iconUrl={ICON}
        warning={WARNING}
        dismissPath={GAME_PATH}
      />
    )
    expect(container.querySelector('button')).toBeNull()
  })

  test('a failed dismiss notifies the user instead of failing silently', async () => {
    // The menu closes optimistically, so a rejected dismiss would otherwise
    // leave the dot in place with no feedback (#764 CodeRabbit).
    dismissAppIconMock.mockRejectedValueOnce(new Error('ipc down'))
    await render(
      <GameIcon
        game={GAME}
        isRunning={true}
        iconUrl={ICON}
        warning={WARNING}
        dismissPath={GAME_PATH}
      />
    )
    const trigger = container.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
    await act(async () => {
      trigger.click()
    })
    const menuItem = document.body.querySelector('[role="menuitem"]') as HTMLButtonElement
    await act(async () => {
      menuItem.click()
      // Flush the rejected dismiss so its catch (which notifies) runs.
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(notifyMock).toHaveBeenCalledWith('Failed to dismiss warning', 'error')
  })
})
