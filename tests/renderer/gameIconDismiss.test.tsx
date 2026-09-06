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
    // background (transparent, and `Canvas` under forced colors) is the
    // stylesheet's, and a utility would race it on equal specificity.
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
    // The border is what makes it a shape. The centre is transparent, so what
    // is behind the ring shows through: every fill that approximated that
    // surface missed in at least one theme when measured on the running app
    // (the page gradient alone read greyer in light; the row's glass fill over
    // the page gradient read lighter and purpler in dark, because a gradient
    // spans the element's own 12px rather than the page). #896, David's call.
    expect(rule).toContain('border: 2px solid var(--status-warning)')
    expect(rule).toContain('background: transparent')
    expect(rule).not.toContain('var(--bg-gradient)')
    expect(rule).not.toContain('var(--glass-surface-fill')
    // The glow has an inset half so the hole is lit the way the halo outside
    // it is; an outer box-shadow alone never paints inside the border box and
    // the eye read the unlit hole as a filled disc. 2.5px is the measured value
    // where hole and halo match to within a unit in both themes (#896). It is
    // the stylesheet's, so the element must not carry a shadow utility too.
    expect(rule).toContain('0 0 8px var(--status-warning)')
    expect(rule).toContain('inset 0 0 2.5px var(--status-warning)')
    expect(dotClass()).not.toContain('shadow-[')
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
