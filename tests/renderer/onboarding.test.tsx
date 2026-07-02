/**
 * #641 - first-run onboarding gate + actions.
 *
 * The modal shows only for a brand-new user (onboarding not seen AND no game
 * configured), sets the local-only onboardingSeen flag on Skip or Set up, and
 * Set up hands off to Settings -> Games via the deep-link target. Existing users
 * (a game already configured) are never onboarded - the zero-games half of the
 * gate is false for them, so no backfill migration is needed. Escape = Skip.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => ({
  onboardingSeen: false as boolean,
  gamePaths: {} as Record<string, string>,
  persistOnboardingSeen: vi.fn(async () => {}),
  settingsTarget: { current: undefined as string | null | undefined }
}))

vi.mock('../../src/renderer/src/lib/store', () => ({
  getOnboardingSeen: vi.fn(async () => h.onboardingSeen),
  setOnboardingSeen: h.persistOnboardingSeen,
  getSettings: vi.fn(async () => ({ gamePaths: h.gamePaths, zoomFactor: 1 })),
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

// Heavy children that touch their own contexts/IPC are rendered as null; the
// SettingsView mock records the deep-link target so the Set-up hand-off is
// observable.
vi.mock('../../src/renderer/src/components/WindowControls', () => ({
  WindowControls: () => null
}))
vi.mock('../../src/renderer/src/components/GameList', () => ({
  GameList: () => null
}))
vi.mock('../../src/renderer/src/components/StickySaveBar', () => ({
  StickySaveBar: () => null
}))
vi.mock('../../src/renderer/src/components/settings/SettingsContext', () => ({
  SettingsProvider: ({ children }: { children: ReactNode }) => children
}))
vi.mock('../../src/renderer/src/components/SettingsView', () => ({
  SettingsView: (props: { targetSection: string | null }) => {
    h.settingsTarget.current = props.targetSection
    return null
  }
}))

import App from '../../src/renderer/src/App'
import { GAMES } from '../../src/renderer/src/lib/config'

async function renderApp(): Promise<{ unmount: () => void }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(<App />)
  })
  // Let the mount effects' async reads (getOnboardingSeen / getSettings) and
  // their state updates settle before asserting.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return {
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    }
  }
}

function modalHeading(): HTMLElement | null {
  // The heading renders the brand wordmark (decorative SVG) with the accessible
  // name carried by aria-label, so match on that rather than text content.
  return document.body.querySelector('h2[aria-label="Welcome to SimLauncher"]')
}

function button(name: RegExp): HTMLButtonElement | null {
  return (
    (Array.from(document.body.querySelectorAll('button')).find((element) =>
      name.test(element.textContent ?? '')
    ) as HTMLButtonElement | undefined) ?? null
  )
}

describe('First-run onboarding (#641)', () => {
  beforeEach(() => {
    h.onboardingSeen = false
    h.gamePaths = {}
    h.persistOnboardingSeen.mockClear()
    h.settingsTarget.current = undefined
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('shows for a brand-new user, focused on the primary CTA', async () => {
    const harness = await renderApp()
    try {
      expect(modalHeading()).not.toBeNull()
      expect(document.activeElement).toBe(button(/set up your sims/i))
    } finally {
      harness.unmount()
    }
  })

  test('hidden once onboarding has been seen', async () => {
    h.onboardingSeen = true
    const harness = await renderApp()
    try {
      expect(modalHeading()).toBeNull()
    } finally {
      harness.unmount()
    }
  })

  test('hidden when a game is already configured (existing user, no migration)', async () => {
    h.gamePaths = { [GAMES[0].key]: 'C:/Sim/sim.exe' }
    const harness = await renderApp()
    try {
      expect(modalHeading()).toBeNull()
    } finally {
      harness.unmount()
    }
  })

  test('Skip sets the seen flag and dismisses', async () => {
    const harness = await renderApp()
    try {
      await act(async () => {
        button(/^skip$/i)?.click()
      })
      expect(h.persistOnboardingSeen).toHaveBeenCalledWith(true)
      expect(modalHeading()).toBeNull()
    } finally {
      harness.unmount()
    }
  })

  test('Set up sets the seen flag and hands off to Settings -> Games', async () => {
    const harness = await renderApp()
    try {
      await act(async () => {
        button(/set up your sims/i)?.click()
      })
      expect(h.persistOnboardingSeen).toHaveBeenCalledWith(true)
      expect(h.settingsTarget.current).toBe('games')
      expect(modalHeading()).toBeNull()
    } finally {
      harness.unmount()
    }
  })

  test('Escape skips (sets the seen flag and dismisses)', async () => {
    const harness = await renderApp()
    try {
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(h.persistOnboardingSeen).toHaveBeenCalledWith(true)
      expect(modalHeading()).toBeNull()
    } finally {
      harness.unmount()
    }
  })
})
