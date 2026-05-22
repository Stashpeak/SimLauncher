import { describe, expect, test, vi } from 'vitest'

// The module under test imports from '../processes', which transitively loads
// Electron. Stub both before importing so the suite runs in a plain Node env.
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  Menu: { buildFromTemplate: vi.fn() },
  ipcMain: { handle: vi.fn() }
}))

vi.mock('../../src/main/processes', () => ({
  dismissAppIcon: vi.fn(),
  publishRunningApps: vi.fn(() => Promise.resolve())
}))

import { buildDismissLabel } from '../../src/main/ipc/context-menu'

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

  test('escapes ampersands so Electron does not treat them as mnemonics', () => {
    expect(buildDismissLabel('C:/games/sim/AT&T.exe', { tracked: false })).toBe(
      'Dismiss Icon for AT&&T'
    )
    expect(
      buildDismissLabel('C:/games/sim/utility.exe', { tracked: true, name: 'Foo & Bar' })
    ).toBe('Dismiss Warning for Foo && Bar')
  })
})
