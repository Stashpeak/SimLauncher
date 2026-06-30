/**
 * Regression for #562 (a11y: accent color used as text fails WCAG AA).
 *
 * applyAccentTheme derives an --accent-text token tuned for the resolved theme,
 * so accent-colored text (Settings section headings, the update pill, the
 * launch-order badge) stays AA-legible (>=4.5:1) for the default teal AND for
 * custom accents that are unreadable at full saturation.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { applyAccentTheme } from '../../src/renderer/src/lib/theme'

// The plain reference surfaces theme.ts derives the readable accent against.
const DARK_BG = '#322d3a'
const LIGHT_BG = '#f4f4f8'
// The accent-TINTED surfaces the token actually renders on (launch-order badge =
// accent ~/15 over glass; in light theme the glass is itself accent-tinted).
// Modeled independently of theme.ts so these assertions are not circular; these
// are LOWER-contrast than the plain references and are the binding constraint.
const LIGHT_TINTED_BADGE_BG = '#c0e1e5'
const DARK_TINTED_BADGE_BG = '#2f3a47'
const AA_NORMAL_TEXT = 4.5

function channel(hex: string, start: number): number {
  return parseInt(hex.slice(start, start + 2), 16)
}

function linearize(c: number): number {
  const n = c / 255
  return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  return (
    0.2126 * linearize(channel(hex, 1)) +
    0.7152 * linearize(channel(hex, 3)) +
    0.0722 * linearize(channel(hex, 5))
  )
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function accentText(): string {
  return document.documentElement.style.getPropertyValue('--accent-text').trim()
}

beforeEach(() => {
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.theme
})

afterEach(() => {
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.theme
})

describe('accent-text contrast (#562)', () => {
  test('default teal accent yields AA-legible text on the dark surface', () => {
    document.documentElement.dataset.theme = 'dark'
    applyAccentTheme('#008c99')

    const text = accentText()
    expect(text).toMatch(/^#[0-9a-f]{6}$/i)
    expect(contrast(text, DARK_BG)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })

  test('default teal accent yields AA-legible text on the light surface', () => {
    document.documentElement.dataset.theme = 'light'
    applyAccentTheme('#008c99')

    expect(contrast(accentText(), LIGHT_BG)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })

  test('default accent text clears AA on the accent-tinted badge surfaces (both themes)', () => {
    document.documentElement.dataset.theme = 'light'
    applyAccentTheme('#008c99')
    expect(contrast(accentText(), LIGHT_TINTED_BADGE_BG)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)

    document.documentElement.dataset.theme = 'dark'
    applyAccentTheme('#008c99')
    expect(contrast(accentText(), DARK_TINTED_BADGE_BG)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })

  test('a dark custom accent unreadable at full saturation is lightened until it passes (dark)', () => {
    document.documentElement.dataset.theme = 'dark'
    applyAccentTheme('#7a0010') // very dark red, ~2:1 as raw text on dark

    expect(contrast(accentText(), DARK_BG)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })

  test('a too-light custom accent is darkened until it passes (light)', () => {
    document.documentElement.dataset.theme = 'light'
    applyAccentTheme('#ffe14d') // light yellow, fails on the near-white surface

    expect(contrast(accentText(), LIGHT_BG)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })
})
