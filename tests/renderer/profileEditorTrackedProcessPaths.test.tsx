/**
 * useProfileEditor's typed "Secondary executables to watch" entries (#890).
 *
 * Once the field takes typed input, an entry can be something the store's
 * sanitizer rejects. That sanitizer drops a rejected entry and says nothing,
 * so an in-place edit of a working path to a non-.exe would report "Profile
 * saved!" and erase the working path from disk: the #806 shape, one screen
 * over. The editor therefore refuses such a save with the same rule main
 * applies, before anything is written.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  useProfileEditor,
  type UseProfileEditorResult
} from '../../src/renderer/src/hooks/useProfileEditor'

const getSettingsMock = vi.fn()
const getProfilesMock = vi.fn()
const saveProfileMock = vi.fn()
const notifyMock = vi.fn()
const onCloseMock = vi.fn()
const onProfilesChangedMock = vi.fn()

vi.mock('../../src/renderer/src/lib/store', () => ({
  getSettings: (...args: unknown[]) => getSettingsMock(...args),
  getProfiles: (...args: unknown[]) => getProfilesMock(...args),
  saveProfile: (...args: unknown[]) => saveProfileMock(...args)
}))

vi.mock('../../src/renderer/src/lib/electron', () => ({
  getFileIcon: vi.fn(async () => ''),
  browsePath: vi.fn(),
  launchProfile: vi.fn(async () => ({ success: true, launchedCount: 1 }))
}))

vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: notifyMock })
}))

const APP_PATHS = { simhub: 'C:/Tools/SimHub.exe' }
// Referentially stable across renders: useProfileEditor's settings-sync effect
// depends on these objects, and a fresh {} per render would loop it forever.
const APP_NAMES = {}

vi.mock('../../src/renderer/src/components/settings/AppsContext', () => ({
  useAppsSettings: () => ({ appPaths: APP_PATHS, appNames: APP_NAMES, customSlots: 1 })
}))

const STORED_TRACKED_PATH = 'C:/Tools/Telemetry.exe'

function profileSet() {
  return {
    iracing: {
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Race Day',
          utilities: [{ id: 'simhub', enabled: true }],
          trackedProcessPaths: [STORED_TRACKED_PATH]
        }
      ]
    }
  }
}

function Probe({ onCapture }: { onCapture: (api: UseProfileEditorResult) => void }) {
  onCapture(
    useProfileEditor({
      gameKey: 'iracing',
      activeProfileId: 'p1',
      onProfilesChanged: onProfilesChangedMock,
      onClose: onCloseMock
    })
  )
  return null
}

async function mountEditor() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let captured: UseProfileEditorResult | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(<Probe onCapture={(api) => (captured = api)} />)
  })

  return {
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    },
    getApi: () => {
      if (!captured) throw new Error('Probe did not capture state')
      return captured
    }
  }
}

function savedTrackedPaths(): string[] {
  const [, savedSet] = saveProfileMock.mock.calls[0] as [
    string,
    { profiles: Array<{ trackedProcessPaths: string[] }> }
  ]
  return savedSet.profiles[0].trackedProcessPaths
}

beforeEach(() => {
  vi.clearAllMocks()
  getSettingsMock.mockResolvedValue({ appPaths: APP_PATHS, appNames: {}, customSlots: 1 })
  getProfilesMock.mockResolvedValue(profileSet())
  saveProfileMock.mockResolvedValue(undefined)
  onProfilesChangedMock.mockResolvedValue(undefined)
})

describe('useProfileEditor typed secondary executables (#890)', () => {
  test('a typed path replaces the entry at its index and is saved', async () => {
    const harness = await mountEditor()
    try {
      await act(async () => {
        harness.getApi().handleTrackedProcessPathChange(0, 'C:/Tools/Overlay.exe')
      })
      expect(harness.getApi().trackedProcessPaths).toEqual(['C:/Tools/Overlay.exe'])

      let saved = false
      await act(async () => {
        saved = await harness.getApi().handleSave()
      })

      expect(saved).toBe(true)
      expect(savedTrackedPaths()).toEqual(['C:/Tools/Overlay.exe'])
    } finally {
      harness.unmount()
    }
  })

  test('a value pasted from Copy as path, quotes and all, is accepted', async () => {
    // Windows 11's "Copy as path" wraps the value in double quotes. The
    // store's sanitizer strips one matched pair (#859), so the editor must let
    // it through rather than refuse it as not ending in .exe.
    const harness = await mountEditor()
    try {
      await act(async () => {
        harness.getApi().handleTrackedProcessPathChange(0, '"C:/Tools/Overlay.exe"')
      })

      let saved = false
      await act(async () => {
        saved = await harness.getApi().handleSave()
      })

      expect(saved).toBe(true)
      expect(saveProfileMock).toHaveBeenCalledTimes(1)
      expect(notifyMock).not.toHaveBeenCalledWith(expect.stringContaining('Not saved'), 'warn')
    } finally {
      harness.unmount()
    }
  })

  test('an entry that is not an .exe path refuses the save and leaves the stored one alone', async () => {
    const harness = await mountEditor()
    try {
      await act(async () => {
        harness.getApi().handleTrackedProcessPathChange(0, 'C:/Tools/notes.txt')
      })

      let saved = true
      await act(async () => {
        saved = await harness.getApi().handleSave()
      })

      expect(saved).toBe(false)
      // Nothing reached the store, so the previously stored path is intact.
      // The sanitizer would have dropped the entry and written the profile
      // without it, which is the erase this test exists to prevent.
      expect(saveProfileMock).not.toHaveBeenCalled()
      expect(notifyMock).toHaveBeenCalledWith(
        'Not saved: Secondary executable 1 (must be an .exe path)',
        'warn'
      )
      // The editor stays open on the offending value so it can be corrected.
      expect(onCloseMock).not.toHaveBeenCalled()
      expect(harness.getApi().trackedProcessPaths).toEqual(['C:/Tools/notes.txt'])
    } finally {
      harness.unmount()
    }
  })

  test('the Save & Create New path applies the same refusal', async () => {
    const harness = await mountEditor()
    try {
      await act(async () => {
        harness.getApi().handleTrackedProcessPathChange(0, 'C:/Tools/notes.txt')
      })

      let saved = true
      await act(async () => {
        saved = await harness.getApi().handleSaveOnly()
      })

      expect(saved).toBe(false)
      expect(saveProfileMock).not.toHaveBeenCalled()
      expect(notifyMock).toHaveBeenCalledWith(
        'Not saved: Secondary executable 1 (must be an .exe path)',
        'warn'
      )
    } finally {
      harness.unmount()
    }
  })

  test('a blank row is not an entry and is dropped at save, as before', async () => {
    const harness = await mountEditor()
    try {
      await act(async () => {
        harness.getApi().handleAddTrackedProcess()
      })
      expect(harness.getApi().trackedProcessPaths).toEqual([STORED_TRACKED_PATH, ''])

      let saved = false
      await act(async () => {
        saved = await harness.getApi().handleSave()
      })

      expect(saved).toBe(true)
      expect(savedTrackedPaths()).toEqual([STORED_TRACKED_PATH])
    } finally {
      harness.unmount()
    }
  })
})
