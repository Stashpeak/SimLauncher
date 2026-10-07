/**
 * #1034: in the light theme a toggle barely showed, on or off. Measured from
 * rendered pixels: off track vs surface 1.00:1 and knob vs track 1.10:1; with
 * a bright accent, on track vs surface 1.24:1. WCAG 1.4.11 asks 3:1. Dark
 * passed because the white knob or the accent fill always stands out.
 *
 * The fix is light-only, through tokens: a dark edge on the track and the
 * knob. jsdom computes no colours, so, as in accentSwatchHighContrast.test.tsx,
 * both ends are pinned: Toggle reads the tokens, the light block sets visible
 * edges, and the dark defaults keep what Toggle used before. The contrast
 * itself was measured on a packaged build.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { Toggle } from '../../src/renderer/src/components/Toggle'

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

const css = readFileSync(path.join(process.cwd(), 'src/renderer/src/App.css'), 'utf8')

// The declarations of one top-level block, e.g. ':root {' up to its closing brace.
function block(selector: string): string {
  const at = css.indexOf(`${selector} {`)
  expect(at, `no "${selector}" block in App.css`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('\n}', at))
}

function token(scope: string, name: string): string | undefined {
  return block(scope)
    .match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]
    ?.trim()
}

describe('toggle edges in the light theme (#1034)', () => {
  test('the knob takes its edge from the tokens, on and off', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container as HTMLElement)
      root.render(<Toggle checked={false} onChange={vi.fn()} aria-label="Example" />)
    })
    const track = container.querySelector('.toggle-track')
    expect(track?.className).toContain('after:border-(--toggle-knob-edge)')
    expect(track?.className).toContain('peer-checked:after:border-(--toggle-knob-edge-on)')
  })

  test('the track draws the edge token around itself', () => {
    expect(block('.toggle-track')).toContain('inset 0 0 0 1px var(--toggle-edge)')
  })

  test('light sets a visible edge on the track and the knob', () => {
    for (const name of ['--toggle-edge', '--toggle-knob-edge', '--toggle-knob-edge-on']) {
      const value = token(":root[data-theme='light']", name)
      expect(value, `${name} in the light block`).toBeDefined()
      expect(value).not.toBe('transparent')
    }
  })

  // Dark already passed, so it must look exactly as before: no track edge,
  // and the knob edges Toggle hard-coded until now.
  test('dark keeps its previous look', () => {
    expect(token(':root', '--toggle-edge')).toBe('transparent')
    expect(token(':root', '--toggle-knob-edge')).toBe('var(--glass-border)')
    expect(token(':root', '--toggle-knob-edge-on')).toBe('#fff')
  })
})
