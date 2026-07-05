/**
 * #735 - flash-free boot theming. Main resolves the concrete theme from the
 * PERSISTED settings and hands it to the preload via `--initial-theme=<theme>`;
 * the preload paints it onto the document BEFORE the renderer's first frame, so
 * a fresh install (default 'system') on a light-mode OS never flashes dark while
 * the renderer's async settings read is still in flight.
 */
import { afterEach, describe, expect, test } from 'vitest'

import {
  applyInitialTheme,
  INITIAL_THEME_ARG_PREFIX,
  parseInitialThemeArg
} from '../../src/preload/initialTheme'

describe('parseInitialThemeArg (#735)', () => {
  test('extracts a valid injected theme from argv', () => {
    expect(parseInitialThemeArg(['--foo', `${INITIAL_THEME_ARG_PREFIX}light`])).toBe('light')
    expect(parseInitialThemeArg([`${INITIAL_THEME_ARG_PREFIX}dark`])).toBe('dark')
  })

  test('returns null when the argument is absent or malformed', () => {
    expect(parseInitialThemeArg(['--foo', '--bar'])).toBeNull()
    expect(parseInitialThemeArg([`${INITIAL_THEME_ARG_PREFIX}purple`])).toBeNull()
    expect(parseInitialThemeArg([])).toBeNull()
  })
})

describe('applyInitialTheme (#735)', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme
  })

  test('paints the injected theme onto the document root before first paint', () => {
    applyInitialTheme([`${INITIAL_THEME_ARG_PREFIX}light`], document.documentElement)
    // App.css treats data-theme="light" as light; anything else is the dark
    // default. A fresh system install on a light OS must land here, not dark.
    expect(document.documentElement.dataset.theme).toBe('light')

    applyInitialTheme([`${INITIAL_THEME_ARG_PREFIX}dark`], document.documentElement)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  test('leaves the document untouched when no theme was injected', () => {
    applyInitialTheme(['--other'], document.documentElement)
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  test('no-ops when the root is unavailable', () => {
    expect(() => applyInitialTheme([`${INITIAL_THEME_ARG_PREFIX}light`], null)).not.toThrow()
  })
})
