/**
 * Regression test for #670: "Close Apps" during an in-flight launch sequence
 * used to only kill what was already running — the main-process launch loop
 * kept going and spawned the remaining profile apps regardless, ending in a
 * plain "All profile applications launched." success toast for apps the user
 * had just asked to close.
 *
 * Pinned here: when `launchProfile`/`relaunchMissingProfile` resolves with
 * `cancelled: true`, the row's toast must read as a neutral cancellation
 * ("Launch cancelled — closed apps instead.") — never the success toast, and
 * never the plain error toast either.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const notifyMock = vi.fn()
const launchProfileMock = vi.fn()
const relaunchMissingProfileMock = vi.fn()

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: (...args: unknown[]) => launchProfileMock(...args),
  killLaunchedApps: vi.fn(),
  relaunchMissingProfile: (...args: unknown[]) => relaunchMissingProfileMock(...args),
  getProfileSwitchDiff: vi.fn(),
  switchProfileApps: vi.fn()
}))

// Same jsdom-safety stubs as gameRowLaunchSkipped.test.tsx: GameRow pulls in
// ProfileEditor's hook graph, which touches window.electronAPI at module eval.
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
  useNotify: () => ({ notify: notifyMock, announce: vi.fn() }),
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

async function clickPlayButton(): Promise<void> {
  const playButton = container.querySelector(
    'button[aria-label="Launch Assetto Corsa"]'
  ) as HTMLButtonElement | null
  expect(playButton).not.toBeNull()

  await act(async () => {
    playButton!.click()
  })
}

beforeEach(() => {
  notifyMock.mockClear()
  launchProfileMock.mockReset()
  relaunchMissingProfileMock.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('GameRow launch cancellation toast (#670)', () => {
  test('shows a neutral cancellation toast instead of the success toast', async () => {
    launchProfileMock.mockResolvedValue({
      success: false,
      cancelled: true,
      launchedCount: 1,
      message: 'Launch cancelled — closed apps instead.'
    })

    await renderRow()
    await clickPlayButton()

    expect(notifyMock).toHaveBeenCalledWith('Launch cancelled — closed apps instead.', 'warn')
    expect(notifyMock).not.toHaveBeenCalledWith(
      expect.stringContaining('All profile applications launched.'),
      'success',
      expect.anything()
    )
  })

  test('falls back to a default message when the result carries no message', async () => {
    launchProfileMock.mockResolvedValue({
      success: false,
      cancelled: true,
      launchedCount: 1
    })

    await renderRow()
    await clickPlayButton()

    expect(notifyMock).toHaveBeenCalledWith('Launch cancelled — closed apps instead.', 'warn')
  })

  // cancelled must be checked before the plain failure branch — otherwise a
  // cancellation (success: false) would read as a generic launch error.
  test('does not fall through to the generic failure toast', async () => {
    launchProfileMock.mockResolvedValue({
      success: false,
      cancelled: true,
      launchedCount: 1,
      message: 'Launch cancelled — closed apps instead.'
    })

    await renderRow()
    await clickPlayButton()

    expect(notifyMock).not.toHaveBeenCalledWith('Failed to launch profile', 'error')
  })
})
