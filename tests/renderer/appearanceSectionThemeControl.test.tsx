/**
 * #735 - the segmented Light/Dark/System control was extracted out of
 * AppearanceSection into the shared ThemeModeControl (mirroring how
 * AccentSwatchRow/ZoomControl were extracted for #641). This is a
 * behavior-preserving refactor: AppearanceSection must still render the Theme
 * row and still call onThemeModeChange when a pill is clicked.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { AppearanceSection } from '../../src/renderer/src/components/settings/AppearanceSection'
import { AppearanceContext } from '../../src/renderer/src/components/settings/AppearanceContext'

function button(container: HTMLElement, name: RegExp): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll('button')).find((element) =>
      name.test(element.textContent ?? '')
    ) as HTMLButtonElement | undefined) ?? null
  )
}

async function renderAppearanceSection(
  onThemeModeChange: (mode: 'light' | 'dark' | 'system') => void
): Promise<{
  container: HTMLElement
  unmount: () => void
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppearanceContext.Provider
        value={{
          accentPreset: '#008c99',
          accentCustom: '',
          accentBgTint: false,
          themeMode: 'dark',
          focusActiveTitle: true,
          zoomFactor: 1,
          isCustomColor: false,
          onAccentChange: vi.fn(),
          onCustomColorChange: vi.fn(),
          onAccentBgTintChange: vi.fn(),
          onThemeModeChange,
          onFocusActiveTitleChange: vi.fn(),
          onZoomFactorChange: vi.fn()
        }}
      >
        <AppearanceSection />
      </AppearanceContext.Provider>
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

describe('AppearanceSection after ThemeModeControl extraction (#735)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('still renders the Theme row and reflects the current mode', async () => {
    const harness = await renderAppearanceSection(vi.fn())
    try {
      const group = harness.container.querySelector('[role="group"][aria-label="Theme"]')
      expect(group).not.toBeNull()
      expect(button(harness.container, /^dark$/i)?.getAttribute('aria-pressed')).toBe('true')
      expect(button(harness.container, /^light$/i)?.getAttribute('aria-pressed')).toBe('false')
    } finally {
      harness.unmount()
    }
  })

  test('still calls onThemeModeChange when a pill is clicked', async () => {
    const onThemeModeChange = vi.fn()
    const harness = await renderAppearanceSection(onThemeModeChange)
    try {
      await act(async () => {
        button(harness.container, /^system$/i)?.click()
      })
      expect(onThemeModeChange).toHaveBeenCalledWith('system')
    } finally {
      harness.unmount()
    }
  })
})
