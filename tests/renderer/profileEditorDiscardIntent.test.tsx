/**
 * #951 - ProfileEditor's discard handler acts on why it was asked.
 *
 * It used to close the editor for every discard, including the sticky bar's
 * Discard, where the user only wants the edits gone. Now a `revert` asks the
 * owner to reload it in place (`onReverted`), a `leave` still closes it, and
 * in both the owner's async discard work (`onDiscarded`, the pending "+"
 * profile removal) is awaited before the pipeline resolves (#478).
 *
 * The real ProfileEditor is mounted, made dirty the way a user would (a
 * companion switch), and discarded through the real AppDirtyContext.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const getProfilesMock = vi.fn()

vi.mock('../../src/renderer/src/lib/store', () => ({
  getSettings: vi.fn(async () => ({ appPaths: APP_PATHS, appNames: {}, customSlots: 1 })),
  getProfiles: (...args: unknown[]) => getProfilesMock(...args),
  saveProfile: vi.fn(async () => {})
}))

vi.mock('../../src/renderer/src/lib/electron', () => ({
  getFileIcon: vi.fn(async () => ''),
  browsePath: vi.fn(),
  launchProfile: vi.fn(async () => ({ success: true, launchedCount: 1 }))
}))

vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: vi.fn(), announce: vi.fn() }),
  NotifyProvider: ({ children }: { children: ReactNode }) => children
}))

const APP_PATHS = { simhub: 'C:/Tools/SimHub.exe', crewchief: 'C:/Tools/CrewChief.exe' }
// Referentially stable: useProfileEditor's settings-sync effect depends on them.
const APP_NAMES = {}
const UTILITY_ICONS = {}

vi.mock('../../src/renderer/src/components/settings/AppsContext', () => ({
  useAppsSettings: () => ({
    appPaths: APP_PATHS,
    appNames: APP_NAMES,
    customSlots: 1,
    utilityIcons: UTILITY_ICONS
  })
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

import { ProfileEditor } from '../../src/renderer/src/components/ProfileEditor'
import { AppDirtyProvider, useAppDirty } from '../../src/renderer/src/contexts/AppDirtyContext'

let dirtyContext: ReturnType<typeof useAppDirty> | null = null
function CaptureDirty(): ReactNode {
  dirtyContext = useAppDirty()
  return null
}

const onClose = vi.fn()
const onReverted = vi.fn()
let finishDiscarded: () => void = () => {}
const onDiscarded = vi.fn(() => new Promise<void>((resolve) => (finishDiscarded = resolve)))

let container: HTMLDivElement
let root: Root | null = null

async function renderDirtyEditor(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppDirtyProvider>
        <CaptureDirty />
        <ProfileEditor
          gameKey="iracing"
          activeProfileId="p1"
          onProfilesChanged={vi.fn(async () => {})}
          onClose={onClose}
          onReverted={onReverted}
          onDiscarded={onDiscarded}
        />
      </AppDirtyProvider>
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const toggle = container.querySelector<HTMLInputElement>('#utility-toggle-simhub')
  if (!toggle) throw new Error('editor did not render the SimHub switch')
  await act(async () => {
    toggle.click()
  })
  expect(dirtyContext!.isProfileEditorDirty).toBe(true)
}

// Runs the discard, and proves it resolves only once onDiscarded has.
async function discard(intent?: 'revert' | 'leave'): Promise<void> {
  let resolved = false
  let pipeline: Promise<void> = Promise.resolve()
  await act(async () => {
    pipeline = dirtyContext!.requestDiscardAll(intent).then(() => {
      resolved = true
    })
  })
  expect(onDiscarded).toHaveBeenCalledTimes(1)
  expect(resolved).toBe(false)
  await act(async () => {
    finishDiscarded()
    await pipeline
  })
  expect(resolved).toBe(true)
}

beforeEach(() => {
  vi.clearAllMocks()
  getProfilesMock.mockResolvedValue({
    iracing: {
      activeProfileId: 'p1',
      profiles: [{ id: 'p1', name: 'Race Day', utilities: [{ id: 'simhub', enabled: true }] }]
    }
  })
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('ProfileEditor discard intent (#951)', () => {
  test('a revert (the sticky bar) asks the owner to reload in place and does not close', async () => {
    await renderDirtyEditor()
    await discard('revert')
    expect(onReverted).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  test('a leave (tab switch, close dialog) still closes', async () => {
    await renderDirtyEditor()
    await discard('leave')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onReverted).not.toHaveBeenCalled()
  })

  test('a discard that does not say why behaves as before #951: it closes', async () => {
    await renderDirtyEditor()
    await discard()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onReverted).not.toHaveBeenCalled()
  })
})
