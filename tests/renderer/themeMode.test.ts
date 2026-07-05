/**
 * #735 - default new installs to the system theme instead of dark.
 *
 * `system` is a fully working, live-reactive mode (theme.ts subscribes to OS
 * preference changes), so a fresh config should resolve to it rather than a
 * hardcoded dark default. An existing persisted themeMode must be respected,
 * not silently overridden - this only changes the baseline for brand-new
 * configs.
 */
import { describe, expect, test } from 'vitest'

import { DEFAULT_THEME_MODE, normalizeThemeMode } from '../../src/renderer/src/lib/theme'

describe('theme mode default (#735)', () => {
  test('DEFAULT_THEME_MODE is system', () => {
    expect(DEFAULT_THEME_MODE).toBe('system')
  })

  test('normalizeThemeMode resolves a missing/invalid value to system for a fresh config', () => {
    expect(normalizeThemeMode(undefined)).toBe('system')
    expect(normalizeThemeMode(null)).toBe('system')
    expect(normalizeThemeMode('bogus')).toBe('system')
  })

  test('normalizeThemeMode respects an existing persisted value (not overridden)', () => {
    expect(normalizeThemeMode('dark')).toBe('dark')
    expect(normalizeThemeMode('light')).toBe('light')
    expect(normalizeThemeMode('system')).toBe('system')
  })
})
