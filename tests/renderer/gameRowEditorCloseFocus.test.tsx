/**
 * Regression test for #957, second mechanism: every route that closes the
 * profile editor from inside it (Save on the sticky bar or in the card,
 * Cancel, Escape, a confirm dialog, Delete) unmounts the control that had
 * focus, and nothing put focus anywhere, so the next Tab restarted at the
 * titlebar. All of them end in the editor's `onClose`, so the editor is
 * stubbed here: a button that calls it, plus the dirty report and save
 * handler the real editor registers with AppDirtyContext, because the sticky
 * bar's own lifetime hangs off that report.
 *
 * The target is the row's editor toggle (the gear), the one control that
 * outlives the close and where the gear-X route already leaves focus.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, useEffect, useState, type ReactNode } from 'react'
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

const stub = vi.hoisted(() => ({ dirty: false }))

vi.mock('../../src/renderer/src/components/ProfileEditor', async () => {
  const { useEffect: useStubEffect } = await import('react')
  const { useAppDirty: useStubAppDirty } =
    await import('../../src/renderer/src/contexts/AppDirtyContext')
  return {
    ProfileEditor: ({
      gameKey,
      activeProfileId,
      onClose
    }: {
      gameKey: string
      activeProfileId: string
      onClose: () => void
    }) => {
      const { reportProfileEditorDirty, registerSaveHandler } = useStubAppDirty()
      const scopeId = `${gameKey}:${activeProfileId}`
      // Same shape as ProfileEditor.tsx: the report is retracted in the
      // unmount cleanup, one commit after the close itself.
      useStubEffect(() => {
        reportProfileEditorDirty(scopeId, stub.dirty)
        return () => reportProfileEditorDirty(scopeId, false)
      }, [scopeId, reportProfileEditorDirty])
      // Like handleSave: the store write is awaited, then the editor closes.
      useStubEffect(() => {
        if (!stub.dirty) return
        registerSaveHandler('profile-editor', async () => {
          await Promise.resolve()
          onClose()
          return true
        })
        return () => registerSaveHandler('profile-editor', null)
      }, [registerSaveHandler, onClose])
      return (
        <button type="button" onClick={onClose}>
          Save Profile
        </button>
      )
    }
  }
})

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

import { GameRow } from '../../src/renderer/src/components/game-list/GameRow'
import { StickySaveBar } from '../../src/renderer/src/components/StickySaveBar'
import { AppDirtyProvider, useAppDirty } from '../../src/renderer/src/contexts/AppDirtyContext'
import type { Game } from '../../src/renderer/src/lib/config'

const GAME: Game = { key: 'ac', name: 'Assetto Corsa', icon: 'assets/ac.png' }

// A Settings scope that stays dirty through a save, so the bar outlives the
// editor: the case where focus must stay on the bar.
function StillDirtySettings(): ReactNode {
  const { reportSettingsDirty, registerSaveHandler } = useAppDirty()
  useEffect(() => {
    reportSettingsDirty(true)
    registerSaveHandler('settings', () => true)
  }, [reportSettingsDirty, registerSaveHandler])
  return null
}

// Owns isActive the way GameList does, so closing really unmounts the editor.
function Harness({ settingsDirty }: { settingsDirty: boolean }): ReactNode {
  const [isActive, setIsActive] = useState(true)
  return (
    <AppDirtyProvider>
      {settingsDirty && <StillDirtySettings />}
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
      <StickySaveBar onRequestDiscard={vi.fn()} />
    </AppDirtyProvider>
  )
}

let container: HTMLDivElement
let root: Root | null = null

async function render({ dirty = false, settingsDirty = false } = {}): Promise<void> {
  stub.dirty = dirty
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<Harness settingsDirty={settingsDirty} />)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

const gear = () =>
  container.querySelector<HTMLButtonElement>('button[aria-controls="profile-editor-ac"]')

const buttonNamed = (name: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === name
  )

async function pressFocused(button: HTMLButtonElement | undefined): Promise<void> {
  expect(button).toBeDefined()
  button!.focus()
  expect(document.activeElement).toBe(button)
  await act(async () => {
    button!.click()
  })
}

describe('GameRow hands focus to the editor toggle when the editor closes (#957)', () => {
  test('closing from inside the editor lands focus on the gear, not <body>', async () => {
    await render()

    await pressFocused(buttonNamed('Save Profile'))

    expect(buttonNamed('Save Profile')).toBeUndefined()
    expect(document.activeElement).toBe(gear())
    expect(gear()?.getAttribute('aria-expanded')).toBe('false')
  })

  // The ordering a frame-based hand-off lost on a packaged build: the save
  // resolves after an await, the editor closes, and the bar holding focus
  // only unmounts one commit later, when the editor's dirty report is
  // retracted.
  test('Save on the sticky bar lands focus on the gear once the bar is gone', async () => {
    await render({ dirty: true })

    await pressFocused(buttonNamed('Save Changes'))

    expect(buttonNamed('Save Profile')).toBeUndefined()
    expect(buttonNamed('Save Changes')).toBeUndefined()
    expect(document.activeElement).toBe(gear())
  })

  test('when the bar stays up for a dirty Settings scope, focus stays on its Save', async () => {
    await render({ dirty: true, settingsDirty: true })

    await pressFocused(buttonNamed('Save Changes'))

    expect(buttonNamed('Save Profile')).toBeUndefined()
    const barSave = buttonNamed('Save Changes')
    expect(barSave).toBeDefined()
    expect(document.activeElement).toBe(barSave)
  })

  test('an inert row (the other view after a tab-switch save) is not focused', async () => {
    await render()
    const button = buttonNamed('Save Profile')
    button!.focus()
    container.setAttribute('inert', '')

    await act(async () => {
      button!.click()
    })

    expect(document.activeElement).toBe(document.body)
  })
})
