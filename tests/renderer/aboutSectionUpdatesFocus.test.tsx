import { describe, expect, test, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../src/renderer/src/lib/electron', () => ({
  openLogsFolder: vi.fn(),
  openExternalUrl: vi.fn(),
  onAppLaunchError: vi.fn().mockReturnValue(vi.fn()),
  onGameLaunchError: vi.fn().mockReturnValue(vi.fn()),
  onProfileLaunchError: vi.fn().mockReturnValue(vi.fn()),
  onProcessNameMismatchWarning: vi.fn().mockReturnValue(vi.fn()),
  onStrandedConsentPrompts: vi.fn().mockReturnValue(vi.fn()),
}))

import { AboutSection } from '../../src/renderer/src/components/settings/AboutSection'
import { SettingsMetaContext } from '../../src/renderer/src/components/settings/SettingsMetaContext'

// Same jsdom-safety stub as in closeConfirmSave.test.tsx: skip rendering the real toast portal.
const notifyMock = vi.fn()
vi.mock('../../src/renderer/src/components/Notify', () => {
  return {
    useNotify: () => ({ notify: notifyMock }),
    NotifyProvider: ({ children }: { children: React.ReactNode }) => children
  }
})

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let container: HTMLDivElement
let root: Root | null = null

const defaultContext = {
  loading: false,
  isDirty: false,
  dirtySections: { appearance: false, behavior: false, games: false, apps: false, about: false },
  saveSettings: vi.fn().mockResolvedValue(true),
  exportingConfig: false,
  importingConfig: false,
  autoCheckUpdates: false,
  onExportConfig: vi.fn(),
  onImportConfig: vi.fn(),
  onAutoCheckUpdatesChange: vi.fn()
}

async function renderAboutSection(props: Partial<React.ComponentProps<typeof AboutSection>> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <SettingsMetaContext.Provider value={defaultContext}>
        <AboutSection
          appVersion="1.0.0"
          updateInfo={null}
          checkingUpdate={false}
          installingUpdate={false}
          updateProgress={null}
          updateStatus="up-to-date"
          onManualCheck={vi.fn()}
          onInstallUpdate={vi.fn()}
          {...props}
        />
      </SettingsMetaContext.Provider>
    )
  })
}

beforeEach(() => {
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('AboutSection Check for Updates focus (#1011)', () => {
  test('Check for Updates is aria-disabled while checking', async () => {
    await renderAboutSection({ checkingUpdate: true })
    const buttons = Array.from(container.querySelectorAll('button'))
    const btn = buttons.find(b => b.textContent?.includes('Checking for updates'))
    expect(btn).not.toBeUndefined()
    expect(btn!.hasAttribute('disabled')).toBe(false)
    expect(btn!.getAttribute('aria-disabled')).toBe('true')
  })

  test('Check for Updates does not invoke handler when checking', async () => {
    const onManualCheck = vi.fn()
    await renderAboutSection({ checkingUpdate: true, onManualCheck })
    const buttons = Array.from(container.querySelectorAll('button'))
    const btn = buttons.find(b => b.textContent?.includes('Checking for updates'))
    expect(btn).not.toBeUndefined()

    await act(async () => {
      btn!.click()
    })

    expect(onManualCheck).not.toHaveBeenCalled()
  })

  test('Download & Install is aria-disabled while installing', async () => {
    await renderAboutSection({ updateInfo: { version: '1.1.0' }, installingUpdate: true })
    const buttons = Array.from(container.querySelectorAll('button'))
    const btn = buttons.find(b => b.textContent?.includes('Preparing update'))
    expect(btn).not.toBeUndefined()
    expect(btn!.hasAttribute('disabled')).toBe(false)
    expect(btn!.getAttribute('aria-disabled')).toBe('true')
  })

  test('Download & Install does not invoke handler when installing', async () => {
    const onInstallUpdate = vi.fn()
    await renderAboutSection({ updateInfo: { version: '1.1.0' }, installingUpdate: true, onInstallUpdate })
    const buttons = Array.from(container.querySelectorAll('button'))
    const btn = buttons.find(b => b.textContent?.includes('Preparing update'))
    expect(btn).not.toBeUndefined()

    await act(async () => {
      btn!.click()
    })

    expect(onInstallUpdate).not.toHaveBeenCalled()
  })
})
