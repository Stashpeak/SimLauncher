/**
 * The exe-path acceptance rule shared by the store's sanitizers and the
 * profile editor (#890). It moved out of store.ts so the renderer can refuse
 * a save with the verdict main would reach, instead of a second regex that
 * drifts. These pin the rule itself; the sanitizers' use of it is covered in
 * store.test.ts.
 */

import { describe, expect, test } from 'vitest'

import {
  MAX_CONFIGURED_EXE_PATH_LENGTH,
  getExePathRejectReason,
  normalizeConfiguredExePath
} from '../../src/shared/path'

describe('normalizeConfiguredExePath', () => {
  test('strips one matched pair of surrounding quotes and trims inside them (#859)', () => {
    expect(normalizeConfiguredExePath('  "C:\\Tools\\App.exe "  ')).toBe('C:\\Tools\\App.exe')
  })

  test('leaves an unmatched or embedded quote alone for the rule to reject', () => {
    expect(normalizeConfiguredExePath('"C:\\Tools\\App.exe')).toBe('"C:\\Tools\\App.exe')
    expect(normalizeConfiguredExePath('C:\\To"ols\\App.exe')).toBe('C:\\To"ols\\App.exe')
  })
})

describe('getExePathRejectReason', () => {
  test('accepts a plain .exe path, case-insensitively', () => {
    expect(getExePathRejectReason('C:\\Tools\\App.exe')).toBeNull()
    expect(getExePathRejectReason('C:/Tools/App.EXE')).toBeNull()
  })

  test('accepts a quoted path, because the stored form is the stripped one', () => {
    expect(getExePathRejectReason('"C:\\Tools\\App.exe"')).toBeNull()
  })

  test('accepts a bare process name', () => {
    // A name with no directory is what the phantom-exit warning tells the user
    // to add from Task Manager. Whether the consumers then honour it is a
    // separate question (they filter on existence on disk today); the rule
    // here is the storage rule, and it stores it.
    expect(getExePathRejectReason('BeamNG.drive.x64.exe')).toBeNull()
  })

  test('rejects what is not an .exe path, including a surviving quote', () => {
    expect(getExePathRejectReason('C:\\Tools\\notes.txt')).toBe('not-an-exe')
    expect(getExePathRejectReason('"C:\\Tools\\App.exe')).toBe('not-an-exe')
    expect(getExePathRejectReason('')).toBe('not-an-exe')
    expect(getExePathRejectReason('   ')).toBe('not-an-exe')
    expect(getExePathRejectReason(42)).toBe('not-an-exe')
  })

  test('rejects an over-long path by length, measured on the stripped form', () => {
    const longPath = `C:\\${'a'.repeat(MAX_CONFIGURED_EXE_PATH_LENGTH)}.exe`
    expect(getExePathRejectReason(longPath)).toBe('too-long')
    // Quotes do not count: the same path wrapped in a pair is judged on what
    // would be stored.
    const atLimit = `C:\\${'a'.repeat(MAX_CONFIGURED_EXE_PATH_LENGTH - 7)}.exe`
    expect(atLimit.length).toBe(MAX_CONFIGURED_EXE_PATH_LENGTH)
    expect(getExePathRejectReason(`"${atLimit}"`)).toBeNull()
  })
})
