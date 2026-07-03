/**
 * Regression test for #643 (ux: clarify the launch-button label).
 *
 * The launch button previously said just "Launch" (tooltip) / "Launch <game>"
 * (aria-label) regardless of which profile would actually run — ambiguous the
 * moment a game has more than one profile. Pinned behavior:
 *   1. Default single-profile case: label stays the plain "Launch <game>"
 *      (no redundant "— Default profile" noise for the common case).
 *   2. Named non-default profile: label grows to "Launch <game> — <profile>
 *      profile" so it's unambiguous which profile/apps are about to start.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const launchProfileMock = vi.fn().mockResolvedValue({ success: true, launchedCount: 1 })

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: (...args: unknown[]) => launchProfileMock(...args),
  killLaunchedApps: vi.fn(),
  relaunchMissingProfile: vi.fn(),
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

// Mutable so each test can point the active profile at a different entry
// without re-mocking the module.
let activeProfileSet = {
  activeProfileId: 'default',
  profiles: [{ id: 'default', name: 'Default' }]
}

vi.mock('../../src/renderer/src/hooks/useGameProfile', () => ({
  useGameProfile: () => ({
    profileSet: activeProfileSet,
    profileState: { killControlsEnabled: true, relaunchControlsEnabled: true },
    loadProfileSet: vi.fn().mockResolvedValue(activeProfileSet),
    getProfileRuntimeConfig: vi.fn().mockResolvedValue(activeProfileSet),
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

const GAME: Game = { key: 'ac', name: 'Assetto Corsa', icon: 'assets/ac.png' }

let container: HTMLDivElement
let root: Root | null = null

async function renderRow(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppDirtyProvider>
        <GameRow
          game={GAME}
          isActive={false}
          isRunning={false}
          isGameRunning={false}
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

beforeEach(() => {
  launchProfileMock.mockClear()
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('GameRow launch button label (#643)', () => {
  test('default single profile: label stays the plain "Launch <game>"', async () => {
    activeProfileSet = {
      activeProfileId: 'default',
      profiles: [{ id: 'default', name: 'Default' }]
    }
    await renderRow()

    const playButton = container.querySelector('button[aria-label="Launch Assetto Corsa"]')
    expect(playButton).not.toBeNull()
  })

  test('named non-default profile: label names the profile that will launch', async () => {
    activeProfileSet = {
      activeProfileId: 'rain',
      profiles: [{ id: 'rain', name: 'Rain Setup' }]
    }
    await renderRow()

    const playButton = container.querySelector(
      'button[aria-label="Launch Assetto Corsa — Rain Setup profile"]'
    )
    expect(playButton).not.toBeNull()
  })
})
