/**
 * Regression test for #639: a moved/deleted profile exe used to be filtered
 * out silently (console.error only) and the launch still reported plain
 * success as long as one other app started. The user got a positive toast
 * with no indication their game (or a companion) was skipped.
 *
 * Pinned here: when `launchProfile` resolves with a non-empty `skipped`
 * array, the row's toast must be a WARNING naming what was skipped — not the
 * plain success message — and must resolve the skipped entry's display name
 * (game title, or the exe basename for a companion) rather than the raw path.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const notifyMock = vi.fn()
const launchProfileMock = vi.fn()

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: (...args: unknown[]) => launchProfileMock(...args),
  killLaunchedApps: vi.fn(),
  relaunchMissingProfile: vi.fn(),
  getProfileSwitchDiff: vi.fn(),
  switchProfileApps: vi.fn()
}))

// Same jsdom-safety stubs as gameRowLaunchAnnounce.test.tsx: GameRow pulls in
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
    'button[aria-label="Launch Assetto Corsa: Default profile"]'
  ) as HTMLButtonElement | null
  expect(playButton).not.toBeNull()

  await act(async () => {
    playButton!.click()
  })
}

beforeEach(() => {
  notifyMock.mockClear()
  launchProfileMock.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('GameRow launch skipped-entry warning (#639)', () => {
  test('warns naming the game when the game exe itself was skipped, instead of showing success', async () => {
    launchProfileMock.mockResolvedValue({
      success: true,
      launchedCount: 1,
      skipped: [{ key: 'ac', path: 'C:/Games/AC/acs.exe', reason: 'missing' }]
    })

    await renderRow()
    await clickPlayButton()

    expect(notifyMock).toHaveBeenCalledWith(
      'Assetto Corsa was skipped — its path no longer exists.',
      'warn',
      5000
    )
  })

  test('falls back to the exe basename for a skipped companion app', async () => {
    launchProfileMock.mockResolvedValue({
      success: true,
      launchedCount: 1,
      skipped: [{ key: 'simhub', path: 'C:/Tools/SimHub.exe', reason: 'missing' }]
    })

    await renderRow()
    await clickPlayButton()

    expect(notifyMock).toHaveBeenCalledWith(
      'SimHub was skipped — its path no longer exists.',
      'warn',
      5000
    )
  })

  test('shows the plain success toast when nothing was skipped', async () => {
    launchProfileMock.mockResolvedValue({
      success: true,
      launchedCount: 1,
      message: 'All profile applications launched.'
    })

    await renderRow()
    await clickPlayButton()

    expect(notifyMock).toHaveBeenCalledWith(
      'All profile applications launched.',
      'success',
      undefined
    )
  })

  // The skipped warning must not swallow the launch summary — "skipped 1
  // already running" and "path no longer exists" are independent facts.
  test('keeps the launch summary message alongside the skipped warning', async () => {
    launchProfileMock.mockResolvedValue({
      success: true,
      launchedCount: 1,
      skippedCount: 1,
      message: 'Started 1 app; skipped 1 already running.',
      skipped: [{ key: 'simhub', path: 'C:/Tools/SimHub.exe', reason: 'missing' }]
    })

    await renderRow()
    await clickPlayButton()

    expect(notifyMock).toHaveBeenCalledWith(
      'SimHub was skipped — its path no longer exists. Started 1 app; skipped 1 already running.',
      'warn',
      5000
    )
  })

  // The all-invalid failure carries the skipped detail too — the single-app
  // moved-exe case is the most common #639 trigger and must name the culprit.
  test('a total launch failure names the skipped entries in the error toast', async () => {
    launchProfileMock.mockResolvedValue({
      success: false,
      launchedCount: 0,
      error: 'No valid executable paths configured.',
      skipped: [{ key: 'ac', path: 'C:/Games/AC/acs.exe', reason: 'missing' }]
    })

    await renderRow()
    await clickPlayButton()

    expect(notifyMock).toHaveBeenCalledWith(
      'No valid executable paths configured. Assetto Corsa was skipped — its path no longer exists.',
      'error'
    )
  })
})
