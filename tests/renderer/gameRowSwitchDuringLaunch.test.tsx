/**
 * #843: a profile switch during an in-flight launch could kill the launch.
 *
 * `save-profile` calls `abortActiveLaunches(gameKey)` when the switch leaves a
 * utility behind, and `activeLaunchControllers` holds one controller per GAME,
 * so that abort takes down the whole sequence rather than the leaving entry.
 * The game never starts.
 *
 * The main process already refuses this: `switch-profile-apps` bails on
 * `isAnyLaunchActive() || hasOtherActiveLaunchControllers()`. The renderer got
 * around it, because a row whose game is not running skips the diff branch
 * entirely and falls through to a bare `saveProfileSet`, which is the abort's
 * only transport. So the two paths disagreed, and this closes that.
 *
 * What is asserted is the WINDOW, not the gate's boolean. The dangerous span is
 * exactly [launch IPC dispatched -> launch IPC resolved]: `abortActiveLaunches`
 * only reaches controllers still in the registry, and every one of them is
 * unregistered in a `finally` when its sequence returns. So the launch promise
 * is left deliberately unsettled and the question asked is whether the save can
 * be emitted at all while it hangs.
 *
 * The liveness half matters just as much: an implementation that refused every
 * switch forever would pass the first assertion and be worse than the bug.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, useCallback, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const notifyMock = vi.fn()
const launchProfileMock = vi.fn()
const saveProfileSetMock = vi.fn().mockResolvedValue(undefined)
const getProfileSwitchDiffMock = vi.fn()

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: (...args: unknown[]) => launchProfileMock(...args),
  killLaunchedApps: vi.fn(),
  relaunchMissingProfile: vi.fn(),
  getProfileSwitchDiff: (...args: unknown[]) => getProfileSwitchDiffMock(...args),
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
  profiles: [
    { id: 'default', name: 'Default' },
    { id: 'race', name: 'Race' }
  ]
}

vi.mock('../../src/renderer/src/hooks/useGameProfile', () => ({
  useGameProfile: () => ({
    profileSet: PROFILE_SET,
    profileState: { killControlsEnabled: true, relaunchControlsEnabled: true },
    loadProfileSet: vi.fn().mockResolvedValue(PROFILE_SET),
    getProfileRuntimeConfig: vi.fn().mockResolvedValue(PROFILE_SET),
    saveProfileSet: saveProfileSetMock
  })
}))

// Open, so the menu items are in the DOM for the switch to be driven through.
vi.mock('../../src/renderer/src/hooks/useProfileMenu', () => ({
  useProfileMenu: () => ({
    profileMenuOpen: true,
    setProfileMenuOpen: vi.fn(),
    openProfileMenu: vi.fn(),
    closeProfileMenu: vi.fn(),
    newProfileFormOpen: false,
    setNewProfileName: vi.fn(),
    setNewProfileFormOpen: vi.fn(),
    newProfileName: '',
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
const LAUNCH_LABEL = 'Launch Assetto Corsa: Default profile'

let container: HTMLDivElement
let root: Root | null = null

/**
 * Stands in for GameList's `useLaunchBlock`, and only for the part this test is
 * about: `isLaunchBlocked` goes true synchronously when a launch starts and
 * false when it ends. The real hook also holds it through a cooldown, which
 * only widens the closed window and has its own coverage in
 * `useLaunchBlock.test.tsx`.
 */
function Harness() {
  const [launching, setLaunching] = useState(false)
  const onLaunchStart = useCallback(() => setLaunching(true), [])
  const onLaunchEnd = useCallback(() => setLaunching(false), [])

  return (
    <AppDirtyProvider>
      <GameRow
        game={GAME}
        isActive={false}
        // The whole point: the game is NOT running, which is the case that used
        // to skip the diff branch and fall through to a bare save.
        isRunning={false}
        isGameRunning={false}
        runningAppIcons={[]}
        hasClosableApps={false}
        gamePathMissing={false}
        isDimmed={false}
        isLaunching={launching}
        isLaunchBlocked={launching}
        onLaunchStart={onLaunchStart}
        onLaunchEnd={onLaunchEnd}
        onRunningStateRefresh={vi.fn().mockResolvedValue(undefined)}
        onToggleEditor={vi.fn()}
        onCloseEditor={vi.fn()}
        cacheInitialized={true}
      />
    </AppDirtyProvider>
  )
}

async function mountRow(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<Harness />)
  })
}

async function clickLaunch(): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${LAUNCH_LABEL}"]`)
  expect(button).not.toBeNull()
  await act(async () => {
    button!.click()
  })
}

async function clickProfile(name: string): Promise<void> {
  const option = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]')
  ).find((button) => button.textContent?.includes(name))
  expect(option).toBeDefined()
  await act(async () => {
    option!.click()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  saveProfileSetMock.mockResolvedValue(undefined)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
})

describe('a profile switch cannot reach the store while a launch is in flight (#843)', () => {
  test('the bare save is never emitted while the launch promise is unsettled', async () => {
    // Never resolved for the duration of the assertion: this is the exact span
    // in which the main-process abort can still reach the sequence.
    let settleLaunch: ((result: unknown) => void) | undefined
    launchProfileMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleLaunch = resolve
        })
    )

    await mountRow()
    await clickLaunch()

    await clickProfile('Race')

    expect(saveProfileSetMock).not.toHaveBeenCalled()
    expect(notifyMock).toHaveBeenCalledWith('Launch is settling. Try again shortly.', 'warn')

    // Leave nothing hanging for the next test.
    await act(async () => {
      settleLaunch?.({ success: true, launchedCount: 1 })
    })
  })

  // The half that stops "refuse everything" from passing. Without it, deleting
  // the switch entirely would go green.
  test('the same switch goes through once the launch has settled', async () => {
    launchProfileMock.mockResolvedValue({ success: true, launchedCount: 1 })

    await mountRow()
    await clickLaunch()

    await clickProfile('Race')

    expect(saveProfileSetMock).toHaveBeenCalledTimes(1)
  })
})
