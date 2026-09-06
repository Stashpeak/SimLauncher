/**
 * A successful Close Apps was styled like a warning (#889): success, partial
 * close and total failure all produced the amber toast, so the one signal that
 * told them apart carried nothing, and a user learns to ignore the warning
 * styling on the day the close actually fails.
 *
 * Asserted at the notification layer, like gameRowStrandedConsentPrompt.test.tsx
 * (#809): what reaches `notify` is what a person sees.
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
const ACCESS_DENIED = {
  appName: 'AdminTool.exe',
  appPath: 'C:/Tools/AdminTool.exe',
  reason: 'access_denied'
}

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
          isRunning={true}
          isGameRunning={false}
          runningAppIcons={[
            { appPath: 'C:/Tools/AdminTool.exe', icon: 'assets/admin.png', name: 'AdminTool' },
            { appPath: 'C:/Tools/SimHub.exe', icon: 'assets/simhub.png', name: 'SimHub' }
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

async function closeApps(result: Record<string, unknown>): Promise<void> {
  killLaunchedAppsMock.mockResolvedValue(result)
  await renderRunningRow()
  const button = container.querySelector(
    'button[aria-label="Close companion apps for Assetto Corsa"]'
  ) as HTMLButtonElement | null
  expect(button).not.toBeNull()
  await act(async () => {
    button!.click()
  })
  expect(notifyMock).toHaveBeenCalledTimes(1)
}

function toast(): { text: string; type: string } {
  const [text, type] = notifyMock.mock.calls[0]
  return { text: String(text), type: String(type) }
}

beforeEach(() => {
  notifyMock.mockClear()
  killLaunchedAppsMock.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('GameRow Close Apps toast styling (#889)', () => {
  test('a close that closed everything is a success', async () => {
    await closeApps({
      success: true,
      closedCount: 2,
      failedCount: 0,
      failures: [],
      message: 'Closed 2 companion apps.'
    })
    expect(toast()).toEqual({ text: 'Closed 2 companion apps.', type: 'success' })
  })

  test('a partial close is a warning: some closed, some did not', async () => {
    await closeApps({
      success: false,
      closedCount: 1,
      failedCount: 1,
      failures: [ACCESS_DENIED]
    })
    expect(toast().type).toBe('warn')
    expect(toast().text).toContain('AdminTool.exe')
  })

  test('a close that closed nothing because every attempt failed is an error', async () => {
    await closeApps({
      success: false,
      closedCount: 0,
      failedCount: 1,
      failures: [ACCESS_DENIED]
    })
    expect(toast().type).toBe('error')
    expect(toast().text).toContain('AdminTool.exe')
  })

  test('a close refused outright is an error', async () => {
    await closeApps({
      success: false,
      error: 'Kill request includes an app path that is not configured.',
      closedCount: 0,
      failedCount: 0,
      failures: []
    })
    expect(toast()).toEqual({
      text: 'Kill request includes an app path that is not configured.',
      type: 'error'
    })
  })

  test('nothing to close stays a warning, with its reason in the text', async () => {
    await closeApps({
      success: true,
      closedCount: 0,
      failedCount: 0,
      failures: [],
      message: 'No running companion apps to close.'
    })
    expect(toast()).toEqual({ text: 'No running companion apps to close.', type: 'warn' })
  })

  test('a successful close that stranded a consent prompt stays a warning (#809)', async () => {
    await closeApps({
      success: true,
      closedCount: 1,
      failedCount: 0,
      failures: [],
      message: 'Closed 1 companion app.',
      strandedConsentPrompts: 1
    })
    expect(toast().type).toBe('warn')
    expect(toast().text).toContain('Closed 1 companion app.')
    expect(toast().text).toContain('permission prompt')
  })
})
