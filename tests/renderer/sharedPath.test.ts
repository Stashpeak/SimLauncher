import { describe, expect, test } from 'vitest'

import { getPathComparisonKey, getPathDisplayName } from '../../src/shared/path'

describe('getPathDisplayName', () => {
  test('returns "" for non-string inputs', () => {
    expect(getPathDisplayName(undefined as unknown as string)).toBe('')
    expect(getPathDisplayName(null as unknown as string)).toBe('')
    expect(getPathDisplayName(42 as unknown as string)).toBe('')
    expect(getPathDisplayName({} as unknown as string)).toBe('')
  })

  test('returns "" for empty or whitespace-only strings', () => {
    expect(getPathDisplayName('')).toBe('')
    expect(getPathDisplayName('   ')).toBe('')
  })

  test('extracts the last segment from a Windows path', () => {
    expect(getPathDisplayName('C:\\Apps\\Foo.exe')).toBe('Foo.exe')
  })

  test('extracts the last segment from a forward-slash path', () => {
    expect(getPathDisplayName('/usr/local/bin/foo')).toBe('foo')
  })

  test('handles mixed separators', () => {
    expect(getPathDisplayName('C:\\Apps/sub\\Bar.exe')).toBe('Bar.exe')
  })

  test('preserves original casing (display-only, never lowercases)', () => {
    expect(getPathDisplayName('C:\\Apps\\MixedCase.EXE')).toBe('MixedCase.EXE')
  })

  test('falls back to the trimmed input when no separator is present', () => {
    expect(getPathDisplayName('foo.exe')).toBe('foo.exe')
    expect(getPathDisplayName('  bar  ')).toBe('bar')
  })
})

describe('getPathComparisonKey', () => {
  test('returns "" for non-string, empty, and whitespace-only inputs', () => {
    expect(getPathComparisonKey(undefined as unknown as string)).toBe('')
    expect(getPathComparisonKey(null as unknown as string)).toBe('')
    expect(getPathComparisonKey('')).toBe('')
    expect(getPathComparisonKey('   ')).toBe('')
  })

  test('trims, unifies separators, and lowercases', () => {
    expect(getPathComparisonKey('  C:/Apps//Sub\\Foo.EXE  ')).toBe('c:\\apps\\sub\\foo.exe')
  })

  test('preserves the leading UNC double-backslash while collapsing the rest', () => {
    expect(getPathComparisonKey('\\\\Server\\Share\\\\App.exe')).toBe('\\\\server\\share\\app.exe')
  })

  // The #652 bundled-icon regression this helper exists for: the configured
  // settings value (user-typed, forward slashes, trailing space) and the
  // main-process running-entry path (canonical backslash form) must produce
  // the SAME map key, or the bundled Track Titan icon lookup silently misses.
  test('configured path and running-entry path variants collapse to one key (#652)', () => {
    const configuredPath = 'C:/Tools\\TrackTitan.exe '
    const runningEntryPath = 'c:\\tools\\tracktitan.exe'

    const bundledIconByPath: Record<string, string> = {
      [getPathComparisonKey(configuredPath)]: 'data:image/png;base64,BUNDLED'
    }

    expect(bundledIconByPath[getPathComparisonKey(runningEntryPath)]).toBe(
      'data:image/png;base64,BUNDLED'
    )
  })
})
