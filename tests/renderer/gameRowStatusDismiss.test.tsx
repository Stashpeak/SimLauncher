/**
 * Wiring test for #737 Part 2 (stashpeak-review-bot finding on PR #764).
 *
 * GameIcon's stuck-dot Dismiss menu and findGameExeRunningApp are each unit-
 * tested in isolation, but nothing exercised the SEAM that connects them: GameRow
 * forwarding a mismatch-warning entry's `warning` + `dismissPath` down to
 * GameIcon. Because both props are OPTIONAL, a dropped forward would silently
 * break the feature without tripping TypeScript. This renders the real GameRow →
 * GameIcon → useDismissMenu chain with a warning-carrying entry and confirms the
 * forwarded path is what ultimately reaches the dismiss IPC.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const dismissAppIconMock = vi.fn().mockResolvedValue(undefined)

// GameRow imports these directly from lib/electron; window.electronAPI is
// undefined in jsdom, so the real module would crash at eval. dismissAppIcon is
// the one exercised here (via GameIcon → useDismissMenu); the rest are inert.
vi.mock('../../src/renderer/src/lib/electron', () => ({
  dismissAppIcon: (...args: unknown[]) => dismissAppIconMock(...args),
  launchProfile: vi.fn(),
  killLaunchedApps: vi.fn(),
  relaunchMissingProfile: vi.fn(),
  getProfileSwitchDiff: vi.fn(),
  switchProfileApps: vi.fn()
}))

// See gameRowLaunchAnnounce.test.tsx — ProfileEditor's hook graph grabs
// window.electronAPI at module eval; no-op store stubs are safe here.
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

const PROFILE_SET = {
  activeProfileId: 'default',
  profiles: [{ id: 'default', name: 'Default' }]
}

vi.mock('../../src/renderer/src/hooks/useGameProfile', () => ({
  useGameProfile: () => ({
    profileSet: PROFILE_SET,
    profileState: { killControlsEnabled: true, relaunchControlsEnabled: true },
    loadProfileSet: vi.fn().mockResolvedValue(PROFILE_SET),
    getProfileRuntimeConfig: vi.fn().mockResolvedValue(PROFILE_SET),
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
import { AppDirtyProvider } from '../../src/renderer/src/contexts/AppDirtyContext'
import type { Game } from '../../src/renderer/src/lib/config'

const GAME: Game = { key: 'beamng', name: 'BeamNG.drive', icon: 'assets/beamng.png' }
const GAME_PATH = 'C:/Games/BeamNG.drive/BeamNG.drive.exe'
const WARNING =
  'BeamNG.drive.exe exited shortly after launch. It likely spawned a child process under a different name. Right-click the icon to dismiss this warning.'

let container: HTMLDivElement
let root: Root | null = null

async function renderRow(props: { warning?: string; dismissPath?: string } = {}): Promise<void> {
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
          gameStatusWarning={props.warning}
          gameStatusDismissPath={props.dismissPath}
          runningAppIcons={[]}
          isDimmed={false}
          isLaunching={false}
          isLaunchBlocked={false}
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

// The icon's Dismiss trigger is the button whose accessible name carries the
// warning text — scoped this way so it isn't confused with the row's other
// menu-bearing controls (e.g. the profile switcher).
function findDismissTrigger(): HTMLButtonElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')
  ).find((button) => button.getAttribute('aria-label')?.includes('exited shortly after launch'))
}

beforeEach(() => {
  dismissAppIconMock.mockClear()
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('GameRow → GameIcon stuck-dot wiring (#737 Part 2)', () => {
  test('a running game with no status warning renders no icon Dismiss trigger', async () => {
    await renderRow()
    expect(findDismissTrigger()).toBeUndefined()
  })

  test('forwarding a warning + dismissPath arms the icon as a Dismiss trigger', async () => {
    await renderRow({ warning: WARNING, dismissPath: GAME_PATH })

    const trigger = findDismissTrigger()
    expect(trigger).not.toBeUndefined()
    expect(trigger!.getAttribute('aria-label')).toContain('BeamNG.drive')
  })

  test('dismissing through the forwarded chain calls dismiss with the game path + key', async () => {
    await renderRow({ warning: WARNING, dismissPath: GAME_PATH })

    const trigger = findDismissTrigger()!
    await act(async () => {
      trigger.click()
    })

    const menuItem = document.body.querySelector('[role="menuitem"]') as HTMLButtonElement
    expect(menuItem).not.toBeNull()

    await act(async () => {
      menuItem.click()
    })

    // The path that reaches the dismiss IPC is the one GameRow forwarded as
    // gameStatusDismissPath — proving the full prop chain, not just GameIcon.
    expect(dismissAppIconMock).toHaveBeenCalledWith(GAME_PATH, 'beamng')
  })
})
