/**
 * Regression test for #727 (bundled-first curated icons) on the profile
 * editor's "Utilities to launch" list — the third utility-icon surface,
 * missed by the first #727 pass (which covered AppsSection and the GameList
 * running strip). ProfileUtilitiesSection resolves icons in the same
 * three-tier order as those surfaces: a built-in's bundled curated icon
 * (utilityIcons) first, the shell icon extracted from the configured exe
 * (appIconCache) as fallback, initials last. A bundled data URI that fails
 * to decode is recorded in failedIcons under the namespaced
 * getBundledIconErrorKey key so the render falls through to the shell tier
 * (mirrors the AppsSection onError approach from #728).
 */

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ProfileUtilitiesSection } from '../../src/renderer/src/components/profile-editor/ProfileUtilitiesSection'
import type { ProfileUtility, Utility } from '../../src/renderer/src/lib/config'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const UTILITIES: Utility[] = [
  { key: 'tracktitan', name: 'Track Titan', icon: 'assets/tracktitan.png' },
  { key: 'secondmonitor', name: 'Second Monitor' },
  { key: 'customapp1', name: 'Custom App 1', isCustom: true }
]

const ENTRIES: ProfileUtility[] = UTILITIES.map((utility) => ({
  id: utility.key,
  enabled: true
}))

type SectionProps = Parameters<typeof ProfileUtilitiesSection>[0]

function buildProps(overrides: Partial<SectionProps>): SectionProps {
  return {
    appPaths: {
      tracktitan: 'C:\\Apps\\TrackTitan.exe',
      secondmonitor: 'C:\\Apps\\SecondMonitor.exe',
      customapp1: 'C:\\Apps\\Custom.exe'
    },
    appNames: {},
    appIconCache: {},
    utilityIcons: {},
    failedIcons: {},
    fetchingIcons: false,
    dragUtilityId: null,
    dropTarget: null,
    utilityByKey: new Map(UTILITIES.map((utility) => [utility.key, utility])),
    availableUtilities: UTILITIES,
    enabledUtilityEntries: ENTRIES,
    disabledUtilityEntries: [],
    onToggleUtility: vi.fn(),
    onMoveEnabledUtility: vi.fn(),
    onStartUtilityDrag: vi.fn(),
    onDropTargetChange: vi.fn(),
    onDragUtilityIdChange: vi.fn(),
    onIconFailed: vi.fn(),
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root | null = null

async function renderSection(props: SectionProps): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<ProfileUtilitiesSection {...props} />)
  })
}

// Stateful harness for the onError fallthrough tests: owns failedIcons as
// real state so a dispatched image `error` event re-renders the section with
// the failure recorded — exercising the actual onError → onIconFailed →
// next-tier chain end-to-end (same pattern as the AppsSection icon tests).
function StatefulHarness({ props }: { props: SectionProps }): ReactNode {
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>(props.failedIcons)
  return (
    <ProfileUtilitiesSection
      {...props}
      failedIcons={failedIcons}
      onIconFailed={(key: string) => setFailedIcons((prev) => ({ ...prev, [key]: true }))}
    />
  )
}

async function renderStatefulSection(props: SectionProps): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<StatefulHarness props={props} />)
  })
}

async function fireIconError(img: HTMLImageElement): Promise<void> {
  await act(async () => {
    img.dispatchEvent(new Event('error'))
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

// Each utility row is a direct child of the enabled-entries grid, in ENTRIES
// order; the single <img> (or none) inside it is that row's resolved icon.
function getRow(label: string): Element {
  const rows = [...container.querySelectorAll('.grid > div')]
  const row = rows.find((candidate) => candidate.textContent?.includes(label))
  if (!row) throw new Error(`No utility row found for label "${label}"`)
  return row
}

function getRowIcon(label: string): HTMLImageElement | null {
  return getRow(label).querySelector<HTMLImageElement>('img')
}

describe('ProfileUtilitiesSection icon precedence (bundled-first, #727)', () => {
  test('built-in with a bundled icon uses it even when shell extraction also returned a usable icon', async () => {
    await renderSection(
      buildProps({
        appIconCache: { 'c:\\apps\\tracktitan.exe': 'data:image/png;base64,SHELL' },
        utilityIcons: { tracktitan: 'data:image/png;base64,BUNDLED' }
      })
    )

    const img = getRowIcon('Track Titan')
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,BUNDLED')
  })

  test('built-in with a bundled icon uses it when shell extraction returned nothing', async () => {
    await renderSection(
      buildProps({
        utilityIcons: { tracktitan: 'data:image/png;base64,BUNDLED' }
      })
    )

    const img = getRowIcon('Track Titan')
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,BUNDLED')
  })

  test('built-in without a bundled icon (secondmonitor) still uses the shell icon', async () => {
    await renderSection(
      buildProps({
        appIconCache: { 'c:\\apps\\secondmonitor.exe': 'data:image/png;base64,SHELL' }
      })
    )

    const img = getRowIcon('Second Monitor')
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,SHELL')
  })

  test('custom app slots are unchanged: shell icon wins, no bundled tier applies', async () => {
    await renderSection(
      buildProps({
        appIconCache: { 'c:\\apps\\custom.exe': 'data:image/png;base64,SHELL' }
      })
    )

    const img = getRowIcon('Custom App 1')
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,SHELL')
  })

  test('falls back to the initials placeholder when neither icon source is available', async () => {
    await renderSection(buildProps({}))

    expect(getRowIcon('Track Titan')).toBeNull()
    expect(getRow('Track Titan').textContent).toContain('Tr')
  })
})

describe('ProfileUtilitiesSection bundled icon decode-failure fallthrough (#727)', () => {
  test('bundled icon error falls through to the shell icon', async () => {
    await renderStatefulSection(
      buildProps({
        appIconCache: { 'c:\\apps\\tracktitan.exe': 'data:image/png;base64,SHELL' },
        utilityIcons: { tracktitan: 'data:image/png;base64,BUNDLED' }
      })
    )

    const bundledImg = getRowIcon('Track Titan')
    expect(bundledImg!.src).toBe('data:image/png;base64,BUNDLED')

    await fireIconError(bundledImg!)

    const img = getRowIcon('Track Titan')
    expect(img).not.toBeNull()
    expect(img!.src).toBe('data:image/png;base64,SHELL')
  })

  test('bundled AND shell icon errors fall through to the initials placeholder', async () => {
    await renderStatefulSection(
      buildProps({
        appIconCache: { 'c:\\apps\\tracktitan.exe': 'data:image/png;base64,SHELL' },
        utilityIcons: { tracktitan: 'data:image/png;base64,BUNDLED' }
      })
    )

    await fireIconError(getRowIcon('Track Titan')!)
    // After the bundled failure the shell icon renders; fail that too.
    await fireIconError(getRowIcon('Track Titan')!)

    expect(getRowIcon('Track Titan')).toBeNull()
    expect(getRow('Track Titan').textContent).toContain('Tr')
  })
})
