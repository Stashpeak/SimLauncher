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
const switchProfileAppsMock = vi.fn()
const getProfileSwitchDiffMock = vi.fn()
const saveProfileSetMock = vi.fn()

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: vi.fn(),
  killLaunchedApps: (...args: unknown[]) => killLaunchedAppsMock(...args),
  relaunchMissingProfile: vi.fn(),
  getProfileSwitchDiff: (...args: unknown[]) => getProfileSwitchDiffMock(...args),
  switchProfileApps: (...args: unknown[]) => switchProfileAppsMock(...args)
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

// Two profiles, so the menu has something to switch *to*. The kill tests only
// ever needed one, but the switch flow returns early when the clicked profile
// is already active.
const PROFILE_SET = {
  activeProfileId: 'default',
  profiles: [
    { id: 'default', name: 'Default' },
    { id: 'race', name: 'Race' }
  ]
}

// Read at render time, not when the mock factory is built, so a test can open
// the profile menu before mounting.
let profileMenuOpen = false

vi.mock('../../src/renderer/src/hooks/useGameProfile', () => ({
  useGameProfile: () => ({
    profileSet: PROFILE_SET,
    profileState: { killControlsEnabled: true, relaunchControlsEnabled: true },
    loadProfileSet: vi.fn().mockResolvedValue(PROFILE_SET),
    getProfileRuntimeConfig: vi.fn().mockResolvedValue(PROFILE_SET),
    saveProfileSet: saveProfileSetMock
  })
}))

vi.mock('../../src/renderer/src/hooks/useProfileMenu', () => ({
  useProfileMenu: () => ({
    profileMenuOpen,
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

/**
 * Click a profile in the open menu, then confirm the "switch while running"
 * dialog. Both steps are required: the first only stages the confirmation,
 * and it is the confirmed call that actually runs the kill-then-launch.
 */
async function switchToProfile(name: string): Promise<void> {
  const option = Array.from(container.querySelectorAll('button[role="menuitemradio"]')).find(
    (button) => button.textContent?.includes(name)
  ) as HTMLButtonElement | undefined
  expect(option).toBeDefined()
  await act(async () => {
    option!.click()
  })

  // ConfirmDialog portals to document.body, so it is outside `container`.
  const confirm = Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Switch Profile'
  ) as HTMLButtonElement | undefined
  expect(confirm).toBeDefined()
  await act(async () => {
    confirm!.click()
  })
}

/** Everything the toast said, across however many notify() calls. */
function allToastText(): string {
  return notifyMock.mock.calls.map((call) => String(call[0])).join(' | ')
}

beforeEach(() => {
  profileMenuOpen = false
  notifyMock.mockClear()
  killLaunchedAppsMock.mockReset()
  switchProfileAppsMock.mockReset()
  getProfileSwitchDiffMock.mockReset()
  saveProfileSetMock.mockReset()
  // `Promise<void>`, matching the hook. The stranded-prompt count is pushed from
  // main now, not returned from here (#782).
  saveProfileSetMock.mockResolvedValue(undefined)
  // Non-zero counts are what make the switch prompt for confirmation rather
  // than silently doing nothing.
  getProfileSwitchDiffMock.mockResolvedValue({ toStopCount: 1, toStartCount: 1 })
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

/**
 * The switch flow kills the outgoing profile's apps *before* it can cancel or
 * fail, so all three of its exits can be carrying a stranded prompt. The first
 * version of this fix only handled the success exit, which is the same defect
 * as #809 itself one layer up: main drains the count to build the result, so
 * whichever branch drops it drops it permanently, and the user's next Close
 * Apps is silent too.
 */
describe('profile switch stranded consent prompt toast (#809)', () => {
  const DIALOG_PROMPT = 'Switch to "Race" while the game is running?'

  test('a switch cancelled by Close Apps still explains the stranded prompt', async () => {
    switchProfileAppsMock.mockResolvedValue({
      success: false,
      cancelled: true,
      message: 'Launch cancelled, closed apps instead.',
      launchedCount: 0,
      skippedCount: 0,
      strandedConsentPrompts: 1
    })

    profileMenuOpen = true
    await renderRunningRow()
    await switchToProfile('Race')

    expect(allToastText()).toContain(SINGULAR)
    // The cancellation is still reported; the note is appended, not swapped in.
    expect(allToastText()).toContain('Launch cancelled')
    expect(allToastText()).not.toContain('undefined')
  })

  test('a FAILED switch still explains the stranded prompt', async () => {
    switchProfileAppsMock.mockResolvedValue({
      success: false,
      error: 'Failed to start Race apps',
      launchedCount: 0,
      skippedCount: 0,
      strandedConsentPrompts: 1
    })

    profileMenuOpen = true
    await renderRunningRow()
    await switchToProfile('Race')

    expect(allToastText()).toContain(SINGULAR)
    expect(allToastText()).toContain('Failed to start Race apps')
  })

  // Pins the pre-existing contract rather than proposing a new one: a warned
  // switch reports the warning INSTEAD of "Switched to X", and has since the
  // row was decomposed (f3d4088). That applies equally to kill failures,
  // skipped apps and `result.warning`, so the stranded note behaves like its
  // three siblings. Whether a warned switch should still confirm the change is
  // a real question, but it is one for all four and is tracked in #817.
  test('a successful switch reports the prompt in place of the plain confirmation', async () => {
    switchProfileAppsMock.mockResolvedValue({
      success: true,
      launchedCount: 1,
      skippedCount: 0,
      strandedConsentPrompts: 2
    })

    profileMenuOpen = true
    await renderRunningRow()
    await switchToProfile('Race')

    expect(allToastText()).toContain(PLURAL)
    expect(allToastText()).not.toContain('Switched to Race')
    // Warned switches are shown as a warning, not as a success.
    expect(notifyMock.mock.calls.some((call) => call[1] === 'warn')).toBe(true)
  })

  // A switch that skips `switchProfileApps` entirely (empty diff) can still
  // strand a prompt, because the save is what cancels the outgoing profile's
  // pending handoff. That case is NOT tested here any more: the count no longer
  // comes back through `saveProfileSet` for this row to fold in, it is pushed
  // from main to the toast layer so the editor's delete and discard paths get it
  // too (Codex P2 on #782). See notifyStrandedConsentPrompts.test.tsx. What this
  // file still owns is everything the KILL reports, below.

  test('an ordinary switch says nothing about a prompt', async () => {
    switchProfileAppsMock.mockResolvedValue({
      success: true,
      launchedCount: 1,
      skippedCount: 0
    })

    profileMenuOpen = true
    await renderRunningRow()
    await switchToProfile('Race')

    expect(allToastText()).not.toContain('permission prompt')
    expect(allToastText()).toContain('Switched to Race')
  })

  // Guards the harness itself: if the menu or the dialog ever stops rendering,
  // switchToProfile() would throw rather than pass vacuously, but this pins the
  // reason the confirmation step exists at all.
  test('the switch is only attempted after the running-profile dialog is confirmed', async () => {
    switchProfileAppsMock.mockResolvedValue({ success: true, launchedCount: 1, skippedCount: 0 })

    profileMenuOpen = true
    await renderRunningRow()

    const option = Array.from(container.querySelectorAll('button[role="menuitemradio"]')).find(
      (button) => button.textContent?.includes('Race')
    ) as HTMLButtonElement
    await act(async () => {
      option.click()
    })

    expect(document.body.textContent).toContain(DIALOG_PROMPT)
    expect(switchProfileAppsMock).not.toHaveBeenCalled()
  })
})
