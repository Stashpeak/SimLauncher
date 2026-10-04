/**
 * The row derived its Close Apps affordance from the strip's icon COUNT, never
 * from whether any of those icons could be closed (#947). A name-scoped
 * secondary is surfaced by the poll but refused as a Close Apps target by
 * `getProfileCompanionTargets` (#929), so a row whose only running entry was
 * one offered a red Close Apps that closed nothing.
 *
 * The damage is not the dead button. `canKill` REPLACES the primary action
 * rather than adding a control (`GameRowActions.tsx`), so the row also lost its
 * Launch button, which is exactly the state the comment there says must never
 * be reached (#673).
 *
 * Asserted on the primary button's accessible name, because that is the one
 * thing that says which of the two actions the row is actually offering.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: vi.fn(),
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

// The name-scoped entry below is in the strip only because the profile lists it
// under "Secondary executables to watch", so the fixture profile does too. That
// list, not the entry's shape, is what makes it a game rather than a target.
const PROFILE_SET = {
  activeProfileId: 'default',
  profiles: [{ id: 'default', name: 'Default', trackedProcessPaths: ['AC2-Win64-Shipping.exe'] }]
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
import type { RunningAppIcon } from '../../src/renderer/src/components/game-list/RunningAppsStrip'
import type { Game } from '../../src/renderer/src/lib/config'

const GAME: Game = { key: 'ac', name: 'Assetto Corsa', icon: 'assets/ac.png' }

// The #947 fixture: the phantom-exit warning asks for the child process NAME
// off Task Manager, so this is the shape the app's own instruction produces.
const NAME_SCOPED: RunningAppIcon = {
  icon: null,
  name: 'AC2-Win64-Shipping.exe',
  path: 'AC2-Win64-Shipping.exe',
  gameKey: 'ac',
  tracked: true
}

const PATH_SCOPED: RunningAppIcon = {
  icon: 'assets/simhub.png',
  name: 'SimHubWPF.exe',
  path: 'A:/Apps/SimHub/SimHubWPF.exe',
  gameKey: 'ac',
  tracked: true
}

// What `registerUnclosedProcess` publishes when closing a curated utility by
// image name fails (Codex P2 on #950): the name sits where a path would, and
// the failure rides along as the warning. Still a Close Apps target.
const UNCLOSED_CURATED: RunningAppIcon = {
  icon: null,
  name: 'Garage61 telemetry agent.exe',
  path: 'Garage61 telemetry agent.exe',
  gameKey: 'ac',
  tracked: true,
  warning:
    'Windows denied SimLauncher permission to close this app. It may be running as administrator.',
  elevated: true
}

let container: HTMLDivElement
let root: Root | null = null

async function renderRow(runningAppIcons: RunningAppIcon[]): Promise<void> {
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
          isGameRunning={false}
          runningAppIcons={runningAppIcons}
          hasClosableApps={false}
          gamePathMissing={false}
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

function primaryButtonLabel(): string {
  const button = container.querySelector('button.launcher-play-btn') as HTMLButtonElement | null
  expect(button).not.toBeNull()
  return button?.getAttribute('aria-label') ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container?.remove()
})

describe('the row offers Close Apps only for entries it could close (#947)', () => {
  test('a name-scoped entry alone leaves the row on Launch, not Close Apps', async () => {
    await renderRow([NAME_SCOPED])

    // The load-bearing assertion. Before the fix `canKill` was
    // `runningAppIcons.length > 0`, so this read "Close companion apps for
    // Assetto Corsa" and the row had no way to launch the game at all.
    expect(primaryButtonLabel()).toBe('Launch Assetto Corsa: Default profile')
  })

  // Codex P2 on #950. Not every bare name in the strip is a name-scoped
  // secondary: a curated `/IM` target that failed to close is published under
  // its image name, and Close Apps still targets it. That failure is visible
  // and retryable, so it has to keep Close Apps as the primary, as it did
  // before #947 was fixed.
  test('a failed close of a curated name target keeps Close Apps', async () => {
    await renderRow([UNCLOSED_CURATED])

    expect(primaryButtonLabel()).toBe('Close companion apps for Assetto Corsa')
  })

  test('a curated failure next to a name-scoped entry still offers Close Apps', async () => {
    await renderRow([NAME_SCOPED, UNCLOSED_CURATED])

    expect(primaryButtonLabel()).toBe('Close companion apps for Assetto Corsa')
  })

  test('a path-scoped companion still offers Close Apps', async () => {
    await renderRow([PATH_SCOPED])

    // Guards the fix against being widened into hiding real companions. Green
    // before and after; it is a lock, not a red.
    expect(primaryButtonLabel()).toBe('Close companion apps for Assetto Corsa')
  })

  test('one closable companion is enough, even next to a name-scoped entry', async () => {
    await renderRow([NAME_SCOPED, PATH_SCOPED])

    // `some`, not `every`: a session with the game tracked by name AND real
    // companions running must still offer the close.
    expect(primaryButtonLabel()).toBe('Close companion apps for Assetto Corsa')
  })

  test('an empty strip is unchanged', async () => {
    await renderRow([])

    expect(primaryButtonLabel()).toBe('Launch Assetto Corsa: Default profile')
  })
})
