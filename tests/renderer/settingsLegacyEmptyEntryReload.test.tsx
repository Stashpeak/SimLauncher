/**
 * Regression test for #958's own gap: dropEmptyEntries normalizes the LIVE
 * currentSettingsState memo, but up to v0.9.6 the store persisted an
 * empty-string entry verbatim (and a hand-edited config can too), and
 * get-settings does not sanitize on read. If the baseline built from a store
 * read is not normalized the same way, that legacy entry never agrees with
 * the memo: every non-settings store change (e.g. a per-game profile save,
 * reason 'save-profile') re-baselines from the raw '' entry while the memo
 * keeps dropping it, so isDirty and the per-section dot never clear again.
 */

import { beforeEach, expect, test, vi } from 'vitest'
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useSettingsLoad } from '../../src/renderer/src/components/settings/useSettingsLoad'
import { useSettingsState } from '../../src/renderer/src/components/settings/useSettingsState'
import { useDirtyTracking } from '../../src/renderer/src/hooks/useDirtyTracking'

const getSettingsMock = vi.fn()
const getProfilesMock = vi.fn()
let storeChangedListener: ((payload: { reason: string }) => void) | null = null

vi.mock('../../src/renderer/src/lib/store', () => ({
  getSettings: (...args: unknown[]) => getSettingsMock(...args),
  getProfiles: (...args: unknown[]) => getProfilesMock(...args),
  onStoreConfigChanged: (listener: (payload: { reason: string }) => void) => {
    storeChangedListener = listener
    return () => {
      storeChangedListener = null
    }
  }
}))

vi.mock('../../src/renderer/src/lib/electron', () => ({
  getFileIcon: vi.fn(async () => ''),
  getAssetData: vi.fn(async () => '')
}))

interface ProbeApi {
  isDirty: boolean
  gamesSubsetDirty: boolean
}

function Probe({ onRender }: { onRender: (api: ProbeApi) => void }) {
  const bundle = useSettingsState()
  const themeRef = useRef({ setThemeMode: () => {} })
  const { isDirty, resetDirty, getDirtySubset } = useDirtyTracking(
    bundle.currentSettingsState,
    bundle.state.loading
  )
  useSettingsLoad({
    themeRef,
    latestSettingsObjects: bundle.latestSettingsObjects,
    resetDirty,
    ...bundle.setters
  })

  onRender({ isDirty, gamesSubsetDirty: getDirtySubset(['gamePaths']) })
  return null
}

async function renderProbe(): Promise<{ unmount: () => void; getApi: () => ProbeApi }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let captured: ProbeApi | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(<Probe onRender={(api) => (captured = api)} />)
  })

  // Flush the initial load effect (two microtask hops: getSettings/getProfiles
  // resolving, then the icon-fetch awaits inside loadSettingsFromStore).
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

  if (!captured) {
    throw new Error('Probe did not capture state')
  }

  return {
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    },
    getApi: () => {
      if (!captured) {
        throw new Error('Probe did not capture state')
      }
      return captured
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  storeChangedListener = null
  getSettingsMock.mockResolvedValue({
    appPaths: { simhub: 'C:/Tools/SimHub.exe' },
    appNames: { simhub: 'SimHub' },
    // A legacy entry a pre-#916f6d6 build (or a hand-edited config) can still
    // hold: the main-process sanitizer that would have dropped this before
    // persisting did not exist yet, and get-settings does not sanitize on read.
    appArgs: { simhub: '' },
    gamePaths: { iracing: 'C:/Games/iRacingUI.exe', acc: '' },
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

test('a legacy empty store entry does not come back dirty after a save-profile reload (#958)', async () => {
  const harness = await renderProbe()
  try {
    expect(harness.getApi().isDirty).toBe(false)
    expect(harness.getApi().gamesSubsetDirty).toBe(false)

    // A per-game profile save reloads settings and re-baselines
    // (useSettingsLoad's onStoreConfigChanged handler), but must not
    // resurrect the stored acc:'' entry as a dirty diff.
    await act(async () => {
      storeChangedListener?.({ reason: 'save-profile' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(harness.getApi().isDirty).toBe(false)
    expect(harness.getApi().gamesSubsetDirty).toBe(false)
  } finally {
    harness.unmount()
  }
})
