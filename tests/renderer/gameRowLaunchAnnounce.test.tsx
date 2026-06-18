/**
 * Regression test for #612 (a11y: spoken launch feedback + named list rows).
 *
 * Two behaviors are pinned here:
 *   1. Clicking a row's idle Play button announces "Launching <game>" through the
 *      screen-reader live region (useNotify().announce) before the launch IPC
 *      runs — the spinner / aria-busy alone are visual/verbosity-dependent, so
 *      this polite cue is the reliable spoken "launch started" feedback.
 *   2. The row's `role="listitem"` container carries `aria-label={game.name}` so
 *      Narrator names the row ("Assetto Corsa, 3 of 7") instead of synthesizing
 *      a bare list marker ("bullet") before each control in the row.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const announceMock = vi.fn()
const notifyMock = vi.fn()
const launchProfileMock = vi.fn().mockResolvedValue({ success: true, launchedCount: 1 })

// GameRow imports these directly from lib/electron. window.electronAPI is
// undefined in jsdom, so the real module would crash at eval — stub the surface
// GameRow touches. Only launchProfile is exercised here; the rest are inert.
vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: (...args: unknown[]) => launchProfileMock(...args),
  killLaunchedApps: vi.fn(),
  relaunchMissingProfile: vi.fn(),
  getProfileSwitchDiff: vi.fn(),
  switchProfileApps: vi.fn()
}))

// GameRow imports ProfileEditor, whose hook graph (useProfileEditor) pulls in
// lib/store, which grabs window.electronAPI references at module eval — crashing
// in jsdom. GameRow's own runtime never calls the store directly (the profile
// hooks that do are mocked below), so no-op stubs are safe and mask nothing.
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

// Mock useNotify so announce()/notify() are observable without rendering the
// real toast portal (jsdom lacks Element.animate, which Notify mounts).
vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: notifyMock, announce: announceMock }),
  NotifyProvider: ({ children }: { children: React.ReactNode }) => children
}))

// Stub the profile hooks so the row doesn't reach into lib/store →
// window.electronAPI (undefined in jsdom). A single default profile with the
// kill/relaunch controls absent (treated as ON) is all the launch path needs.
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
  announceMock.mockClear()
  notifyMock.mockClear()
  launchProfileMock.mockClear()
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('GameRow launch a11y (#612)', () => {
  test('clicking the idle Play button announces "Launching <name>" and launches', async () => {
    await renderRow()

    // The idle Play button (runningAppIcons empty AND not launching → canKill
    // false) is named "Launch <game>".
    const playButton = container.querySelector(
      'button[aria-label="Launch Assetto Corsa"]'
    ) as HTMLButtonElement | null
    expect(playButton).not.toBeNull()

    await act(async () => {
      playButton!.click()
    })

    expect(announceMock).toHaveBeenCalledWith('Launching Assetto Corsa')
    expect(launchProfileMock).toHaveBeenCalledWith('ac')
    // The cue must fire BEFORE the launch IPC, not merely at some point — that
    // is the #612 contract: the SR hears "Launching" at launch start.
    expect(announceMock.mock.invocationCallOrder[0]).toBeLessThan(
      launchProfileMock.mock.invocationCallOrder[0]
    )
  })

  test('the row exposes a role="listitem" whose accessible name is the game name', async () => {
    await renderRow()

    const listItem = container.querySelector('[role="listitem"]')
    expect(listItem).not.toBeNull()
    expect(listItem!.getAttribute('aria-label')).toBe('Assetto Corsa')
  })
})
