/**
 * Characterization tests for the renderer settings-save path (#645, #669).
 *
 * `useSettingsSave.handleSave` is the flagged under-tested code the upcoming
 * share / non-destructive import-merge work will refactor. These tests pin its
 * observable contract BEFORE that change so a merge/overwrite regression can't
 * ship silently (cf. the 0.9.11 games-list-refresh data-loss regression). They
 * assert behavior, not internals:
 *
 *   1. Successful save persists the full expected settings shape via
 *      `persistSettings` AND profiles via `saveProfiles`; paths keep the
 *      empty-string sentinel while whitespace is trimmed, blank args are
 *      dropped, and `launchDelayMs` is normalized.
 *   2. The resetDirty baseline is rebuilt from the RETURNED persisted settings
 *      — not the live pre-trim renderer state — so on-disk truth is the
 *      baseline and mid-save edits stay visibly dirty.
 *   3. The save-race guard: a field edited while the IPC write is in flight is
 *      NOT clobbered by the stale pre-save persisted copy; untouched fields ARE
 *      pushed back.
 *   4. The error path surfaces a toast, returns false, never throws, and leaves
 *      no partial-state writes.
 *   5. (#669) When the main process reports dropped entries, the baseline uses
 *      the persisted (post-drop) settings, a warning naming what was not saved
 *      is shown, and the plain "Settings saved!" success toast is NOT shown.
 */

import { describe, expect, test, vi, beforeEach } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useSettingsSave } from '../../src/renderer/src/components/settings/useSettingsSave'
import { createSettingsObjectVersions } from '../../src/renderer/src/components/settings/saveRace'

// Mocking the whole store module also sidesteps its module-eval reads of
// window.electronAPI (store.ts binds saveSettings/saveProfiles at import time).
const saveSettingsMock = vi.fn()
const saveProfilesMock = vi.fn()
vi.mock('../../src/renderer/src/lib/store', () => ({
  saveSettings: (...args: unknown[]) => saveSettingsMock(...args),
  saveProfiles: (...args: unknown[]) => saveProfilesMock(...args)
}))

const notifyMock = vi.fn()
const resetDirtyMock = vi.fn()
const setAppPathsMock = vi.fn()
const setGamePathsMock = vi.fn()
const setAppArgsMock = vi.fn()
const setLaunchDelayMsMock = vi.fn()

// A valid Profiles value; passed through verbatim to saveProfiles.
const PROFILES = { iracing: { utilities: [] } }

// The live, PRE-TRIM renderer state. Whitespace on paths, a blank arg entry,
// and an out-of-range launch delay all exercise the save-time normalization.
// currentSettingsState mirrors these live values so the tests can prove the
// resetDirty baseline uses the SAVED (trimmed/normalized) copies instead.
function liveState() {
  return {
    appPaths: { simhub: '  C:/Tools/SimHub.exe  ', iracing: '' },
    appNames: { simhub: 'SimHub' },
    appArgs: { simhub: ' --foo ', blank: '   ' },
    profiles: PROFILES,
    gamePaths: { iracing: '  C:/Games/iRacingUI.exe  ' },
    customSlots: 2,
    accentPreset: 'teal',
    accentCustom: '',
    accentBgTint: false,
    themeMode: 'dark' as const,
    focusActiveTitle: true,
    launchDelayMs: 40000,
    startWithWindows: false,
    startMinimized: false,
    minimizeToTray: true,
    showTrayIcon: true,
    autoCheckUpdates: true,
    zoomFactor: 1
  }
}

// The persisted / re-baselined shape after save-time normalization:
//   paths trimmed (empty-string sentinel preserved), blank args dropped,
//   launchDelayMs clamped 40000 -> 30000.
const SAVED_APP_PATHS = { simhub: 'C:/Tools/SimHub.exe', iracing: '' }
const SAVED_APP_ARGS = { simhub: '--foo' }
const SAVED_GAME_PATHS = { iracing: 'C:/Games/iRacingUI.exe' }
const NORMALIZED_DELAY = 30000

type SaveArgs = Parameters<typeof useSettingsSave>[0]

function buildArgs(overrides: Partial<SaveArgs> = {}): SaveArgs {
  const live = liveState()
  return {
    ...live,
    currentSettingsState: live,
    settingsObjectEditVersions: { current: createSettingsObjectVersions() },
    notify: notifyMock,
    resetDirty: resetDirtyMock,
    setAppPaths: setAppPathsMock,
    setGamePaths: setGamePathsMock,
    setAppArgs: setAppArgsMock,
    setLaunchDelayMs: setLaunchDelayMsMock,
    ...overrides
  }
}

function Probe({
  args,
  onCapture
}: {
  args: SaveArgs
  onCapture: (h: () => Promise<boolean>) => void
}) {
  const { handleSave } = useSettingsSave(args)
  // Capture in an effect, not during render — matches the other probe tests and
  // avoids a render-time side effect that can run more than once.
  useEffect(() => {
    onCapture(handleSave)
  }, [onCapture, handleSave])
  return null
}

