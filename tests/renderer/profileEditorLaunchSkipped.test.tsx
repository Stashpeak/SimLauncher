/**
 * Regression test for #639 in the profile editor's own launch path
 * (useProfileEditor's executeLaunch). Mirrors gameRowLaunchSkipped.test.tsx,
 * but exercises the resolution branch that DOES have the settings-driven
 * appNames/utilities lookup in scope, so a skipped companion resolves to its
 * configured display name (not just the exe basename).
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
const notifyMock = vi.fn()
const launchProfileMock = vi.fn()

vi.mock('../../src/renderer/src/lib/store', () => ({
  getSettings: (...args: unknown[]) => getSettingsMock(...args),
  getProfiles: (...args: unknown[]) => getProfilesMock(...args),
  saveProfile: vi.fn()
}))

vi.mock('../../src/renderer/src/lib/electron', () => ({
  getFileIcon: vi.fn(async () => ''),
  browsePath: vi.fn(),
  launchProfile: (...args: unknown[]) => launchProfileMock(...args)
}))

vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: notifyMock })
}))

const APP_PATHS = { simhub: 'C:/Tools/SimHub.exe' }
// Custom name for the simhub slot — proves the resolution order picks this up
// over the built-in "SimHub" utility default (#639 mirrors #669's order).
const APP_NAMES = { simhub: 'My Dash' }

vi.mock('../../src/renderer/src/components/settings/AppsContext', () => ({
  useAppsSettings: () => ({ appPaths: APP_PATHS, appNames: APP_NAMES, customSlots: 1 })
}))

function profileSet() {
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
      onProfilesChanged: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn()
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
  getSettingsMock.mockResolvedValue({ appPaths: APP_PATHS, appNames: APP_NAMES, customSlots: 1 })
  getProfilesMock.mockResolvedValue(profileSet())
})

describe('useProfileEditor launch skipped-entry warning (#639)', () => {
  test('warns naming the game when the game exe itself was skipped', async () => {
    launchProfileMock.mockResolvedValue({
      success: true,
      launchedCount: 1,
      skipped: [{ key: 'iracing', path: 'C:/Games/iRacing/iRacing.exe', reason: 'missing' }]
    })

    const harness = await mountEditor()
    try {
      await act(async () => {
        await harness.getApi().handleLaunch()
      })

      expect(notifyMock).toHaveBeenCalledWith(
        'iRacing was skipped: its path no longer exists.',
        'warn',
        5000
      )
    } finally {
      harness.unmount()
    }
  })

  test('resolves a skipped companion to its configured custom name, not the raw path', async () => {
    launchProfileMock.mockResolvedValue({
      success: true,
      launchedCount: 1,
      skipped: [{ key: 'simhub', path: 'C:/Tools/SimHub.exe', reason: 'missing' }]
    })

    const harness = await mountEditor()
    try {
      await act(async () => {
        await harness.getApi().handleLaunch()
      })

      expect(notifyMock).toHaveBeenCalledWith(
        'My Dash was skipped: its path no longer exists.',
        'warn',
        5000
      )
    } finally {
      harness.unmount()
    }
  })

  test('shows the plain success toast when nothing was skipped', async () => {
    launchProfileMock.mockResolvedValue({
      success: true,
      launchedCount: 1,
      message: 'All profile applications launched.'
    })

    const harness = await mountEditor()
    try {
      await act(async () => {
        await harness.getApi().handleLaunch()
      })

      expect(notifyMock).toHaveBeenCalledWith(
        'All profile applications launched.',
        'success',
        undefined
      )
    } finally {
      harness.unmount()
    }
  })
})
