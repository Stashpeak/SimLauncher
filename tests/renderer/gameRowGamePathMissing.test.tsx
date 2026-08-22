/**
 * The "Game not found" badge (#794).
 *
 * The row is the only place a broken game path can be reported once the game is
 * not running, because the launch-time warning needs a launch to happen first.
 * What is pinned here is that the badge EXPLAINS without DISPLACING: it must not
 * take over the primary action, since Launch is the other half of the recovery
 * path and the row would read as healthy without it.
 *
 * Placement is deliberate too. The status dot is not used, because its
 * vocabulary is entirely about processes (green = running, amber ring = cannot
 * tell, #737) and a dot on an idle row reads as "something is running" whatever
 * its colour.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../src/renderer/src/lib/electron', () => ({
  dismissAppIcon: vi.fn(),
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
import type { Game } from '../../src/renderer/src/lib/config'

const GAME: Game = { key: 'beamng', name: 'BeamNG.drive', icon: 'assets/beamng.png' }
const LAUNCH_LABEL = 'Launch BeamNG.drive: Default profile'

let container: HTMLDivElement
let root: Root | null = null

async function renderRow(gamePathMissing: boolean): Promise<void> {
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
          hasClosableApps={false}
          gamePathMissing={gamePathMissing}
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

function rowText(): string {
  return container.textContent || ''
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
})

describe('GameRow broken-game-path badge (#794)', () => {
  test('a game whose path no longer resolves says so on the row', async () => {
    await renderRow(true)

    expect(rowText()).toContain('Game not found')
  })

  // The ordinary state of every row. An always-present badge would be noise on
  // a healthy list.
  test('a game whose path resolves shows no badge', async () => {
    await renderRow(false)

    expect(rowText()).not.toContain('Game not found')
  })

  // The regression this shape exists to avoid. Launch is the other channel that
  // reports a broken path (it names the skipped entry in its toast), so a badge
  // that displaced it would remove the more actionable of the two.
  test('the badge explains without displacing the primary action', async () => {
    await renderRow(true)

    expect(container.querySelector(`button[aria-label="${LAUNCH_LABEL}"]`)).not.toBeNull()
  })

  // The badge is not a control, so it must not take tab focus, which means the
  // tooltip alone cannot carry the fix: nothing would ever open it for a
  // keyboard or screen-reader user. The instruction has to be in the
  // accessibility tree unconditionally, and it has to name where to go.
  test('the fix is readable without hovering, and names the screen', async () => {
    await renderRow(true)

    expect(rowText()).toContain('Games section of Settings')

    // And not focusable: a badge in the tab order would add a stop that does
    // nothing on Enter. This is the reason the sentence above cannot live in
    // the tooltip alone.
    const badge = Array.from(container.querySelectorAll('span')).find((element) =>
      element.textContent?.startsWith('Game not found')
    )
    expect(badge).toBeDefined()
    expect(badge?.hasAttribute('tabindex')).toBe(false)
  })
})
