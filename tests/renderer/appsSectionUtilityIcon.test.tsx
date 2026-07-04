/**
 * Regression test for #652 (Track Titan built-in companion / bundled icon
 * fallback). AppsSection previously only had two icon tiers: the shell icon
 * extracted from the user's configured exe, or an initials placeholder. Some
 * built-ins now ship a bundled icon asset (utilityIcons) that renders as a
 * middle tier when the shell icon lookup comes back empty — e.g. Track
 * Titan's tray Datalogger, whose exe carries no usable shell icon resource.
 */

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  AppsContext,
  type AppsContextValue
} from '../../src/renderer/src/components/settings/AppsContext'
import { AppsSection } from '../../src/renderer/src/components/settings/AppsSection'
import type { Utility } from '../../src/renderer/src/lib/config'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const UTILITIES: Utility[] = [{ key: 'tracktitan', name: 'Track Titan' }]

function buildContextValue(overrides: Partial<AppsContextValue>): AppsContextValue {
  return {
    appPaths: {},
    appNames: {},
    appArgs: {},
    appIcons: {},
    utilityIcons: {},
    iconLoadErrors: new Set(),
    customSlots: 1,
    utilities: UTILITIES,
    profiles: {},
    onBrowse: vi.fn(),
    onAppNameChange: vi.fn(),
    onAppPathChange: vi.fn(),
    onAppArgsChange: vi.fn(),
    onIconLoadError: vi.fn(),
    onAddCustomSlot: vi.fn(),
    onRemoveCustomSlot: vi.fn(),
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root | null = null

async function renderAppsSection(value: AppsContextValue): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AppsContext.Provider value={value}>
        <AppsSection />
      </AppsContext.Provider>
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('AppsSection utility icon fallback tiers (#652)', () => {
  test('falls back to the bundled utility icon when no shell icon was extracted', async () => {
    await renderAppsSection(
      buildContextValue({
        utilityIcons: { tracktitan: 'data:image/png;base64,BUNDLED' }
      })
    )

    const img = container.querySelector('img[alt="Icon"]') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,BUNDLED')
  })

  test('shell-extracted icon still takes priority over the bundled fallback', async () => {
    await renderAppsSection(
      buildContextValue({
        appIcons: { tracktitan: 'data:image/png;base64,SHELL' },
        utilityIcons: { tracktitan: 'data:image/png;base64,BUNDLED' }
      })
    )

    const img = container.querySelector('img[alt="Icon"]') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,SHELL')
  })

  test('falls back to the initials placeholder when neither icon source is available', async () => {
    await renderAppsSection(buildContextValue({}))

    const img = container.querySelector('img[alt="Icon"]')
    expect(img).toBeNull()
    expect(container.textContent).toContain('TT')
  })
})
