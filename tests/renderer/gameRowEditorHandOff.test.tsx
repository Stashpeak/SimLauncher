/**
 * How GameRow's profile editor goes away from inside, and where focus lands
 * (useEditorHandOff).
 *
 * #957: every route that closes the editor from inside it (Save on the sticky
 * bar or in the card, Cancel, Escape, a confirm dialog, Delete) unmounts the
 * control that had focus, and nothing put focus anywhere, so the next Tab
 * restarted at the titlebar. All of them end in the editor's `onClose`.
 *
 * #951: the sticky bar's Discard keeps the editor open. Its discard handler
 * calls `onReverted` instead, the row remounts the editor so it reloads the
 * stored profile, and the bar, which had focus, unmounts once the edits are
 * gone.
 *
 * So the editor is stubbed here: a button that calls `onClose`, plus the dirty
 * report, save handler and discard handler the real editor registers with
 * AppDirtyContext, because the sticky bar's own lifetime hangs off that
 * report. It counts its mounts, which is how a revert's remount shows.
 *
 * The target is the row's editor toggle (the gear), the one control that
 * outlives both and where the gear-X route already leaves focus.
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

const stub = vi.hoisted(() => ({ dirty: false, mounts: 0 }))

vi.mock('../../src/renderer/src/components/ProfileEditor', async () => {
  const { useEffect: useStubEffect } = await import('react')
  const { useAppDirty: useStubAppDirty } =
    await import('../../src/renderer/src/contexts/AppDirtyContext')
  return {
    ProfileEditor: ({
      gameKey,
      activeProfileId,
      onClose,
      onReverted
    }: {
      gameKey: string
      activeProfileId: string
      onClose: () => void
      onReverted?: () => void
    }) => {
      const { reportProfileEditorDirty, registerSaveHandler, registerDiscardHandler } =
        useStubAppDirty()
      const scopeId = `${gameKey}:${activeProfileId}`
      useStubEffect(() => {
        stub.mounts += 1
      }, [])
      // Same shape as ProfileEditor.tsx: the report is retracted in the
      // unmount cleanup, one commit after the close itself.
      useStubEffect(() => {
        reportProfileEditorDirty(scopeId, stub.dirty)
        return () => reportProfileEditorDirty(scopeId, false)
      }, [scopeId, reportProfileEditorDirty])
      // Same branching as ProfileEditor.tsx's discard handler. The stored
      // profile a remount reloads is clean.
      useStubEffect(() => {
        if (!stub.dirty) return
        registerDiscardHandler('profile-editor', (intent) => {
          stub.dirty = false
          if (intent === 'revert') onReverted?.()
          else onClose()
        })
        return () => registerDiscardHandler('profile-editor', null)
      }, [registerDiscardHandler, onClose, onReverted])
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

type SettingsScope = 'clean' | 'stays-dirty' | 'saves-clean'

// A dirty Settings scope next to the editor. requestSaveAll saves the profile
// first and Settings second, so the bar outlives the editor either way:
// 'stays-dirty' keeps it up (focus must stay on it), 'saves-clean' retracts
// its report after an await and so removes the bar one save later.
function DirtySettings({ scope }: { scope: SettingsScope }): ReactNode {
  const { reportSettingsDirty, registerSaveHandler } = useAppDirty()
  useEffect(() => {
    reportSettingsDirty(true)
    registerSaveHandler('settings', async () => {
      await Promise.resolve()
      if (scope === 'saves-clean') reportSettingsDirty(false)
      return true
    })
  }, [reportSettingsDirty, registerSaveHandler, scope])
  return null
}

// Lets a test report another game's editor as dirty, the way a second row's
// ProfileEditor would.
let dirtyContext: ReturnType<typeof useAppDirty> | null = null
function CaptureDirty(): ReactNode {
  dirtyContext = useAppDirty()
  return null
}

// Owns isActive the way GameList does, so closing really unmounts the editor.
function Harness({ settings }: { settings: SettingsScope }): ReactNode {
  const [isActive, setIsActive] = useState(true)
  return (
    <AppDirtyProvider>
      <CaptureDirty />
      {settings !== 'clean' && <DirtySettings scope={settings} />}
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
      {/* Stands in for App's discard confirm: Discard Changes is a revert. */}
      <StickySaveBar onRequestDiscard={() => void dirtyContext!.requestDiscardAll('revert')} />
    </AppDirtyProvider>
  )
}

let container: HTMLDivElement
let root: Root | null = null

