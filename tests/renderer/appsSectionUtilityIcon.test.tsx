/**
 * Regression test for #652 (Track Titan built-in companion / bundled icon)
 * and #727 (bundled-first precedence flip). AppsSection has three icon
 * tiers: a built-in's bundled curated icon (utilityIcons), the shell icon
 * extracted from the user's configured exe (appIcons), or an initials
 * placeholder.
 *
 * Since #727, for a built-in that declares a bundled icon, the bundled asset
 * wins even when a shell icon is ALSO available — shell extraction is
 * unreliable across app versions/icon formats and can "succeed" with a
 * broken image (e.g. Crew Chief's black-square alpha artifact), which
 * shell-first would keep forever once cached. Built-ins without a bundled
 * asset (e.g. Second Monitor) and custom app slots never populate
 * utilityIcons, so they fall through unchanged to shell → initials.
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

const UTILITIES: Utility[] = [
  { key: 'tracktitan', name: 'Track Titan' },
  { key: 'secondmonitor', name: 'Second Monitor' },
  { key: 'customapp1', name: 'Custom App 1', isCustom: true }
]

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

// Utility rows render as sibling divs in `utilities` order (see UTILITIES
// above); the trailing "Add slot" control is not a row. Scoping queries per
// row is required once more than one utility is rendered per test.
function getRowIcon(rowIndex: number): HTMLImageElement | null {
  const row = container.children[rowIndex]
  return row.querySelector('img[alt="Icon"]')
}

function getRowText(rowIndex: number): string {
  return container.children[rowIndex].textContent || ''
}

describe('AppsSection utility icon precedence (#652, bundled-first flip #727)', () => {
  test('built-in with a bundled icon uses it even when shell extraction also returns a usable icon', async () => {
    await renderAppsSection(
      buildContextValue({
        appIcons: { tracktitan: 'data:image/png;base64,SHELL' },
        utilityIcons: { tracktitan: 'data:image/png;base64,BUNDLED' }
      })
    )

    const img = getRowIcon(0)
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,BUNDLED')
  })

  test('built-in with a bundled icon uses it when shell extraction returned nothing', async () => {
    await renderAppsSection(
      buildContextValue({
        utilityIcons: { tracktitan: 'data:image/png;base64,BUNDLED' }
      })
    )

    const img = getRowIcon(0)
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,BUNDLED')
  })

  test('built-in without a bundled icon (secondmonitor) still uses the shell icon', async () => {
    await renderAppsSection(
      buildContextValue({
        appIcons: { secondmonitor: 'data:image/png;base64,SHELL' }
      })
    )

    const img = getRowIcon(1)
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,SHELL')
  })

  test('custom app slots are unchanged: shell icon wins, no bundled tier applies', async () => {
    await renderAppsSection(
      buildContextValue({
        appIcons: { customapp1: 'data:image/png;base64,SHELL' }
      })
    )

    const img = getRowIcon(2)
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,SHELL')
  })

  test('falls back to the initials placeholder when neither icon source is available', async () => {
    await renderAppsSection(buildContextValue({}))

    expect(getRowIcon(0)).toBeNull()
    expect(getRowText(0)).toContain('TT')
  })
})
