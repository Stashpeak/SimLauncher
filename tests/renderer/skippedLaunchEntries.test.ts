import { expect, test } from 'vitest'
import { formatSkippedLaunchEntries } from '../../src/renderer/src/lib/skippedLaunchEntries'

/**
 * Unit coverage for the skipped-entry toast copy (#639), independent of the
 * UI wiring in gameRowLaunchSkipped / profileEditorLaunchSkipped: the plural
 * wording and the full name-resolution precedence (game name > configured
 * custom name > utility default > exe basename) are pinned here.
 */

const LOOKUP = {
  gameKey: 'ac',
  gameName: 'Assetto Corsa',
  appNames: { customapp1: 'My Dash' },
  utilities: [
    { key: 'customapp1', name: 'Custom App 1' },
    { key: 'simhub', name: 'SimHub' }
  ]
}

test('single skipped entry names it in the singular form', () => {
  const out = formatSkippedLaunchEntries(
    [{ key: 'ac', path: 'C:/Games/AC/acs.exe', reason: 'missing' }],
    LOOKUP
  )

  expect(out).toBe('Assetto Corsa was skipped: its path no longer exists.')
})

test('multiple skipped entries use the plural form and list every name', () => {
  const out = formatSkippedLaunchEntries(
    [
      { key: 'ac', path: 'C:/Games/AC/acs.exe', reason: 'missing' },
      { key: 'simhub', path: 'C:/Tools/SimHub.exe', reason: 'invalid' }
    ],
    LOOKUP
  )

  expect(out).toBe(
    '2 items were skipped because their paths no longer exist (Assetto Corsa, SimHub).'
  )
})

test('name resolution prefers game name, then configured name, then utility default, then basename', () => {
  // Game key beats everything.
  expect(
    formatSkippedLaunchEntries(
      [{ key: 'ac', path: 'C:/x/whatever.exe', reason: 'missing' }],
      LOOKUP
    )
  ).toContain('Assetto Corsa')

  // Configured custom name beats the utility default.
  expect(
    formatSkippedLaunchEntries(
      [{ key: 'customapp1', path: 'C:/Tools/dash.exe', reason: 'missing' }],
      LOOKUP
    )
  ).toContain('My Dash')

  // Utility default when no custom name is configured.
  expect(
    formatSkippedLaunchEntries(
      [{ key: 'simhub', path: 'C:/Tools/SimHub.exe', reason: 'missing' }],
      LOOKUP
    )
  ).toContain('SimHub')

  // Unknown key with no lookups falls back to the exe basename, never the raw
  // path or the internal key.
  const out = formatSkippedLaunchEntries(
    [{ key: 'crewchief', path: 'C:/Apps/CrewChiefV4.exe', reason: 'missing' }],
    { gameKey: 'ac', gameName: 'Assetto Corsa' }
  )
  expect(out).toContain('CrewChiefV4')
  expect(out).not.toContain('C:/Apps')
})