async function render({
  dirty = false,
  settings = 'clean'
}: { dirty?: boolean; settings?: SettingsScope } = {}): Promise<void> {
  stub.dirty = dirty
  stub.mounts = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<Harness settings={settings} />)
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

  // CodeRabbit on PR #1015: the editor's report is retracted while the bar is
  // still up for Settings, with focus on its Save; the bar then leaves when
  // the Settings save lands, and nothing re-ran the hand-off.
  test('with Settings dirty too, focus reaches the gear once the Settings save removes the bar', async () => {
    await render({ dirty: true, settings: 'saves-clean' })

    await pressFocused(buttonNamed('Save Changes'))

    expect(buttonNamed('Save Profile')).toBeUndefined()
    expect(buttonNamed('Save Changes')).toBeUndefined()
    expect(document.activeElement).toBe(gear())
  })

  test('when the bar stays up for a dirty Settings scope, focus stays on its Save', async () => {
    await render({ dirty: true, settings: 'stays-dirty' })

    await pressFocused(buttonNamed('Save Changes'))

    expect(buttonNamed('Save Profile')).toBeUndefined()
    const barSave = buttonNamed('Save Changes')
    expect(barSave).toBeDefined()
    expect(document.activeElement).toBe(barSave)
  })

  // The flip side of waiting on the bar: a hand-off left waiting (here the
  // Settings scope stays dirty) must not fire much later, at another row's
  // close, once the user has moved on to a different game's editor.
  test('a waiting hand-off is dropped once another game starts editing', async () => {
    await render({ dirty: true, settings: 'stays-dirty' })
    await pressFocused(buttonNamed('Save Changes'))
    expect(document.activeElement).toBe(buttonNamed('Save Changes'))

    await act(async () => {
      dirtyContext!.reportProfileEditorDirty('acc:default', true)
    })
    ;(document.activeElement as HTMLElement).blur()
    await act(async () => {
      dirtyContext!.reportProfileEditorDirty('acc:default', false)
    })

    expect(document.activeElement).toBe(document.body)
  })

  test('focus that is somewhere real when the editor closes is left there', async () => {
    await render()
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    try {
      elsewhere.focus()
      // click() does not move focus, so the close happens with focus outside.
      await act(async () => {
        buttonNamed('Save Profile')!.click()
      })
      expect(buttonNamed('Save Profile')).toBeUndefined()
      expect(document.activeElement).toBe(elsewhere)
    } finally {
      elsewhere.remove()
    }
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

describe('GameRow keeps the editor open through a sticky-bar Discard (#951)', () => {
  test('Discard reverts the editor in place: still open, reloaded, focus on the gear', async () => {
    await render({ dirty: true })
    expect(stub.mounts).toBe(1)

    await pressFocused(buttonNamed('Discard'))

    // Still open, and remounted so it reloads the stored profile.
    expect(buttonNamed('Save Profile')).toBeDefined()
    expect(stub.mounts).toBe(2)
    expect(gear()?.getAttribute('aria-expanded')).toBe('true')
    // The bar that had focus is gone with the edits; focus is on the gear,
    // directly above the editor, not on <body>.
    expect(buttonNamed('Discard')).toBeUndefined()
    expect(document.activeElement).toBe(gear())
  })

  test('a revert hand-off left waiting is dropped if the editor then closes another way', async () => {
    await render({ dirty: true, settings: 'stays-dirty' })

    await pressFocused(buttonNamed('Discard'))
    // Settings keeps the bar up, so focus stays on its Discard and the
    // hand-off waits for the bar.
    expect(document.activeElement).toBe(buttonNamed('Discard'))

    // The editor is collapsed by the gear (not through onClose), then the bar
    // leaves: the revert's hand-off belongs to an editor that is gone.
    await act(async () => {
      gear()!.click()
    })
    expect(buttonNamed('Save Profile')).toBeUndefined()
    await act(async () => {
      dirtyContext!.reportSettingsDirty(false)
    })

    expect(document.activeElement).toBe(document.body)
  })
})

describe('GameRow scrolls an opened editor below the window header (#1039)', () => {
  // Opening an editor scrolls its row to the top of the view, and the window
  // header is drawn over that edge, so without a top scroll margin the row
  // ended up hidden under it. scroll-mt-18 (72px: the view's pt-16 plus the
  // list's py-2) stops the scroll where the first row sits at rest, so the
  // first row does not move and the others stop below the header. jsdom does
  // no layout, so what is pinned is the pair: the row is what gets scrolled,
  // and it carries that margin; the positions are measured on the build.
  test('the row that is scrolled to on opening keeps a top scroll margin', async () => {
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      await render()
      await act(async () => gear()!.click())
      expect(gear()?.getAttribute('aria-expanded')).toBe('false')
      await act(async () => gear()!.click())
      // handleToggle defers the scroll one tick past the expand transition start.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80))
      })

      const row = container.querySelector('[role="listitem"]')
      expect(scrolled).toContain(row)
      expect(row?.classList.contains('scroll-mt-18')).toBe(true)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})
