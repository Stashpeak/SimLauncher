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
const switchProfileAppsMock = vi.fn()

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: (...args: unknown[]) => launchProfileMock(...args),
  killLaunchedApps: vi.fn(),
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

const PROFILE_SET = {
  activeProfileId: 'default',
  profiles: [
    { id: 'default', name: 'Default' },
    { id: 'race', name: 'Race' }
  ]
}

// Controllable, because the interesting window is the one this IPC round-trip
// opens: the gate is read before it and the save happens after it.
const getProfileRuntimeConfigMock = vi.fn()

vi.mock('../../src/renderer/src/hooks/useGameProfile', () => ({
  useGameProfile: () => ({
    profileSet: PROFILE_SET,
    profileState: { killControlsEnabled: true, relaunchControlsEnabled: true },
    loadProfileSet: vi.fn().mockResolvedValue(PROFILE_SET),
    getProfileRuntimeConfig: (...args: unknown[]) => getProfileRuntimeConfigMock(...args),
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
 * Stands in for GameList's `useLaunchBlock`: the lock goes true synchronously
 * when a launch starts, and a non-zero cooldown HOLDS it after the launch ends.
 *
 * That cooldown is not a detail. An earlier version of this harness cleared the
 * lock the moment a launch ended, which quietly made a whole class of case
 * untestable: a confirmed running switch takes the lock itself and then holds it
 * through the cooldown, so the row's own guard can be looking at its own lock.
 * With the cooldown modelled away the tests agreed with the code and both were
 * wrong (Codex P1 on #864).
 */
function Harness({ isRunning = false }: { isRunning?: boolean }) {
  const [launching, setLaunching] = useState(false)
  const onLaunchStart = useCallback(() => setLaunching(true), [])
  const onLaunchEnd = useCallback((_key: string, cooldownMs?: number) => {
    if (cooldownMs && cooldownMs > 0) return
    setLaunching(false)
  }, [])

  return (
    <AppDirtyProvider>
      <GameRow
        game={GAME}
        isActive={false}
        // Not running is the case that used to skip the diff branch and fall
        // through to a bare save. Running is the case that reaches the save
        // through a DIFFERENT set of awaits when the diff turns out empty.
        isRunning={isRunning}
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

async function mountRow(isRunning = false): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<Harness isRunning={isRunning} />)
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
  getProfileRuntimeConfigMock.mockResolvedValue(PROFILE_SET)
  switchProfileAppsMock.mockResolvedValue({ success: true, launchedCount: 1 })
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

    // Refused at the FIRST gate, before the profile read. The later gate would
    // catch this one too, so without this line the early bail is unpinned and
    // could be deleted with the suite still green. It earns its place by
    // sparing an IPC round-trip and, on a running row, by not raising a switch
    // confirmation dialog for a switch that is going to be refused anyway.
    expect(getProfileRuntimeConfigMock).not.toHaveBeenCalled()

    // Leave nothing hanging for the next test.
    await act(async () => {
      settleLaunch?.({ success: true, launchedCount: 1 })
    })
  })

  // The gate is read before an IPC round-trip and acted on after it, so a
  // launch that starts in between leaves the closure holding an answer from
  // before it existed. This is the same check-then-suspend shape that produced
  // five separate findings on #714 and was the reason #715 moved the launch
  // path's own check into the same synchronous block as the start.
  test('a launch that starts during the profile read still stops the save (#864)', async () => {
    let settleProfileRead: ((value: unknown) => void) | undefined
    getProfileRuntimeConfigMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleProfileRead = resolve
        })
    )
    let settleLaunch: ((result: unknown) => void) | undefined
    launchProfileMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleLaunch = resolve
        })
    )

    await mountRow()

    // The switch starts while nothing is launching, so it passes the first gate
    // and parks on the profile read.
    await clickProfile('Race')
    expect(saveProfileSetMock).not.toHaveBeenCalled()

    // Only NOW does a launch begin, which the parked closure cannot see.
    await clickLaunch()

    await act(async () => {
      settleProfileRead?.(PROFILE_SET)
    })

    expect(saveProfileSetMock).not.toHaveBeenCalled()

    await act(async () => {
      settleLaunch?.({ success: true, launchedCount: 1 })
    })
  })

  // The earlier re-check is not the last suspension on a RUNNING row. When the
  // app diff comes back empty, `switchProfileApps` is skipped entirely, so
  // main's own launch guard never runs, and `getProfileSwitchDiff` plus
  // `onRunningStateRefresh` are both still awaited before the save. A launch
  // starting in there arrives at the save unopposed (Codex on #864).
  test('an empty diff on a running row does not carry the save past a new launch (#864)', async () => {
    let settleDiff: ((value: unknown) => void) | undefined
    getProfileSwitchDiffMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleDiff = resolve
        })
    )
    let settleLaunch: ((result: unknown) => void) | undefined
    launchProfileMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleLaunch = resolve
        })
    )

    await mountRow(true)

    // Parks on the diff read, having passed the first gate.
    await clickProfile('Race')
    expect(saveProfileSetMock).not.toHaveBeenCalled()

    await clickLaunch()

    // Empty on both sides, which is what skips switchProfileApps and with it
    // main's refusal.
    await act(async () => {
      settleDiff?.({ toStopCount: 0, toStartCount: 0 })
    })

    expect(saveProfileSetMock).not.toHaveBeenCalled()

    await act(async () => {
      settleLaunch?.({ success: true, launchedCount: 1 })
    })
  })

  // The guard must not fire on the lock this switch took itself. A confirmed
  // running switch calls `onLaunchStart`, then holds the lock through the
  // post-launch cooldown, so rejecting any active lock would move the apps and
  // never save the profile: a half-switch on the ordinary path rather than the
  // rare one (Codex P1 on #864). This case also needs the guard least, since
  // running `switchProfileApps` means main's own guard already ran.
  test('a confirmed running switch still saves, despite holding its own lock (#864)', async () => {
    getProfileSwitchDiffMock.mockResolvedValue({ toStopCount: 1, toStartCount: 1 })
    switchProfileAppsMock.mockResolvedValue({ success: true, launchedCount: 1 })

    await mountRow(true)

    await clickProfile('Race')

    // Staged, not performed: the running switch asks first.
    expect(switchProfileAppsMock).not.toHaveBeenCalled()

    const confirm = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Switch Profile')
    )
    expect(confirm).toBeDefined()
    await act(async () => {
      confirm!.click()
    })

    expect(switchProfileAppsMock).toHaveBeenCalledTimes(1)
    expect(saveProfileSetMock).toHaveBeenCalledTimes(1)
  })

  // The half that stops "refuse everything" from passing. Without it, deleting
  // the switch entirely would go green.
  //
  // Uses a launch that STARTED nothing, because that is the real path on which
  // the lock clears immediately: GameRow passes `launchedCount === 0 ? 0 :
  // POST_LAUNCH_BLOCK_MS`, so only this shape releases without waiting out the
  // cooldown. Asserting liveness after a launch that did start something would
  // require waiting the block out, which is `useLaunchBlock`'s own contract and
  // is covered there.
  test('the same switch goes through once the lock has cleared', async () => {
    launchProfileMock.mockResolvedValue({ success: true, launchedCount: 0 })

    await mountRow()
    await clickLaunch()

    await clickProfile('Race')

    expect(saveProfileSetMock).toHaveBeenCalledTimes(1)
  })
})