async function renderSave(
  args: SaveArgs
): Promise<{ handleSave: () => Promise<boolean>; unmount: () => void }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let handleSave: (() => Promise<boolean>) | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(<Probe args={args} onCapture={(h) => (handleSave = h)} />)
  })

  if (!handleSave) throw new Error('Probe did not capture handleSave')

  return {
    handleSave,
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default stand-in for the main process: nothing is dropped, and the
  // "persisted" settings echoed back are exactly what was sent — matching a
  // sanitizer that accepts the whole patch unchanged.
  saveSettingsMock.mockImplementation((patch: Record<string, unknown>) =>
    Promise.resolve({ settings: patch, dropped: [] })
  )
  saveProfilesMock.mockResolvedValue(undefined)
})

describe('useSettingsSave (#645)', () => {
  test('successful save persists the trimmed/normalized shape and the profiles', async () => {
    const harness = await renderSave(buildArgs())
    try {
      let result: boolean | undefined
      await act(async () => {
        result = await harness.handleSave()
      })

      expect(result).toBe(true)

      // persistSettings gets the full settings shape: paths trimmed with the
      // empty sentinel preserved, blank args dropped, delay normalized. Names
      // (untracked here) flow through untouched, and profiles are NOT part of
      // this call.
      expect(saveSettingsMock).toHaveBeenCalledTimes(1)
      expect(saveSettingsMock).toHaveBeenCalledWith({
        appPaths: SAVED_APP_PATHS,
        appNames: { simhub: 'SimHub' },
        appArgs: SAVED_APP_ARGS,
        gamePaths: SAVED_GAME_PATHS,
        customSlots: 2,
        accentPreset: 'teal',
        accentCustom: '',
        accentBgTint: false,
        themeMode: 'dark',
        focusActiveTitle: true,
        launchDelayMs: NORMALIZED_DELAY,
        startMinimized: false,
        minimizeToTray: true,
        showTrayIcon: true,
        autoCheckUpdates: true,
        startWithWindows: false,
        zoomFactor: 1
      })

      // Profiles persist through their own channel, verbatim.
      expect(saveProfilesMock).toHaveBeenCalledTimes(1)
      expect(saveProfilesMock).toHaveBeenCalledWith(PROFILES)

      expect(notifyMock).toHaveBeenCalledWith('Settings saved!', 'success', 2500)
    } finally {
      harness.unmount()
    }
  })

  test('no unrelated config is dropped: a mid-save-untouched field is pushed back trimmed', async () => {
    const harness = await renderSave(buildArgs())
    try {
      await act(async () => {
        await harness.handleSave()
      })

      // With no concurrent edit, every object field is written back into state
      // as its trimmed/normalized copy — no unrelated field is dropped.
      expect(setAppPathsMock).toHaveBeenCalledWith(SAVED_APP_PATHS)
      expect(setGamePathsMock).toHaveBeenCalledWith(SAVED_GAME_PATHS)
      expect(setAppArgsMock).toHaveBeenCalledWith(SAVED_APP_ARGS)
      expect(setLaunchDelayMsMock).toHaveBeenCalledWith(NORMALIZED_DELAY)
    } finally {
      harness.unmount()
    }
  })

  test('resetDirty baseline uses the SAVED objects and normalized delay, not the live pre-trim state', async () => {
    const harness = await renderSave(buildArgs())
    try {
      await act(async () => {
        await harness.handleSave()
      })

      expect(resetDirtyMock).toHaveBeenCalledTimes(1)
      const baseline = resetDirtyMock.mock.calls[0][0]

      // The whole re-baseline snapshot: object records come from the SAVED
      // (trimmed) copies, launchDelayMs is normalized, and every other field is
      // carried over from currentSettingsState unchanged.
      expect(baseline).toEqual({
        appPaths: SAVED_APP_PATHS,
        appNames: { simhub: 'SimHub' },
        appArgs: SAVED_APP_ARGS,
        profiles: PROFILES,
        gamePaths: SAVED_GAME_PATHS,
        customSlots: 2,
        accentPreset: 'teal',
        accentCustom: '',
        accentBgTint: false,
        themeMode: 'dark',
        focusActiveTitle: true,
        launchDelayMs: NORMALIZED_DELAY,
        startWithWindows: false,
        startMinimized: false,
        minimizeToTray: true,
        showTrayIcon: true,
        autoCheckUpdates: true,
        zoomFactor: 1
      })

      // The point of the test: the baseline is what hit disk, NOT the live
      // untrimmed paths / un-normalized delay still sitting in renderer state.
      expect(baseline.appPaths).not.toEqual(liveState().appPaths)
      expect(baseline.launchDelayMs).not.toBe(liveState().launchDelayMs)
    } finally {
      harness.unmount()
    }
  })

  test('save-race guard: a field edited during the in-flight write is not clobbered; untouched fields are', async () => {
    // A controllable ref + a deferred persistSettings lets us inject a
    // concurrent edit into the exact window between snapshot and completion.
    const editVersions = { current: createSettingsObjectVersions() }
    let resolveSave: () => void = () => {}
    saveSettingsMock.mockImplementation(
      (patch: Record<string, unknown>) =>
        new Promise((resolve) => {
          resolveSave = () => resolve({ settings: patch, dropped: [] })
        })
    )

    const harness = await renderSave(buildArgs({ settingsObjectEditVersions: editVersions }))
    try {
      let savePromise: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        // Kicks off the save; the pre-await version snapshot is captured here
        // synchronously, then it parks on the deferred persistSettings.
        savePromise = harness.handleSave()
      })

      // The user edits appPaths while the IPC write is still in flight.
      editVersions.current.appPaths += 1

      let result: boolean | undefined
      await act(async () => {
        resolveSave()
        result = await savePromise
      })

      expect(result).toBe(true)

      // appPaths changed mid-save → the stale pre-save trimmed copy must NOT be
      // written back over the user's newer edit.
      expect(setAppPathsMock).not.toHaveBeenCalled()

      // gamePaths / appArgs were untouched → they ARE pushed back trimmed.
      expect(setGamePathsMock).toHaveBeenCalledWith(SAVED_GAME_PATHS)
      expect(setAppArgsMock).toHaveBeenCalledWith(SAVED_APP_ARGS)
      expect(setLaunchDelayMsMock).toHaveBeenCalledWith(NORMALIZED_DELAY)

      // The dirty baseline still records the SAVED appPaths (what is on disk),
      // so the concurrent edit stays visibly dirty and re-saveable.
      expect(resetDirtyMock).toHaveBeenCalledTimes(1)
      expect(resetDirtyMock.mock.calls[0][0].appPaths).toEqual(SAVED_APP_PATHS)
    } finally {
      harness.unmount()
    }
  })

  test('error path: a rejected persistSettings notifies, returns false, and writes no partial renderer state', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    saveSettingsMock.mockRejectedValue(new Error('disk write failed'))

    const harness = await renderSave(buildArgs())
    try {
      let result: boolean | undefined
      await act(async () => {
        // Must not throw — the rejection is caught inside handleSave.
        result = await harness.handleSave()
      })

      expect(result).toBe(false)
      expect(notifyMock).toHaveBeenCalledWith('Failed to save settings', 'error')

      // "No partial state" here means no partial RENDERER-state updates: none of
      // the write-back setters, the delay setter, or the dirty re-baseline run
      // when the persist fails. Persistence itself is NOT atomic — handleSave
      // fires persistSettings + saveProfiles in one Promise.all, so a failed
      // settings write does not stop the profiles write from being attempted.
      expect(saveProfilesMock).toHaveBeenCalledTimes(1)
      expect(setAppPathsMock).not.toHaveBeenCalled()
      expect(setGamePathsMock).not.toHaveBeenCalled()
      expect(setAppArgsMock).not.toHaveBeenCalled()
      expect(setLaunchDelayMsMock).not.toHaveBeenCalled()
      expect(resetDirtyMock).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
      consoleSpy.mockRestore()
    }
  })

  // #669: the main-process sanitizer rejects (rather than persists) an
  // invalid entry. This must never show a plain "Settings saved!" over data
  // that silently didn't make it to disk, and the renderer must re-baseline
  // from what the main process actually persisted, not its own pre-save copy.
  test('#669: a dropped entry surfaces a warning instead of "Settings saved!" and the baseline drops it too', async () => {
    saveSettingsMock.mockImplementation((patch: Record<string, unknown>) => {
      const sentAppPaths = patch.appPaths as Record<string, string>
      // Simulate the main process rejecting the simhub entry (e.g. a pasted
      // .bat path) — the persisted appPaths omits it entirely.
      const persistedAppPaths = Object.fromEntries(
        Object.entries(sentAppPaths).filter(([key]) => key !== 'simhub')
      )
      return Promise.resolve({
        settings: { ...patch, appPaths: persistedAppPaths },
        dropped: [{ field: 'appPaths', key: 'simhub' }]
      })
    })

    const harness = await renderSave(buildArgs())
    try {
      let result: boolean | undefined
      await act(async () => {
        result = await harness.handleSave()
      })

      expect(result).toBe(true)

      // No plain success toast when something was silently rejected.
      expect(notifyMock).not.toHaveBeenCalledWith('Settings saved!', 'success', 2500)
      // A clearly-worded warning names the affected field and why.
      expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('SimHub'), 'warn')
      expect(notifyMock).toHaveBeenCalledWith(expect.stringContaining('.exe'), 'warn')

      // The renderer's own appPaths state is corrected to match the persisted
      // truth — the rejected entry does not linger in the input as if saved.
      expect(setAppPathsMock).toHaveBeenCalledWith({ iracing: '' })

      // The dirty baseline reflects the persisted (post-drop) settings, not
      // the renderer's local (pre-drop) copy.
      expect(resetDirtyMock).toHaveBeenCalledTimes(1)
      expect(resetDirtyMock.mock.calls[0][0].appPaths).toEqual({ iracing: '' })
    } finally {
      harness.unmount()
    }
  })
})
