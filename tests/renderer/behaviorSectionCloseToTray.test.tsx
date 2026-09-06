/**
 * A user asked for a "Close to Tray" option without finding the setting that
 * already did it, because its label led with the mechanism ("Minimize to tray
 * on close") rather than the trigger he was scanning for (#891). The label now
 * leads with "close"; the stored key and its handler are unchanged, which is
 * the other half of what this pins.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { BehaviorSection } from '../../src/renderer/src/components/settings/BehaviorSection'
import { BehaviorContext } from '../../src/renderer/src/components/settings/BehaviorContext'

let root: Root | null = null
let container: HTMLElement | null = null

async function renderSection(
  onMinimizeToTrayChange: (checked: boolean) => void
): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container as HTMLElement)
    root.render(
      <BehaviorContext.Provider
        value={{
          startWithWindows: false,
          startMinimized: false,
          minimizeToTray: true,
          showTrayIcon: true,
          gracefulCloseEnabled: true,
          launchDelayMs: 1000,
          onStartWithWindowsChange: vi.fn(),
          onStartMinimizedChange: vi.fn(),
          onMinimizeToTrayChange,
          onShowTrayIconChange: vi.fn(),
          onGracefulCloseEnabledChange: vi.fn(),
          onLaunchDelayMsChange: vi.fn()
        }}
      >
        <BehaviorSection />
      </BehaviorContext.Provider>
    )
  })
  return container
}

function settingsLabels(section: HTMLElement): HTMLLabelElement[] {
  return Array.from(section.querySelectorAll<HTMLLabelElement>('label.settings-label'))
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

describe('BehaviorSection tray-on-close label (#891)', () => {
  test('the setting is found by scanning for "close" and still drives minimizeToTray', async () => {
    const onMinimizeToTrayChange = vi.fn()
    const section = await renderSection(onMinimizeToTrayChange)
    const labels = settingsLabels(section)

    const closeToTray = labels.filter((label) => /^close to tray$/i.test(label.textContent ?? ''))
    expect(closeToTray).toHaveLength(1)
    // The old label was the one line that answered the question and started
    // with the word the user was not looking for.
    expect(labels.some((label) => /^minimize/i.test(label.textContent ?? ''))).toBe(false)

    // Same control behind the new words: the toggle reflects minimizeToTray
    // and reports through its handler.
    const toggle = closeToTray[0].control
    expect(toggle).toBeInstanceOf(HTMLInputElement)
    expect((toggle as HTMLInputElement).checked).toBe(true)
    await act(async () => {
      toggle?.click()
    })
    expect(onMinimizeToTrayChange).toHaveBeenCalledWith(false)
  })
})
