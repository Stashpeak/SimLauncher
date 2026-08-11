/**
 * #809: when SimLauncher cancels a pending elevated handoff it kills the
 * PowerShell host, which stops the app starting but leaves the Windows consent
 * prompt on screen. The user answers it, nothing happens, and nothing explains
 * why.
 *
 * These tests exist because the FIRST attempt at that fix composed the sentence
 * in the main process and appended it to `KillResult.message`. It was correct
 * copy, and it was invisible: the renderer ignores `message` entirely on a
 * failed kill. Every test then passed, because every test asserted on the
 * main-process return value rather than on what reached a toast.
 *
 * So the assertions here are deliberately at the notification layer. Main
 * reports a count; this is where it is proven a human would actually read it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const notifyMock = vi.fn()
const killLaunchedAppsMock = vi.fn()

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: vi.fn(),
  killLaunchedApps: (...args: unknown[]) => killLaunchedAppsMock(...args),
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

const SINGULAR =
  'A Windows permission prompt may still be on screen. Answering it will not start the app.'
const PLURAL =
  'Windows permission prompts may still be on screen. Answering them will not start those apps.'

let container: HTMLDivElement
let root: Root | null = null

async function renderRunningRow(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppDirtyProvider>
        <GameRow
          game={GAME}
          isActive={false}
          // Running, so the primary action becomes Close Apps.
          isRunning={true}
          isGameRunning={false}
          // canKill is runningAppIcons.length > 0 && killControlsEnabled, so the
          // Close Apps affordance needs a visible companion here.
          runningAppIcons={[
            { appPath: 'C:/Tools/AdminTool.exe', icon: 'assets/admin.png', name: 'AdminTool' }
          ]}
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

async function clickCloseApps(): Promise<void> {
  const button = container.querySelector(
    'button[aria-label="Close companion apps for Assetto Corsa"]'
  ) as HTMLButtonElement | null
  expect(button).not.toBeNull()
  await act(async () => {
    button!.click()
  })
}

/** Everything the toast said, across however many notify() calls. */
function allToastText(): string {
  return notifyMock.mock.calls.map((call) => String(call[0])).join(' | ')
}

beforeEach(() => {
  notifyMock.mockClear()
  killLaunchedAppsMock.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('GameRow stranded consent prompt toast (#809)', () => {
  test('a successful close that stranded a prompt explains it', async () => {
    killLaunchedAppsMock.mockResolvedValue({
      success: true,
      closedCount: 1,
      failedCount: 0,
      failures: [],
      message: 'Closed 1 companion app.',
      strandedConsentPrompts: 1
    })

    await renderRunningRow()
    await clickCloseApps()

    expect(allToastText()).toContain(SINGULAR)
    // The existing message is kept, not replaced.
    expect(allToastText()).toContain('Closed 1 companion app.')
  })

  test('a FAILED close that stranded a prompt still explains it', async () => {
    // The likelier of the two: access-denied is the canonical kill failure for
    // exactly the elevated-tool profiles that can strand a prompt at all. This
    // path ignores `message` entirely, which is how the first version of this
    // fix lost the sentence.
    killLaunchedAppsMock.mockResolvedValue({
      success: false,
      closedCount: 0,
      failedCount: 1,
      failures: [
        { appName: 'AdminTool.exe', appPath: 'C:/Tools/AdminTool.exe', reason: 'access_denied' }
      ],
      strandedConsentPrompts: 1
    })

    await renderRunningRow()
    await clickCloseApps()

    expect(allToastText()).toContain(SINGULAR)
    // And the failure itself is still reported.
    expect(allToastText()).toContain('AdminTool.exe')
  })

  test('two stranded prompts are described in the plural', async () => {
    killLaunchedAppsMock.mockResolvedValue({
      success: true,
      closedCount: 0,
      failedCount: 0,
      failures: [],
      message: 'No running companion apps to close.',
      strandedConsentPrompts: 2
    })

    await renderRunningRow()
    await clickCloseApps()

    expect(allToastText()).toContain(PLURAL)
  })

  test('an ordinary close says nothing about a prompt', async () => {
    killLaunchedAppsMock.mockResolvedValue({
      success: true,
      closedCount: 2,
      failedCount: 0,
      failures: [],
      message: 'Closed 2 companion apps.'
    })

    await renderRunningRow()
    await clickCloseApps()

    expect(allToastText()).not.toContain('permission prompt')
    expect(allToastText()).toContain('Closed 2 companion apps.')
  })

  test('a close that reports no message at all does not render "undefined"', async () => {
    // finalizeKillAttempts returns `message: undefined` whenever kill attempts
    // were made but nothing closed. An earlier version interpolated that
    // straight into a string, producing a literal "undefined ..." toast.
    killLaunchedAppsMock.mockResolvedValue({
      success: true,
      closedCount: 0,
      failedCount: 0,
      failures: [],
      strandedConsentPrompts: 1
    })

    await renderRunningRow()
    await clickCloseApps()

    expect(allToastText()).toContain(SINGULAR)
    expect(allToastText()).not.toContain('undefined')
  })
})
