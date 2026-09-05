import path from 'path'
import { describe, expect, test } from 'vitest'

import {
  getExeName,
  isBareExeName,
  isTrackableSecondaryExe,
  normalizePathForComparison,
  pathsEqual
} from '../../src/main/utils'

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

  test('trims leading/trailing whitespace before extracting the basename (#679)', () => {
    expect(getExeName('  C:\\Apps\\Foo.exe  ')).toBe('foo.exe')
    expect(getExeName('C:\\Apps\\Foo.exe ')).toBe('foo.exe')
    expect(getExeName(' C:\\Apps\\Foo.exe')).toBe('foo.exe')
  })
})

// The shape rule behind a secondary executable typed as a Task Manager image
// name (#929). Pure, so it is pinned here on its own terms; the consumers'
// suites cover what happens to an entry once the rule has admitted it.
describe('isBareExeName', () => {
  test('accepts an .exe with no directory, whatever the case or surrounding whitespace', () => {
    expect(isBareExeName('BeamNG.drive.x64.exe')).toBe(true)
    expect(isBareExeName('ACS.EXE')).toBe(true)
    expect(isBareExeName('  acs_real.exe  ')).toBe(true)
    expect(isBareExeName('garage61 telemetry agent.exe')).toBe(true)
  })

  test('rejects anything with a directory, under either separator, on any host', () => {
    // win32 semantics explicitly, like getExeName: a POSIX host would otherwise
    // read a backslash path as one long basename and call it bare.
    expect(isBareExeName('C:\\Games\\acs.exe')).toBe(false)
    expect(isBareExeName('C:/Games/acs.exe')).toBe(false)
    expect(isBareExeName('.\\acs.exe')).toBe(false)
    expect(isBareExeName('Games/acs.exe')).toBe(false)
  })

  test('rejects what is not an .exe name at all', () => {
    expect(isBareExeName('notes.txt')).toBe(false)
    expect(isBareExeName('acs')).toBe(false)
    expect(isBareExeName('')).toBe(false)
    expect(isBareExeName('   ')).toBe(false)
    expect(isBareExeName(undefined)).toBe(false)
    expect(isBareExeName(null)).toBe(false)
    expect(isBareExeName(42)).toBe(false)
  })
})

describe('isTrackableSecondaryExe', () => {
  test('accepts a bare name without asking the filesystem', () => {
    // No fs mock in this file, and no such file anywhere: the answer comes
    // from the shape rule alone.
    expect(isTrackableSecondaryExe('acs_real.exe')).toBe(true)
  })

  test('still holds a path-shaped entry to existence', () => {
    expect(isTrackableSecondaryExe('C:/SimLauncher-No-Such-Dir/acs_real.exe')).toBe(false)
  })

  test('rejects what neither rule accepts', () => {
    expect(isTrackableSecondaryExe('notes.txt')).toBe(false)
    expect(isTrackableSecondaryExe('')).toBe(false)
    expect(isTrackableSecondaryExe(undefined)).toBe(false)
  })
})
