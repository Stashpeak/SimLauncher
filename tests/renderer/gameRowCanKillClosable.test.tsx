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
