/**
 * Two layout guards from the pre-smoke visual sweep of 1.2.4. jsdom does no
 * layout and applies no app-region, so, as in accentSwatchHighContrast.test.tsx,
 * both ends of each guard are pinned: the hook in the component and the rule
 * that keys on it. The layouts themselves were measured on a packaged build.
 *
 * #1028: an open Settings section was as wide as its content needed, so with
 * Utility Apps open Settings scrolled sideways at 175% zoom in the default
 * 800×600 window (462 CSS px of content in 451).
 *
 * #1029: floating surfaces with controls can be drawn over the header's drag
 * region, where an element does not get the mouse unless it opts out itself.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { SettingsSection } from '../../src/renderer/src/components/settings/SettingsSection'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
})

const read = (file: string): string => readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Settings section width (#1028)', () => {
  // The grid that animates a section open had an implicit column, which sizes
  // to the content: an open Utility Apps section needed 446 CSS px and took
  // it. grid-cols-1 is minmax(0, 1fr), a column that gives way to the window.
  test('an open section sits in a column that can shrink', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container as HTMLElement)
      root.render(
        <SettingsSection title="Utility Apps" sectionKey="apps" open={true} onOpenChange={vi.fn()}>
          <p>content</p>
        </SettingsSection>
      )
    })

    const grid = container.querySelector('[role="region"]')
    expect(grid?.classList.contains('grid')).toBe(true)
    expect(grid?.classList.contains('grid-cols-1')).toBe(true)
  })
})

describe('floating surfaces over the title bar (#1029)', () => {
  const css = read('src/renderer/src/App.css')

  test('menus and dialogs opt out of the drag region in one rule', () => {
    const at = css.indexOf(".dropdown-surface,\n[role='dialog'],\n[role='alertdialog'] {")
    expect(at, 'no shared no-drag rule for floating surfaces').toBeGreaterThan(-1)
    expect(css.slice(at, css.indexOf('}', at))).toContain('-webkit-app-region: no-drag')
  })

  // The other end: the surfaces carry what the rule keys on. A renamed class or
  // a dropped role would silently put them back under the drag region.
  test('both menus use .dropdown-surface, and the dialogs carry their roles', () => {
    expect(read('src/renderer/src/components/game-list/GameRowProfileMenu.tsx')).toMatch(
      /className=\{`dropdown-surface /
    )
    expect(read('src/renderer/src/hooks/useDismissMenu.tsx')).toMatch(
      /className="dropdown-surface /
    )
    expect(read('src/renderer/src/components/ConfirmDialog.tsx')).toContain('role="alertdialog"')
    expect(read('src/renderer/src/components/OnboardingModal.tsx')).toContain('role="dialog"')
    expect(read('src/renderer/src/components/ColorPickerPopover.tsx')).toContain('role="dialog"')
  })
})
