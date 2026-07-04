/**
 * Regression test for the #727 perf follow-through (CodeRabbit nit on PR
 * #728): GameList's lazy-load effect fetches Windows shell icons via the
 * get-file-icon IPC for every newly-seen running-app path. Since bundled
 * curated icons are preferred at display time (bundled-first, #727), a shell
 * fetch for a path already covered by bundledIconByPath would be work whose
 * result is never displayed — the effect must skip those paths, while still
 * fetching for paths without a bundled icon (custom apps, built-ins without
 * an asset, the game exe itself).
 */

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const getFileIconMock = vi.fn().mockResolvedValue('data:image/png;base64,SHELL')
const getSettingsMock = vi.fn()

vi.mock('../../src/renderer/src/lib/store', () => ({
  getSettings: (...args: unknown[]) => getSettingsMock(...args),
  onStoreConfigChanged: () => () => {}
}))

vi.mock('../../src/renderer/src/lib/electron', () => ({
  getFileIcon: (...args: unknown[]) => getFileIconMock(...args),
  // Consumed by NotifyProvider; inert subscriptions are enough here.
  onAppLaunchError: () => () => {},
  onProcessNameMismatchWarning: () => () => {}
}))

// GameList only consumes { runningApps, runningStatus, refreshRunningState }.
// Mocked so the test controls the running set without the IPC subscription.
const runningAppsMock = vi.fn()
vi.mock('../../src/renderer/src/hooks/useRunningApps', () => ({
  useRunningApps: () => runningAppsMock()
}))

vi.mock('../../src/renderer/src/hooks/useLaunchBlock', () => ({
  useLaunchBlock: () => ({
    launchingGameKey: null,
    handleLaunchStart: vi.fn(),
    handleLaunchEnd: vi.fn()
  })
}))

// GameRow drags in profile hooks, floating-ui and the store; the lazy-load
// effect under test lives in GameList itself, so the rows can be inert.
vi.mock('../../src/renderer/src/components/game-list/GameRow', () => ({
  GameRow: () => null
}))

import { GameList } from '../../src/renderer/src/components/GameList'
import { NotifyProvider } from '../../src/renderer/src/components/Notify'
import {
  AppsContext,
  type AppsContextValue
} from '../../src/renderer/src/components/settings/AppsContext'
import {
  GamesContext,
  type GamesContextValue
} from '../../src/renderer/src/components/settings/GamesContext'
import { getUtilities } from '../../src/renderer/src/lib/config'
import type { RunningApp } from '../../src/renderer/src/hooks/useRunningApps'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const IRACING_PATH = 'C:\\Games\\iRacing\\iRacingUI.exe'
const CREWCHIEF_PATH = 'C:\\Apps\\CrewChief\\CrewChiefV4.exe'
const CUSTOM_PATH = 'C:\\Apps\\Overlay\\overlay.exe'

function buildAppsContextValue(overrides: Partial<AppsContextValue>): AppsContextValue {
  return {
    appPaths: {},
    appNames: {},
    appArgs: {},
    appIcons: {},
    utilityIcons: {},
    iconLoadErrors: new Set(),
    customSlots: 1,
    utilities: getUtilities(1),
    profiles: {},
    onBrowse: vi.fn(),
    onAppNameChange: vi.fn(),
    onAppPathChange: vi.fn(),
    onAppArgsChange: vi.fn(),
    onIconLoadError: vi.fn(),
    onAddCustomSlot: vi.fn(),
    onRemoveCustomSlot: vi.fn(),
    ...overrides
  }
}

const GAMES_CONTEXT_VALUE: GamesContextValue = {
  gamePaths: { iracing: IRACING_PATH },
  gameIcons: {},
  onBrowse: vi.fn(),
  onGamePathChange: vi.fn()
}

let container: HTMLDivElement
let root: Root | null = null

async function renderGameList(
  appsValue: AppsContextValue,
  runningApps: RunningApp[]
): Promise<void> {
  getSettingsMock.mockResolvedValue({ gamePaths: { iracing: IRACING_PATH } })
  runningAppsMock.mockReturnValue({
    runningApps,
    runningStatus: { iracing: runningApps.length > 0 },
    refreshRunningState: vi.fn().mockResolvedValue(undefined)
  })

  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <NotifyProvider>
        <GamesContext.Provider value={GAMES_CONTEXT_VALUE}>
          <AppsContext.Provider value={appsValue}>
            <GameList onNavigate={vi.fn()} />
          </AppsContext.Provider>
        </GamesContext.Provider>
      </NotifyProvider>
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('GameList shell-icon fetch skip for bundled-covered paths (#727)', () => {
  test('a running app whose path has a bundled icon does NOT trigger a get-file-icon fetch', async () => {
    await renderGameList(
      buildAppsContextValue({
        appPaths: { crewchief: CREWCHIEF_PATH },
        utilityIcons: { crewchief: 'data:image/png;base64,BUNDLED' }
      }),
      [{ path: CREWCHIEF_PATH, name: 'CrewChiefV4.exe', gameKey: 'iracing' }]
    )

    expect(getFileIconMock).not.toHaveBeenCalled()
  })

  test('a running app without a bundled icon still triggers the get-file-icon fetch', async () => {
    await renderGameList(
      buildAppsContextValue({
        appPaths: { crewchief: CREWCHIEF_PATH },
        utilityIcons: { crewchief: 'data:image/png;base64,BUNDLED' }
      }),
      [
        { path: CREWCHIEF_PATH, name: 'CrewChiefV4.exe', gameKey: 'iracing' },
        { path: CUSTOM_PATH, name: 'overlay.exe', gameKey: 'iracing' }
      ]
    )

    expect(getFileIconMock).toHaveBeenCalledTimes(1)
    expect(getFileIconMock).toHaveBeenCalledWith(CUSTOM_PATH)
  })

  test('path-form differences between the configured path and the running entry still skip the fetch', async () => {
    // Configured with forward slashes + trailing space; running entry is the
    // canonical backslash form — the same getPathComparisonKey normalization
    // that makes the bundled icon DISPLAY for this path must also gate the
    // fetch skip, or the "never displayed" shell fetch comes back for exactly
    // the paths the display-side normalization was built to cover.
    await renderGameList(
      buildAppsContextValue({
        appPaths: { crewchief: 'C:/Apps/CrewChief\\CrewChiefV4.exe ' },
        utilityIcons: { crewchief: 'data:image/png;base64,BUNDLED' }
      }),
      [
        {
          path: 'c:\\apps\\crewchief\\crewchiefv4.exe',
          name: 'CrewChiefV4.exe',
          gameKey: 'iracing'
        }
      ]
    )

    expect(getFileIconMock).not.toHaveBeenCalled()
  })
})
