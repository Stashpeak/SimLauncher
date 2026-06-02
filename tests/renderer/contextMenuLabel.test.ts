import { describe, expect, test } from 'vitest'
import { buildDismissLabel } from '../../src/renderer/src/lib/contextMenuLabel'

describe('buildDismissLabel', () => {
  test('untracked mismatch uses "Dismiss Icon"', () => {
    expect(
      buildDismissLabel('C:/games/sim/utility.exe', { tracked: false, name: 'utility.exe' })
    ).toBe('Dismiss Icon for utility')
  })

  test('tracked utility uses "Dismiss Warning"', () => {
    expect(buildDismissLabel('C:/games/sim/OTT.exe', { tracked: true, name: 'OTT.exe' })).toBe(
      'Dismiss Warning for OTT'
    )
  })

  test('falls back to the basename when name is omitted', () => {
    expect(buildDismissLabel('C:/games/sim/SimAppPro.exe')).toBe('Dismiss Icon for SimAppPro')
  })

  test('preserves names that have no .exe suffix', () => {
    expect(buildDismissLabel('C:/games/sim/launcher', { tracked: true, name: 'launcher' })).toBe(
      'Dismiss Warning for launcher'
    )
  })

  test('treats undefined tracked as untracked', () => {
    expect(buildDismissLabel('C:/games/sim/foo.exe')).toBe('Dismiss Icon for foo')
  })

  test('drops the display segment when name resolution yields an empty string', () => {
    expect(buildDismissLabel('', { name: '' })).toBe('Dismiss Icon')
  })

  test('keeps single ampersand verbatim since HTML renders it natively', () => {
    expect(buildDismissLabel('C:/games/sim/AT&T.exe', { tracked: false })).toBe(
      'Dismiss Icon for AT&T'
    )
    expect(
      buildDismissLabel('C:/games/sim/utility.exe', { tracked: true, name: 'Foo & Bar' })
    ).toBe('Dismiss Warning for Foo & Bar')
  })
})
