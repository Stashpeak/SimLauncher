/**
 * Regression test for #830 (ux: the blocked Relaunch missing apps button still
 * advertises itself on hover).
 *
 * While a launch is in flight, or in its 10s post-launch cooldown, the relaunch
 * and primary buttons do nothing. They used to keep naming their action anyway:
 * "Relaunch missing apps" / "Launch <game>: <profile> profile", with no hint
 * that it was unavailable or that it was temporary.
 *
 * `isLaunchBlocked` is GLOBAL (`launchingGameKey !== null` in GameList), so it
 * is true for every row while any one game launches. The reason therefore has
 * two forms and both are pinned below, because the copy is the whole fix.
 *
 * Also pinned: the buttons carry `aria-disabled` and NOT `disabled`. That is
 * not a style preference. A `disabled` button leaves the tab order and is
 * dispatched no mouse events, so the tooltip explaining the block would be
 * unreachable by hover AND by keyboard, which is precisely backwards.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import fs from 'node:fs'
import path from 'node:path'

const launchProfileMock = vi.fn().mockResolvedValue({ success: true, launchedCount: 1 })
const relaunchMissingProfileMock = vi.fn().mockResolvedValue({ success: true, launchedCount: 1 })

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: (...args: unknown[]) => launchProfileMock(...args),
  killLaunchedApps: vi.fn(),
  relaunchMissingProfile: (...args: unknown[]) => relaunchMissingProfileMock(...args),
  getProfileSwitchDiff: vi.fn(),
  switchProfileApps: vi.fn()
}))

vi.mock('../../src/renderer/src/lib/store', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  getProfiles: vi.fn(),
  saveProfile: vi.fn(),
  saveProfiles: vi.fn(),
  getMigrationFlags: vi.fn(),
  setMigrationFlags: vi.fn(),
  onStoreConfigChanged: vi.fn(),
  exportConfig: vi.fn(),
  previewImportConfig: vi.fn(),
  applyImportConfig: vi.fn(),
  cancelImportConfig: vi.fn()
}))

vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: vi.fn(), announce: vi.fn() }),
  NotifyProvider: ({ children }: { children: React.ReactNode }) => children
}))

const activeProfileSet = {
  activeProfileId: 'default',
  profiles: [{ id: 'default', name: 'Default' }]
}

vi.mock('../../src/renderer/src/hooks/useGameProfile', () => ({
  useGameProfile: () => ({
    profileSet: activeProfileSet,
    profileState: { killControlsEnabled: true, relaunchControlsEnabled: true },
    loadProfileSet: vi.fn().mockResolvedValue(activeProfileSet),
    getProfileRuntimeConfig: vi.fn().mockResolvedValue(activeProfileSet),
    // `Promise<void>`, matching the hook. It briefly returned a stranded-prompt
    // count for GameRow to read, until that count moved to a push from main so
    // that no caller could drop it by not reading it (#782). Resolving to
    // anything else here would let a future GameRow start depending on a value
    // the real hook does not produce.
    saveProfileSet: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('../../src/renderer/src/hooks/useProfileMenu', () => ({
  useProfileMenu: () => ({
    profileMenuOpen: false,
    setProfileMenuOpen: vi.fn(),
    openProfileMenu: vi.fn(),
    closeProfileMenu: vi.fn(),
    newProfileFormOpen: false,
    setNewProfileFormOpen: vi.fn(),
    newProfileName: '',
    setNewProfileName: vi.fn(),
    profileMenuRef: { current: null },
    menuRef: { current: null },
    triggerRef: { current: null },
    handleProfileMenuTriggerKeyDown: vi.fn(),
    handleProfileMenuKeyDown: vi.fn(),
    newProfileInputRef: { current: null }
  })
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

import { GameRow } from '../../src/renderer/src/components/game-list/GameRow'
import { GameRowActions } from '../../src/renderer/src/components/game-list/GameRowActions'
import { AppDirtyProvider } from '../../src/renderer/src/contexts/AppDirtyContext'
import type { Game } from '../../src/renderer/src/lib/config'

const GAME: Game = { key: 'ac', name: 'Assetto Corsa', icon: 'assets/ac.png' }

const PROFILE_MENU_PROPS = {
  profileSet: activeProfileSet,
  activeProfile: activeProfileSet.profiles[0],
  profileMenuOpen: false,
  openProfileMenu: vi.fn(),
  closeProfileMenu: vi.fn(),
  profileMenuRef: { current: null },
  menuRef: { current: null },
  triggerRef: { current: null },
  handleProfileMenuTriggerKeyDown: vi.fn(),
  handleProfileMenuKeyDown: vi.fn(),
  newProfileFormOpen: false,
  newProfileName: '',
  setNewProfileName: vi.fn(),
  newProfileInputRef: { current: null },
  gameName: GAME.name,
  onProfileSelect: vi.fn(),
  onNewProfileSubmit: vi.fn()
} as unknown as React.ComponentProps<typeof GameRowActions>['profileMenuProps']

let container: HTMLDivElement
let root: Root | null = null

// `canRelaunch` is `isRunning && relaunchControlsEnabled`, so the relaunch
// button only exists with the game running. That is also the only state in
// which the bug is reachable.
async function renderRow(state: { isLaunching: boolean; isLaunchBlocked: boolean }): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppDirtyProvider>
        <GameRow
          game={GAME}
          isActive={false}
          isRunning={true}
          isGameRunning={true}
          runningAppIcons={[]}
          isDimmed={false}
          isLaunching={state.isLaunching}
          isLaunchBlocked={state.isLaunchBlocked}
          onLaunchStart={vi.fn()}
          onLaunchEnd={vi.fn()}
          onRunningStateRefresh={vi.fn().mockResolvedValue(undefined)}
          onToggleEditor={vi.fn()}
          onCloseEditor={vi.fn()}
          cacheInitialized={true}
        />
      </AppDirtyProvider>
    )
  })
}

async function renderActions(state: {
  isLaunchBlocked: boolean
  onPrimary: () => void
  onRelaunchMissing: () => void
}): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <GameRowActions
        isActive={false}
        isLaunching={false}
        isLaunchBlocked={state.isLaunchBlocked}
        canKill={false}
        canRelaunch={true}
        onPrimary={state.onPrimary}
        onKill={vi.fn()}
        onRelaunchMissing={state.onRelaunchMissing}
        onToggleEditor={vi.fn()}
        gameName={GAME.name}
        activeProfileName="Default"
        editorId="editor-ac"
        profileMenuProps={PROFILE_MENU_PROPS}
      />
    )
  })
}

function relaunchButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Relaunch missing apps"]'
  )
  if (!button) throw new Error('relaunch button not rendered')
  return button
}

function primaryButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button.launcher-play-btn')
  if (!button) throw new Error('primary button not rendered')
  return button
}

beforeEach(() => {
  launchProfileMock.mockClear()
  relaunchMissingProfileMock.mockClear()
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('blocked action buttons (#830)', () => {
  test('this game launching: both buttons say so instead of naming their action', async () => {
    await renderRow({ isLaunching: true, isLaunchBlocked: true })

    expect(relaunchButton().getAttribute('aria-label')).toBe(
      'Relaunch missing apps for Assetto Corsa. Launching, please wait'
    )
    expect(primaryButton().getAttribute('aria-label')).toBe('Launching Assetto Corsa')
  })

  // The case the report came from is more likely this one: the block outlives
  // the sequence by the 10s cooldown, and it applies to every OTHER row too,
  // where "Launching" would be a lie about which game is busy.
  test('another game launching: the reason names the other launch', async () => {
    await renderRow({ isLaunching: false, isLaunchBlocked: true })

    expect(relaunchButton().getAttribute('aria-label')).toBe(
      'Relaunch missing apps for Assetto Corsa. Another launch is in progress'
    )
    expect(primaryButton().getAttribute('aria-label')).toBe(
      'Launch Assetto Corsa: Default profile. Another launch is in progress'
    )
  })

  test('not blocked: both buttons name their action, with no disabled state', async () => {
    await renderRow({ isLaunching: false, isLaunchBlocked: false })

    expect(relaunchButton().getAttribute('aria-label')).toBe(
      'Relaunch missing apps for Assetto Corsa'
    )
    expect(primaryButton().getAttribute('aria-label')).toBe('Launch Assetto Corsa: Default profile')
    expect(relaunchButton().getAttribute('aria-disabled')).toBeNull()
    expect(primaryButton().getAttribute('aria-disabled')).toBeNull()
  })

  test('blocked buttons stay in the tab order and announce as disabled', async () => {
    await renderRow({ isLaunching: false, isLaunchBlocked: true })

    for (const button of [relaunchButton(), primaryButton()]) {
      expect(button.getAttribute('aria-disabled')).toBe('true')
      // The whole point: `disabled` would take the button out of the tab order
      // and stop it receiving the hover/focus that opens its own explanation.
      expect(button.hasAttribute('disabled')).toBe(false)
      expect(button.disabled).toBe(false)
    }
  })

  // Rendered directly rather than through GameRow, and that is the whole point
  // of the test. GameRow's own handlers already return early on isLaunchBlocked
  // (`GameRow.tsx:391` and `:494`), so a GameRow-level click assertion passes
  // whether or not these buttons guard anything: it was green with the guard
  // deleted. Dropping `disabled` moved this from the DOM's responsibility to the
  // component's, so it has to be pinned where the component answers for it.
  test('a blocked button does not invoke its own handler', async () => {
    const onPrimary = vi.fn()
    const onRelaunchMissing = vi.fn()
    await renderActions({ isLaunchBlocked: true, onPrimary, onRelaunchMissing })

    await act(async () => {
      relaunchButton().click()
      primaryButton().click()
    })

    expect(onRelaunchMissing).not.toHaveBeenCalled()
    expect(onPrimary).not.toHaveBeenCalled()
  })

  // The negative half: the same click on the same buttons, unblocked.
  test('an unblocked button still invokes its handler', async () => {
    const onPrimary = vi.fn()
    const onRelaunchMissing = vi.fn()
    await renderActions({ isLaunchBlocked: false, onPrimary, onRelaunchMissing })

    await act(async () => {
      relaunchButton().click()
      primaryButton().click()
    })

    expect(onRelaunchMissing).toHaveBeenCalledTimes(1)
    expect(onPrimary).toHaveBeenCalledTimes(1)
  })
})

// Source-level, because jsdom applies no stylesheet: dropping `disabled` for
// `aria-disabled` silently loses the dim unless App.css matches both, and every
// assertion above would still pass. This is the only thing that notices.
describe('the aria-disabled dim (#830)', () => {
  test('App.css dims aria-disabled controls exactly as it dims disabled ones', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/src/App.css'), 'utf8')
    const rule = css
      .split('}')
      .find((block) => block.includes('.icon-action:disabled') && block.includes('opacity: 0.55'))
    expect(rule).toBeTruthy()

    // Every class that gets the disabled look must get it for aria-disabled too,
    // or a control switched to aria-disabled loses its dim in one theme-wide
    // rule that nothing else covers.
    const disabledClasses = Array.from(rule!.matchAll(/\.([\w-]+):disabled/g)).map(
      (match) => match[1]
    )
    expect(disabledClasses.length).toBeGreaterThan(0)
    for (const className of disabledClasses) {
      expect(rule).toContain(`.${className}[aria-disabled='true']`)
    }
  })
})
