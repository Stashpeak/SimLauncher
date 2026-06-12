/**
 * useProfileEditor save assembly and delete safety. The save path re-reads the
 * profile set from the store and surgically replaces only the edited profile —
 * sibling profiles must come through byte-identical (clobbering them is silent
 * multi-profile data loss). Delete must refuse to remove the last profile and
 * re-point activeProfileId when the active profile is removed.
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

const APP_PATHS = { simhub: 'C:/Tools/SimHub.exe', crewchief: 'C:/Tools/CrewChief.exe' }
// Referentially stable across renders: useProfileEditor's settings-sync effect
// depends on these objects, and a fresh {} per render would loop it forever.
const APP_NAMES = {}

vi.mock('../../src/renderer/src/components/settings/AppsContext', () => ({
  useAppsSettings: () => ({ appPaths: APP_PATHS, appNames: APP_NAMES, customSlots: 1 })
}))

const SIBLING_PROFILE = {
  id: 'p2',
  name: 'Endurance',
  utilities: [{ id: 'crewchief', enabled: true }],
  trackingEnabled: false,
  trackedProcessPaths: ['C:/Tools/Telemetry.exe']
}

function twoProfileSet() {
  return {
    iracing: {
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Race Day',
          utilities: [{ id: 'simhub', enabled: true }],
          launchAutomatically: true
        },
        { ...SIBLING_PROFILE, utilities: [...SIBLING_PROFILE.utilities] }
      ]
    }
  }
}

function singleProfileSet() {
  return {
    iracing: {
      activeProfileId: 'p1',
      profiles: [{ id: 'p1', name: 'Race Day', utilities: [{ id: 'simhub', enabled: true }] }]
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

beforeEach(() => {
  vi.clearAllMocks()
  getSettingsMock.mockResolvedValue({ appPaths: APP_PATHS, appNames: {}, customSlots: 1 })
  getProfilesMock.mockResolvedValue(twoProfileSet())
  saveProfileMock.mockResolvedValue(undefined)
  onProfilesChangedMock.mockResolvedValue(undefined)
})

describe('useProfileEditor save assembly', () => {
  test('save replaces only the edited profile and preserves siblings verbatim', async () => {
    const harness = await mountEditor()
    try {
      let saved = false
      await act(async () => {
        saved = await harness.getApi().handleSave()
      })

      expect(saved).toBe(true)
      const [gameKey, savedSet] = saveProfileMock.mock.calls[0] as [
        string,
        { activeProfileId: string; profiles: Array<Record<string, unknown>> }
      ]
      expect(gameKey).toBe('iracing')
      expect(savedSet.activeProfileId).toBe('p1')
      expect(savedSet.profiles).toHaveLength(2)
      // The sibling must come through exactly as stored — including fields the
      // editor never touches (trackingEnabled, trackedProcessPaths).
      expect(savedSet.profiles[1]).toEqual(SIBLING_PROFILE)
      expect(onCloseMock).toHaveBeenCalledTimes(1)
    } finally {
      harness.unmount()
    }
  })

  test('a blank profile name falls back to the stored name instead of saving ""', async () => {
    const harness = await mountEditor()
    try {
      await act(async () => {
        harness.getApi().setProfileName('   ')
      })
      await act(async () => {
        await harness.getApi().handleSave()
      })

      const [, savedSet] = saveProfileMock.mock.calls[0] as [
        string,
        { profiles: Array<{ id: string; name: string }> }
      ]
      expect(savedSet.profiles[0].name).toBe('Race Day')
    } finally {
      harness.unmount()
    }
  })

  test('a failed save reports false, notifies, and keeps the editor open', async () => {
    const harness = await mountEditor()
    try {
      saveProfileMock.mockRejectedValueOnce(new Error('store write failed'))

      let saved = true
      await act(async () => {
        saved = await harness.getApi().handleSave()
      })

      expect(saved).toBe(false)
      expect(onCloseMock).not.toHaveBeenCalled()
      expect(notifyMock).toHaveBeenCalledWith('Failed to save profile', 'error')
    } finally {
      harness.unmount()
    }
  })
})

describe('useProfileEditor delete safety', () => {
  test('refuses to delete the last remaining profile', async () => {
    getProfilesMock.mockResolvedValue(singleProfileSet())
    const harness = await mountEditor()
    try {
      await act(async () => {
        await harness.getApi().handleDeleteProfile()
      })

      expect(notifyMock).toHaveBeenCalledWith('At least one profile is required', 'warn')
      expect(harness.getApi().profileDeleteConfirm).toBeNull()
      expect(saveProfileMock).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })

  test('deleting the active profile re-points activeProfileId to a survivor', async () => {
    const harness = await mountEditor()
    try {
      await act(async () => {
        await harness.getApi().handleDeleteProfile()
      })
      expect(harness.getApi().profileDeleteConfirm).toEqual({
        profileId: 'p1',
        profileName: 'Race Day'
      })

      await act(async () => {
        await harness.getApi().confirmDeleteProfile()
      })

      const [, savedSet] = saveProfileMock.mock.calls[0] as [
        string,
        { activeProfileId: string; profiles: Array<{ id: string }> }
      ]
      // A dangling activeProfileId would make every reader fall back
      // unpredictably; it must point at a profile that still exists.
      expect(savedSet.activeProfileId).toBe('p2')
      expect(savedSet.profiles.map((profile) => profile.id)).toEqual(['p2'])
      expect(onCloseMock).toHaveBeenCalledTimes(1)
    } finally {
      harness.unmount()
    }
  })
})
