/**
 * #642 / #583 — Settings deep-link auto-expand.
 *
 * When SettingsView receives a `targetSection` (e.g. from the "Configure Games"
 * CTA, or later onboarding), that section opens (aria-expanded=true) and, once
 * its expand transition has settled, scrolls to the top, then the target is
 * consumed so re-requesting the same section re-fires. A null target leaves the
 * default collapse state untouched (no regression for a plain gear-icon open).
 * Games is collapsed by default, so it is the meaningful section to assert
 * against. The scroll is deferred ~one expand-transition (a previously collapsed
 * section has no height yet), so it is asserted after a short wait.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const notifyMock = vi.fn()
const announceMock = vi.fn()
const scrollIntoViewMock = vi.fn()

// Capture the originals so each test can restore the shared DOM globals it stubs.
const originalScrollIntoView = Element.prototype.scrollIntoView
const originalMatchMedia = window.matchMedia

vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: notifyMock, announce: announceMock }),
  NotifyProvider: ({ children }: { children: ReactNode }) => children
}))

// The update hook touches electron IPC on mount; stub it to a static shape so
// the test renders SettingsView without a real preload bridge.
vi.mock('../../src/renderer/src/components/settings/useUpdateStatus', () => ({
  useUpdateStatus: () => ({
    appVersion: '1.0.1',
    checkingUpdate: false,
    installingUpdate: false,
    updateProgress: null,
    updateStatus: null,
    handleManualCheck: vi.fn(),
    handleInstallUpdate: vi.fn()
  })
}))

// The section bodies pull in their own contexts/electron. We only exercise the
// accordion shells (the real SettingsSection), so render the bodies as null.
vi.mock('../../src/renderer/src/components/settings/AboutSection', () => ({
  AboutSection: () => null
}))
vi.mock('../../src/renderer/src/components/settings/AppearanceSection', () => ({
  AppearanceSection: () => null
}))
vi.mock('../../src/renderer/src/components/settings/AppsSection', () => ({
  AppsSection: () => null
}))
vi.mock('../../src/renderer/src/components/settings/BehaviorSection', () => ({
  BehaviorSection: () => null
}))
vi.mock('../../src/renderer/src/components/settings/ConfigSection', () => ({
  ConfigSection: () => null
}))
vi.mock('../../src/renderer/src/components/settings/GamesSection', () => ({
  GamesSection: () => null
}))

import { SettingsView } from '../../src/renderer/src/components/SettingsView'
import {
  SettingsMetaContext,
  type SettingsMetaContextValue
} from '../../src/renderer/src/components/settings/SettingsMetaContext'
import { AppDirtyProvider } from '../../src/renderer/src/contexts/AppDirtyContext'
import type { SettingsSectionKey } from '../../src/renderer/src/components/settings/types'

const metaValue: SettingsMetaContextValue = {
  loading: false,
  isDirty: false,
  dirtySections: { appearance: false, behavior: false, games: false, apps: false, about: false },
  saveSettings: vi.fn(async () => true),
  exportingConfig: false,
  importingConfig: false,
  autoCheckUpdates: false,
  onExportConfig: vi.fn(),
  onImportConfig: vi.fn(),
  onAutoCheckUpdatesChange: vi.fn()
}

async function renderSettings(
  targetSection: SettingsSectionKey | null,
  onTargetConsumed: () => void = vi.fn()
): Promise<{ container: HTMLElement; unmount: () => void }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppDirtyProvider>
        <SettingsMetaContext.Provider value={metaValue}>
          <SettingsView
            onClose={() => {}}
            updateInfo={null}
            targetSection={targetSection}
            onTargetConsumed={onTargetConsumed}
          />
        </SettingsMetaContext.Provider>
      </AppDirtyProvider>
    )
  })
  return {
    container,
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    }
  }
}

function sectionButton(container: HTMLElement, key: SettingsSectionKey): HTMLButtonElement {
  const button = container.querySelector(`[data-section="${key}"] button`)
  if (!button) throw new Error(`No disclosure button for section "${key}"`)
  return button as HTMLButtonElement
}

// Wait out the deferred scroll (SettingsView delays it ~one 300ms transition).
async function flushDeferredScroll() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 360))
  })
}

function stubMatchMedia(reduceMotion: boolean) {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: reduceMotion }) as unknown as typeof window.matchMedia
}

describe('Settings deep-link auto-expand (#642 / #583)', () => {
  beforeEach(() => {
    notifyMock.mockClear()
    scrollIntoViewMock.mockClear()
    Element.prototype.scrollIntoView = scrollIntoViewMock
    stubMatchMedia(false)
  })

  afterEach(() => {
    // Restore the shared DOM globals so these stubs don't leak into other specs.
    Element.prototype.scrollIntoView = originalScrollIntoView
    window.matchMedia = originalMatchMedia
  })

  test('a targetSection opens that section, smooth-scrolls it in, then consumes the target', async () => {
    const onConsumed = vi.fn()
    const harness = await renderSettings('games', onConsumed)
    try {
      // Games is collapsed by default — the deep-link opens it right away.
      expect(sectionButton(harness.container, 'games').getAttribute('aria-expanded')).toBe('true')
      // The scroll is deferred until the expand transition has settled.
      expect(scrollIntoViewMock).not.toHaveBeenCalled()
      await flushDeferredScroll()
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1)
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
      expect(onConsumed).toHaveBeenCalledTimes(1)
    } finally {
      harness.unmount()
    }
  })

  test('prefers-reduced-motion uses an instant (auto) scroll', async () => {
    stubMatchMedia(true)
    const harness = await renderSettings('games')
    try {
      await flushDeferredScroll()
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    } finally {
      harness.unmount()
    }
  })

  test('no target leaves Games collapsed and never scrolls (direct gear open)', async () => {
    const onConsumed = vi.fn()
    const harness = await renderSettings(null, onConsumed)
    try {
      expect(sectionButton(harness.container, 'games').getAttribute('aria-expanded')).toBe('false')
      await flushDeferredScroll()
      expect(scrollIntoViewMock).not.toHaveBeenCalled()
      expect(onConsumed).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })
})
