/**
 * The editor's "+" creates a profile that is provisional until it is kept
 * (saved, launched or switched away from), and closing the editor discards it
 * on purpose (#453). The toast said "Created profile New Profile", the phrasing
 * the app uses for things that persist, so the user was told a profile existed
 * and then lost it without a word (#949).
 *
 * The editor is a stub: what is under test is what GameRow says when its "+"
 * callback fires, not the editor's own tree.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const notifyMock = vi.fn()
const saveProfileSetMock = vi.fn()

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
    saveProfileSet: saveProfileSetMock
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
    newProfileName: 'Wet Race',
    setNewProfileName: vi.fn(),
    profileMenuRef: { current: null },
    menuRef: { current: null },
    triggerRef: { current: null },
    handleProfileMenuTriggerKeyDown: vi.fn(),
    handleProfileMenuKeyDown: vi.fn(),
    newProfileInputRef: { current: null }
  })
}))

vi.mock('../../src/renderer/src/components/ProfileEditor', () => ({
  ProfileEditor: ({ onCreateProfile }: { onCreateProfile?: () => void }) => (
    <button type="button" aria-label="New profile" onClick={onCreateProfile} />
  )
}))

// The profile menu's own "new profile" form, reduced to its submit. A profile
// created there is kept at once, so it must keep saying so.
vi.mock('../../src/renderer/src/components/game-list/GameRowProfileMenu', () => ({
  GameRowProfileMenu: ({ onNewProfileSubmit }: { onNewProfileSubmit: () => void }) => (
    <button type="button" aria-label="Create profile" onClick={() => onNewProfileSubmit()} />
  )
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

function row(isActive: boolean) {
  return (
    <AppDirtyProvider>
      <GameRow
        game={GAME}
        isActive={isActive}
        isRunning={false}
        isGameRunning={false}
        runningAppIcons={[]}
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
}

async function renderRow(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(row(true))
  })
}

// The create path is fire-and-forget from the click (`void handleCreateProfile`),
// so let its awaited store calls settle before reading what it announced.
async function click(label: string): Promise<void> {
  const button = container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
  expect(button).not.toBeNull()
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
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
  container?.remove()
})

describe('what the app says when a profile is created (#949)', () => {
  test('the editor "+" says the profile is provisional and how it is lost', async () => {
    await renderRow()
    await click('New profile')

    // The load-bearing assertion. Before the fix this was
    // "Created profile New Profile" at the default duration, a completed fact
    // about a profile that closing the editor then removed.
    expect(notifyMock).toHaveBeenCalledWith(
      'Added New Profile. Save it to keep it. Closing the editor discards it.',
      'success',
      5000
    )
    expect(notifyMock).not.toHaveBeenCalledWith(
      expect.stringContaining('Created profile'),
      expect.anything()
    )
  })

  // Codex P2 on #972. The editor can close while the create's save is still in
  // flight; the profile is then discarded as soon as the save lands, and
  // offering to save it would promise something that no longer exists.
  test('an editor closed before the save lands says nothing about keeping it', async () => {
    let finishSave: () => void = () => {}
    saveProfileSetMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishSave = resolve))
    )
    await renderRow()
    await click('New profile')

    await act(async () => {
      root?.render(row(false))
    })
    await act(async () => {
      finishSave()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(notifyMock).not.toHaveBeenCalled()
  })

  test('a profile created from the menu form still says it was created', async () => {
    await renderRow()
    await click('Create profile')

    // A lock, green before and after: that path persists the profile for good,
    // so "Created profile" is true there and must not turn provisional too.
    expect(notifyMock).toHaveBeenCalledWith('Created profile Wet Race', 'success')
  })
})
