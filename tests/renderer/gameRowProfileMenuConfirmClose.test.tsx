/**
 * Codex P1 on #884 (PR #940): while the profile menu was portalled to body at
 * z-9999 (the PR's first take), a "Switch Running Profile" confirmation opened
 * from it no longer covered it. ConfirmDialog sits at z-100 and useFocusTrap
 * only inerts `#root`, so the menu stayed visible and clickable above the
 * dialog: the user could pick or create another profile while the first switch
 * was waiting for an answer. The portal has since moved into `#root` at z-50,
 * so a dialog covers and inerts the menu either way; what remains is what the
 * user comes back to.
 *
 * The rule: picking a profile that needs confirmation closes the menu and puts
 * focus on the trigger BEFORE the dialog opens, so the dialog's focus trap
 * records the trigger and hands focus back to it when the dialog closes,
 * rather than into a menu whose selection did not happen.
 *
 * The real useProfileMenu is used here (the other GameRow tests mock it open),
 * because the thing under test is that it closes.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const notifyMock = vi.fn()
const getProfileSwitchDiffMock = vi.fn()
const switchProfileAppsMock = vi.fn()
const saveProfileSetMock = vi.fn()

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: vi.fn(),
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

vi.mock('../../src/renderer/src/hooks/useGameProfile', () => ({
  useGameProfile: () => ({
    profileSet: PROFILE_SET,
    profileState: { killControlsEnabled: true, relaunchControlsEnabled: true },
    loadProfileSet: vi.fn().mockResolvedValue(PROFILE_SET),
    getProfileRuntimeConfig: vi.fn().mockResolvedValue(PROFILE_SET),
    saveProfileSet: saveProfileSetMock
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
          // Running is what routes a switch through the confirmation.
          isRunning={true}
          isGameRunning={true}
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

function trigger(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"][aria-label^="Assetto Corsa profile:"]'
  )
  expect(button).not.toBeNull()
  return button!
}

// The menu portals out of the row (into #root, or body when the harness has
// none, as here) and the dialog to body: neither is inside `container`.
const menu = () => document.body.querySelector('[role="menu"]')
const dialog = () => document.body.querySelector('[role="alertdialog"]')

async function openMenuAndPick(name: string): Promise<void> {
  await act(async () => {
    trigger().click()
  })
  expect(menu()).not.toBeNull()
  const option = Array.from(document.body.querySelectorAll('button[role="menuitemradio"]')).find(
    (button) => button.textContent?.includes(name)
  ) as HTMLButtonElement | undefined
  expect(option).toBeDefined()
  await act(async () => {
    option!.focus()
    option!.click()
  })
}

function dialogButton(label: string): HTMLButtonElement {
  const button = Array.from(dialog()!.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  )
  expect(button).toBeDefined()
  return button!
}

beforeEach(() => {
  notifyMock.mockClear()
  switchProfileAppsMock.mockReset()
  saveProfileSetMock.mockReset()
  saveProfileSetMock.mockResolvedValue(undefined)
  // Something to stop and start, so the switch asks first.
  getProfileSwitchDiffMock.mockReset()
  getProfileSwitchDiffMock.mockResolvedValue({ toStopCount: 1, toStartCount: 1 })
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('profile menu closes before the switch confirmation (#884, Codex P1)', () => {
  test('picking a profile that needs confirmation closes the menu and opens the dialog', async () => {
    await renderRunningRow()
    await openMenuAndPick('Race')

    expect(dialog()).not.toBeNull()
    // Left open it would sit under the dialog, inert, and take focus back when
    // the dialog closes: it has to be gone.
    expect(menu()).toBeNull()
    expect(switchProfileAppsMock).not.toHaveBeenCalled()
  })

  test('focus returns to the trigger when the dialog is dismissed', async () => {
    await renderRunningRow()
    await openMenuAndPick('Race')
    expect(dialog()).not.toBeNull()

    await act(async () => {
      dialogButton('Cancel').click()
    })

    expect(dialog()).toBeNull()
    expect(menu()).toBeNull()
    // The focus trap restores whatever was focused when the dialog opened; the
    // menu item that was focused has been unmounted, so the trigger has to
    // have taken focus before the dialog did.
    expect(document.activeElement).toBe(trigger())
  })

  test('the trigger still reopens the menu afterwards', async () => {
    await renderRunningRow()
    await openMenuAndPick('Race')
    await act(async () => {
      dialogButton('Keep Current').click()
    })
    expect(dialog()).toBeNull()

    await act(async () => {
      trigger().click()
    })
    expect(menu()).not.toBeNull()
  })
})
