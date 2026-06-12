/**
 * #480 key-order contract: the dirty baseline is a JSON string compare, so the
 * snapshot built by useSettingsLoad must carry the exact same keys in the exact
 * same order as the currentSettingsState memo in useSettingsState. A reordered
 * or missing key reads as permanently dirty (or permanently clean) — this test
 * fails as soon as one side adds a key without the other.
 */

import { beforeEach, expect, test, vi } from 'vitest'
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useSettingsLoad } from '../../src/renderer/src/components/settings/useSettingsLoad'
import {
  useSettingsState,
  type SettingsStateSnapshot
} from '../../src/renderer/src/components/settings/useSettingsState'

const getSettingsMock = vi.fn()
const getProfilesMock = vi.fn()

vi.mock('../../src/renderer/src/lib/store', () => ({
  getSettings: (...args: unknown[]) => getSettingsMock(...args),
  getProfiles: (...args: unknown[]) => getProfilesMock(...args),
  onStoreConfigChanged: () => () => {}
}))

vi.mock('../../src/renderer/src/lib/electron', () => ({
  getFileIcon: vi.fn(async () => ''),
  getAssetData: vi.fn(async () => '')
}))

interface ProbeApi {
  loadSettingsFromStore: () => Promise<SettingsStateSnapshot>
  currentSettingsState: SettingsStateSnapshot
}

function Probe({ onCapture }: { onCapture: (api: ProbeApi) => void }) {
  const bundle = useSettingsState()
  const themeRef = useRef({ setThemeMode: () => {} })
  const { loadSettingsFromStore } = useSettingsLoad({
    themeRef,
    latestSettingsObjects: bundle.latestSettingsObjects,
    resetDirty: () => {},
    ...bundle.setters
  })

  onCapture({ loadSettingsFromStore, currentSettingsState: bundle.currentSettingsState })
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  getSettingsMock.mockResolvedValue({
    appPaths: { simhub: 'C:/Tools/SimHub.exe' },
    appNames: { simhub: 'SimHub' },
    appArgs: {},
    gamePaths: { iracing: 'C:/Games/iRacingUI.exe' },
    customSlots: 1,
    accentPreset: 'teal',
    accentCustom: '',
    accentBgTint: false,
    themeMode: 'dark',
    focusActiveTitle: true,
    launchDelayMs: 1000,
    startWithWindows: false,
    startMinimized: false,
    minimizeToTray: false,
    showTrayIcon: true,
    autoCheckUpdates: true,
    zoomFactor: 1
  })
  getProfilesMock.mockResolvedValue({})
})

test('useSettingsLoad snapshot and currentSettingsState agree on keys AND order (#480)', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let captured: ProbeApi | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(<Probe onCapture={(api) => (captured = api)} />)
  })

  try {
    if (!captured) throw new Error('Probe did not capture state')
    let snapshot: SettingsStateSnapshot | null = null
    await act(async () => {
      snapshot = await captured!.loadSettingsFromStore()
    })

    const snapshotKeys = Object.keys(snapshot!)
    const stateKeys = Object.keys(captured!.currentSettingsState)

    // toEqual on arrays is order-sensitive — exactly what the JSON string
    // compare in useDirtyTracking needs.
    expect(snapshotKeys).toEqual(stateKeys)

    // After a load, the freshly rendered state must serialize identically to
    // the snapshot the loader returned — this is the resetDirty(snapshot)
    // contract: baseline === live state ⇒ clean.
    expect(JSON.stringify(captured!.currentSettingsState)).toBe(JSON.stringify(snapshot))
  } finally {
    act(() => {
      root?.unmount()
    })
    container.remove()
  }
})
