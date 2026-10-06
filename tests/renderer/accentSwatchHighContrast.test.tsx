/**
 * #960: in a Windows Contrast theme the accent swatches rendered as empty
 * circles (forced colours replace their background fills, and the fill is the
 * whole point of the control) and the open profile menu had no edge (its only
 * edge was a box-shadow hairline, which forced colours strip).
 *
 * jsdom applies no media queries, so, as in gameIconDismiss.test.tsx (#737),
 * both ends are pinned: the hooks on the components, and the rules inside the
 * forced-colors block that key on them. A class name in a component and a
 * selector in a stylesheet drift apart silently otherwise. The rendering
 * itself is measured on a packaged build with forced colours emulated.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { AccentSwatchRow } from '../../src/renderer/src/components/AccentSwatchRow'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let container: HTMLElement

async function renderRow(isCustomColor: boolean): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <AccentSwatchRow
        accentPreset={isCustomColor ? 'custom' : '#008c99'}
        accentCustom="#123456"
        isCustomColor={isCustomColor}
        onAccentChange={vi.fn()}
        onCustomColorChange={vi.fn()}
      />
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

const presets = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Accent color "]'))
const customSwatch = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label^="Custom accent color"]')!

// The forced-colors block of App.css, as one string.
function forcedColorsCss(): string {
  const css = readFileSync(path.join(process.cwd(), 'src/renderer/src/App.css'), 'utf8')
  const start = css.indexOf('@media (forced-colors: active)')
  expect(start).toBeGreaterThan(-1)
  return css.slice(start)
}

function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`)
  expect(at, `no "${selector}" rule in the forced-colors block`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('accent swatches in High Contrast (#960)', () => {
  test('every swatch carries the hook, and the selected one says so without a new role', async () => {
    await renderRow(false)
    expect(presets().length).toBeGreaterThan(0)
    for (const preset of presets()) expect(preset.classList).toContain('accent-swatch')
    const selected = presets().filter((preset) => preset.getAttribute('aria-pressed') === 'true')
    expect(selected).toHaveLength(1)

    const custom = customSwatch()
    expect(custom.classList).toContain('accent-swatch')
    expect(custom.hasAttribute('data-selected')).toBe(false)
    // Already a popup trigger with an expanded state: aria-pressed would give
    // it a second, conflicting role (the first take on #968 added one).
    expect(custom.hasAttribute('aria-pressed')).toBe(false)
    // Its colour layers are inset-0, so a border on the button would shrink
    // the swatch in every theme (also the first take on #968). The ring is the
    // inner layer.
    expect(custom.className).not.toMatch(/(^|\s)border(-|\s|$)/)
    expect(custom.querySelector('.accent-swatch-ring')).not.toBeNull()
  })

  test('the custom swatch marks itself selected for the ring rule', async () => {
    await renderRow(true)
    expect(customSwatch().getAttribute('data-selected')).toBe('true')
    expect(presets().every((preset) => preset.getAttribute('aria-pressed') === 'false')).toBe(true)
  })

  test('the forced-colors block keeps the fills and draws system-colour rings, Highlight on the selected one', () => {
    const css = forcedColorsCss()
    expect(ruleBody(css, '.accent-swatch')).toContain('forced-color-adjust: none')
    expect(ruleBody(css, '.accent-swatch,\n  .accent-swatch-ring')).toContain(
      'border-color: CanvasText !important'
    )
    expect(
      ruleBody(
        css,
        ".accent-swatch[aria-pressed='true'],\n  .accent-swatch[data-selected='true'] .accent-swatch-ring"
      )
    ).toContain('border-color: Highlight !important')
    // Never the accent: under forced-color-adjust: none it resolves to the live
    // accent, invisible against the commonest selected swatch, an accent fill.
    expect(css.slice(0, css.indexOf('/* Toggle switch'))).not.toMatch(
      /accent-swatch[^}]*var\(--accent\)/
    )
  })
})

describe('the profile menu has an edge in High Contrast (#960)', () => {
  test('.dropdown-surface gets a CanvasText border in the forced-colors block', () => {
    expect(ruleBody(forcedColorsCss(), '.dropdown-surface')).toContain(
      'border: 1px solid CanvasText !important'
    )
    // And the profile menu's panel is the element that class sits on.
    const menuSource = readFileSync(
      path.join(process.cwd(), 'src/renderer/src/components/game-list/GameRowProfileMenu.tsx'),
      'utf8'
    )
    expect(menuSource).toMatch(/className=\{`dropdown-surface /)
  })
})
