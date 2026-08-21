/**
 * #737 — a game whose green "Running" dot is driven by a stale process-name-
 * mismatch entry (a launcher stub that self-exited, e.g. BeamNG) must be
 * dismissable from the game icon itself: a right-click / keyboard Dismiss menu
 * mirroring the running-strip warning affordance (#543). A normally-running game
 * icon stays inert (plain dot, no menu).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
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

  // The dot's colour is the only thing a sighted user reads off the icon, and
  // for a mismatch-warning entry "running" is not a fact we have: the entry is
  // surfaced precisely because the launched exe is gone from the tasklist, which
  // means either it exited or it handed off to a child under another name.
  // Pinned here because nothing else can catch it: the class is the whole fix.
  const dotClass = () => container.querySelector('.status-dot')!.className

  test('an untracked mismatch warning does not claim the game is running (#737)', async () => {
    await render(
      <GameIcon
        game={GAME}
        isRunning={true}
        iconUrl={ICON}
        warning={WARNING}
        dismissPath={GAME_PATH}
      />
    )
    // The unknown state is carried by `status-dot-unknown`, whose ring and amber
    // border live in App.css. It deliberately has NO `bg-` utility: the ring's
    // fill is a gradient (the page showing through), which `background-color`
    // cannot take, and a utility would race the stylesheet on equal specificity.
    expect(dotClass()).toContain('status-dot-unknown')
    expect(dotClass()).not.toContain('bg-(--status-running)')
  })

  test('a tracked kill-failed warning keeps the running dot (#737)', async () => {
    // This one IS running: `unclosedProcesses` entries surface only while the
    // image is still in the tasklist. Amber here would turn a fact into a guess.
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
    expect(dotClass()).toContain('bg-(--status-running)')
    expect(dotClass()).not.toContain('status-dot-unknown')
  })

  test('a plain running game keeps the running dot (#737)', async () => {
    await render(<GameIcon game={GAME} isRunning={true} iconUrl={ICON} />)
    expect(dotClass()).toContain('bg-(--status-running)')
    expect(dotClass()).not.toContain('status-dot-unknown')
  })

  // The general case, and the reason the dot is not amber-only: colour alone
  // fails WCAG 1.4.1, and green-versus-amber is the pair red-green colour vision
  // deficiency compresses hardest, so at 12px the hue difference was a
  // discrimination task rather than a glance (David's call on #737).
  //
  // Pinned the same way as the forced-colors rule below and for the same reason:
  // jsdom applies no stylesheet, so no rendering assertion can see a ring. A
  // class name in a component and a selector in a stylesheet drift apart
  // silently, and this asserts both ends plus the two declarations that make it
  // a ring rather than a disc.
  test('the unknown dot is a ring in every theme, not only in forced-colors (#737)', async () => {
    await render(
      <GameIcon
        game={GAME}
        isRunning={true}
        iconUrl={ICON}
        warning={WARNING}
        dismissPath={GAME_PATH}
      />
    )
    expect(dotClass()).toContain('status-dot-unknown')

    const css = readFileSync(path.join(process.cwd(), 'src/renderer/src/App.css'), 'utf8')
    const forcedColorsAt = css.indexOf('@media (forced-colors: active)')
    const generalAt = css.indexOf('.status-dot-unknown {')

    // BEFORE the media query, i.e. not inside it. A rule that only exists in
    // forced-colors is what this test exists to rule out.
    expect(generalAt).toBeGreaterThan(-1)
    expect(generalAt).toBeLessThan(forcedColorsAt)

    const rule = css.slice(generalAt, css.indexOf('}', generalAt))
    // The border is what makes it a shape; the gradient fill is what keeps the
    // hole reading as the page rather than a hole punched in the game artwork.
    expect(rule).toContain('border: 2px solid var(--status-warning)')
    expect(rule).toContain('background: var(--bg-gradient)')
  })

  // Windows High Contrast strips every `.status-dot` to a single system colour,
  // so amber cannot carry the distinction there (Codex P2 on #829). A shape
  // does, via a forced-colors rule keyed on `status-dot-unknown`. Both ends are
  // pinned here because a class name in a component and a selector in a
  // stylesheet drift apart silently, and no rendering assertion can catch it:
  // jsdom applies no media queries, so the dot renders identically either way.
  test('the unknown dot keeps a non-colour distinction in forced-colors (#737)', async () => {
    await render(
      <GameIcon
        game={GAME}
        isRunning={true}
        iconUrl={ICON}
        warning={WARNING}
        dismissPath={GAME_PATH}
      />
    )
    expect(dotClass()).toContain('status-dot-unknown')

    const css = readFileSync(path.join(process.cwd(), 'src/renderer/src/App.css'), 'utf8')
    const forcedColorsAt = css.indexOf('@media (forced-colors: active)')
    expect(forcedColorsAt).toBeGreaterThan(-1)
    const statusDotAt = css.indexOf('.status-dot {', forcedColorsAt)
    const unknownAt = css.indexOf('.status-dot-unknown {', forcedColorsAt)
    expect(unknownAt).toBeGreaterThan(-1)
    // Same specificity and both !important, so source order is what decides
    // which background wins. The override has to come second.
    expect(unknownAt).toBeGreaterThan(statusDotAt)
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
