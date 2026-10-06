/**
 * #951 - the sticky bar's Discard keeps a profile editor open.
 *
 * It used to close it twice over: the editor's discard handler called
 * onClose, and the App-level discard then bumped refreshKey, which remounts
 * GameList and resets its open-editor state. A handler that merely stopped
 * closing would have looked like it did nothing. So the App tells every
 * handler WHY it is discarding (`revert` from the sticky bar, `leave` from a
 * tab switch or the close dialog), and skips the remount on a revert unless
 * Settings has something to revert, since the remount is how Settings
 * reverts.
 *
 * GameList is a stub standing in for a row with a dirty editor: it registers
 * the profile-editor scope the way ProfileEditor does, records the intent it
 * is handed, and counts its mounts, which is how a refreshKey remount shows.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => ({
  profileDirty: true,
  intents: [] as unknown[],
  gameListMounts: 0,
  reportSettingsDirty: null as ((dirty: boolean) => void) | null,
  navigate: null as ((view: 'games' | 'settings') => void) | null
}))

vi.mock('../../src/renderer/src/lib/store', () => ({
  getOnboardingSeen: vi.fn(async () => true),
  setOnboardingSeen: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({ gamePaths: { iracing: 'C:/Sim/iracing.exe' }, zoomFactor: 1 })),
  getMissingGamePaths: vi.fn(async () => []),
  saveSettings: vi.fn(async () => {}),
  onStoreConfigChanged: vi.fn(() => () => {})
}))

vi.mock('../../src/renderer/src/lib/electron', () => ({
  forceClose: vi.fn(async () => {}),
  forceMinimizeToTray: vi.fn(async () => {}),
  getStartupNotice: vi.fn(async () => null),
  getUpdateInfo: vi.fn(async () => null),
  onCloseRequested: vi.fn(() => () => {}),
  onUpdateAvailable: vi.fn(() => () => {}),
  setPendingMinimizeToTray: vi.fn(async () => {}),
  setRendererDirty: vi.fn(async () => {}),
  setZoom: vi.fn(async () => {})
}))

vi.mock('../../src/renderer/src/lib/migrations', () => ({
  runStartupMigrations: vi.fn()
}))

vi.mock('../../src/renderer/src/lib/globalErrors', () => ({
  subscribeGlobalErrors: vi.fn(() => () => {})
}))

vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: vi.fn(), announce: vi.fn() }),
  NotifyProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('../../src/renderer/src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    accentPreset: '#008c99',
    accentCustom: '',
    accentBgTint: false,
    themeMode: 'dark',
    resolvedAccent: '#008c99',
    setAccentPreset: vi.fn(),
    setAccentCustom: vi.fn(),
    setAccentBgTint: vi.fn(),
    setThemeMode: vi.fn(),
    syncThemeFromStore: vi.fn(async () => {})
  })
}))

vi.mock('../../src/renderer/src/components/WindowControls', () => ({
  WindowControls: ({ onNavigate }: { onNavigate: (view: 'games' | 'settings') => void }) => {
    h.navigate = onNavigate
    return null
  }
}))

vi.mock('../../src/renderer/src/components/GameList', async () => {
  const { useEffect } = await import('react')
  const { useAppDirty } = await import('../../src/renderer/src/contexts/AppDirtyContext')
  return {
    GameList: () => {
      const { reportProfileEditorDirty, registerDiscardHandler } = useAppDirty()
      useEffect(() => {
        h.gameListMounts += 1
        reportProfileEditorDirty('iracing:p1', h.profileDirty)
        registerDiscardHandler('profile-editor', (intent) => {
          h.intents.push(intent)
          // The editor reloads the stored profile, which is clean.
          h.profileDirty = false
          reportProfileEditorDirty('iracing:p1', false)
        })
        return () => registerDiscardHandler('profile-editor', null)
      }, [reportProfileEditorDirty, registerDiscardHandler])
      return null
    }
  }
})

// SettingsProvider is the one place App reports Settings dirtiness from, so
// the passthrough hands that reporter to the test.
vi.mock('../../src/renderer/src/components/settings/SettingsContext', () => ({
  SettingsProvider: ({
    children,
    onDirtyChange
  }: {
    children: ReactNode
    onDirtyChange: (dirty: boolean) => void
  }) => {
    h.reportSettingsDirty = onDirtyChange
    return children
  }
}))
vi.mock('../../src/renderer/src/components/SettingsView', () => ({
  SettingsView: () => null
}))

import App from '../../src/renderer/src/App'

let root: Root | null = null
let container: HTMLDivElement

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function renderApp(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<App />)
  })
  await settle()
}

// The sticky bar and the tab-switch dialog both have a "Discard", so a press
// can be scoped to the open dialog.
function button(name: string, scope: ParentNode = document.body): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === name
  )
  if (!found) throw new Error(`No "${name}" button`)
  return found as HTMLButtonElement
}

async function press(name: string, { inDialog = false } = {}): Promise<void> {
  const scope = inDialog ? document.body.querySelector('[role="alertdialog"]') : document.body
  if (!scope) throw new Error('No dialog open')
  await act(async () => {
    button(name, scope).click()
  })
  await settle()
}

beforeEach(() => {
  h.profileDirty = true
  h.intents = []
  h.gameListMounts = 0
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('App discards say why, and a revert keeps the editor (#951)', () => {
  test('sticky Discard with only a profile dirty reverts it in place: no remount', async () => {
    await renderApp()
    expect(h.gameListMounts).toBe(1)

    await press('Discard')
    await press('Discard Changes', { inDialog: true })

    expect(h.intents).toEqual(['revert'])
    // The remount is what closed the editor even after the handler stopped
    // closing it (the comment on #951).
    expect(h.gameListMounts).toBe(1)
  })

  test('sticky Discard with Settings dirty too still remounts, which is how Settings reverts', async () => {
    await renderApp()
    await act(async () => {
      h.reportSettingsDirty!(true)
    })

    await press('Discard')
    await press('Discard Changes', { inDialog: true })

    expect(h.intents).toEqual(['revert'])
    expect(h.gameListMounts).toBe(2)
  })

  test('a discard on the way out (tab switch) is a leave, and remounts as before', async () => {
    await renderApp()
    await act(async () => {
      h.navigate!('settings')
    })
    await settle()

    await press('Discard', { inDialog: true })

    expect(h.intents).toEqual(['leave'])
    expect(h.gameListMounts).toBe(2)
  })
})
