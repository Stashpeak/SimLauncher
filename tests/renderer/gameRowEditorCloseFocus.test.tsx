/**
 * Regression test for #957, second mechanism: every route that closes the
 * profile editor from inside it (Save on the sticky bar or in the card,
 * Cancel, Escape, a confirm dialog, Delete) unmounts the control that had
 * focus, and nothing put focus anywhere, so the next Tab restarted at the
 * titlebar. All of them end in the editor's `onClose`, so the editor is
 * stubbed here to a single button that calls it: the thing under test is what
 * GameRow does once the editor has gone.
 *
 * The target is the row's editor toggle (the gear), the one control that
 * outlives the close and where the gear-X route already leaves focus.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../src/renderer/src/lib/electron', () => ({
  launchProfile: vi.fn(),
  killLaunchedApps: vi.fn(),
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
  useNotify: () => ({ notify: vi.fn(), announce: vi.fn() }),
  NotifyProvider: ({ children }: { children: ReactNode }) => children
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
    saveProfileSet: vi.fn()
  })
}))

vi.mock('../../src/renderer/src/components/ProfileEditor', () => ({
  ProfileEditor: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      Save Profile
    </button>
  )
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

import { GameRow } from '../../src/renderer/src/components/game-list/GameRow'
import { AppDirtyProvider } from '../../src/renderer/src/contexts/AppDirtyContext'
import type { Game } from '../../src/renderer/src/lib/config'

const GAME: Game = { key: 'ac', name: 'Assetto Corsa', icon: 'assets/ac.png' }

// Owns isActive the way GameList does, so closing really unmounts the editor.
function Harness(): ReactNode {
  const [isActive, setIsActive] = useState(true)
  return (
    <AppDirtyProvider>
      <GameRow
        game={GAME}
        isActive={isActive}
        isRunning={false}
        isGameRunning={false}
        runningAppIcons={[]}
        isDimmed={false}
        isLaunching={false}
        isLaunchBlocked={false}
        onLaunchStart={vi.fn()}
        onLaunchEnd={vi.fn()}
        onRunningStateRefresh={vi.fn().mockResolvedValue(undefined)}
        onToggleEditor={() => setIsActive((current) => !current)}
        onCloseEditor={() => setIsActive(false)}
        cacheInitialized={true}
      />
    </AppDirtyProvider>
  )
}

let container: HTMLDivElement
let root: Root | null = null

async function render(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<Harness />)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const gear = () =>
  container.querySelector<HTMLButtonElement>('button[aria-controls="profile-editor-ac"]')

const editorButton = () =>
  Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Save Profile'
  )

// Holds the deferred hand-off until the test has decided where focus is, so a
// real frame cannot fire inside the click's act and race the assertions.
function captureFrames(): { flush: () => void } {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })
  return {
    flush: () =>
      act(() => {
        for (const frame of frames.splice(0)) frame(0)
      })
  }
}

async function closeFromInsideEditor(): Promise<void> {
  const button = editorButton()
  expect(button).toBeDefined()
  button!.focus()
  expect(document.activeElement).toBe(button)
  await act(async () => {
    button!.click()
  })
  // The editor and the focused control in it are gone.
  expect(editorButton()).toBeUndefined()
}

describe('GameRow hands focus to the editor toggle when the editor closes (#957)', () => {
  test('closing from inside the editor lands focus on the gear, not <body>', async () => {
    await render()
    const frames = captureFrames()

    await closeFromInsideEditor()
    expect(document.activeElement).toBe(document.body)

    frames.flush()
    expect(document.activeElement).toBe(gear())
    expect(gear()?.getAttribute('aria-expanded')).toBe('false')
  })

  test('focus that already landed somewhere real is left there', async () => {
    await render()
    const frames = captureFrames()
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)

    try {
      await closeFromInsideEditor()
      // e.g. the sticky bar still up for a dirty Settings scope.
      elsewhere.focus()
      frames.flush()
      expect(document.activeElement).toBe(elsewhere)
    } finally {
      elsewhere.remove()
    }
  })

  test('an inert row (the other view after a tab-switch save) is not focused', async () => {
    await render()
    const frames = captureFrames()

    await closeFromInsideEditor()
    container.setAttribute('inert', '')
    frames.flush()
    expect(document.activeElement).toBe(document.body)
  })
})
