import path from 'path'
import { describe, expect, test } from 'vitest'

import { getExeName, normalizePathForComparison, pathsEqual } from '../../src/main/utils'

describe('normalizePathForComparison', () => {
  test('returns "" for non-string inputs', () => {
    expect(normalizePathForComparison(undefined)).toBe('')
    expect(normalizePathForComparison(null)).toBe('')
    expect(normalizePathForComparison(42)).toBe('')
    expect(normalizePathForComparison({})).toBe('')
  })

  test('returns "" for empty or whitespace-only strings', () => {
    expect(normalizePathForComparison('')).toBe('')
    expect(normalizePathForComparison('   ')).toBe('')
  })

  test('produces a consistent canonical form for an absolute path', () => {
    const normalized = normalizePathForComparison('C:\\Apps\\foo.exe')
    expect(normalized).toBe(path.win32.resolve('C:\\Apps\\foo.exe').toLowerCase())
    expect(normalized).toMatch(/foo\.exe$/)
  })

  test('case and slash variants normalize to the same canonical form', () => {
    const a = normalizePathForComparison('C:\\Apps\\foo.exe')
    const b = normalizePathForComparison('c:/apps/FOO.EXE')
    expect(a).toBe(b)
  })

  test('trims surrounding whitespace before normalizing', () => {
    const padded = normalizePathForComparison('  C:\\foo.exe  ')
    const plain = normalizePathForComparison('C:\\foo.exe')
    expect(padded).toBe(plain)
  })

  test('resolves mixed separators and parent segments', () => {
    const normalized = normalizePathForComparison('C:\\A\\..\\B\\x.exe')
    expect(normalized).toBe(path.win32.resolve('C:\\B\\x.exe').toLowerCase())
    expect(normalized).toMatch(/[\\/]b[\\/]x\.exe$/)
  })
})

describe('pathsEqual', () => {
  test('returns true for two equivalent paths in different shapes', () => {
    expect(pathsEqual('C:\\Apps\\foo.exe', 'c:/apps/FOO.EXE')).toBe(true)
  })

  test('returns false for two different paths', () => {
    expect(pathsEqual('C:\\Apps\\foo.exe', 'C:\\Apps\\bar.exe')).toBe(false)
  })

  test('returns false when one input is invalid', () => {
    expect(pathsEqual('C:\\Apps\\foo.exe', undefined)).toBe(false)
    expect(pathsEqual(null, 'C:\\Apps\\foo.exe')).toBe(false)
    expect(pathsEqual('C:\\Apps\\foo.exe', '')).toBe(false)
    expect(pathsEqual('   ', 'C:\\Apps\\foo.exe')).toBe(false)
  })

  test('returns false when both inputs are invalid (empty does not equal empty)', () => {
    expect(pathsEqual('', '')).toBe(false)
    expect(pathsEqual(undefined, null)).toBe(false)
    expect(pathsEqual('   ', '')).toBe(false)
  })
})

describe('getExeName (relaxed input)', () => {
  test('returns "" for non-string inputs', () => {
    expect(getExeName(undefined)).toBe('')
    expect(getExeName(null)).toBe('')
    expect(getExeName(42)).toBe('')
    expect(getExeName({})).toBe('')
  })

  test('returns "" for empty or whitespace-only strings', () => {
    expect(getExeName('')).toBe('')
    expect(getExeName('   ')).toBe('')
  })

  test('preserves current happy-path behaviour', () => {
    expect(getExeName('C:\\Apps\\Foo.exe')).toBe('foo.exe')
  })
})
