import { describe, expect, test } from 'vitest'

import { getPathDisplayName } from '../../src/shared/path'

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
