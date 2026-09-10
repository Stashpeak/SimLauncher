/**
 * isGameExeRunning decides whether the green "Running" dot on a game and the
 * "<game> is now running" announcement fire. Both must mean the GAME ITSELF is
 * running — not merely that a companion (e.g. SimHub) under the same profile is
 * up, which is what the runningStatus[key] aggregate would wrongly report (#587).
 */

import { describe, expect, test } from 'vitest'

import {
  findGameExeRunningApp,
  getNameScopedSecondaries,
  isClosableStripEntry,
  isGameExeRunning
} from '../../src/renderer/src/lib/runningGame'

const acGame = { path: 'C:\\Games\\AssettoCorsa\\acs.exe', gameKey: 'ac' }
const simhub = { path: 'C:\\Program Files\\SimHub\\SimHubWPF.exe', gameKey: 'ac' }

describe('isGameExeRunning', () => {
  test('true when the game exe is among the running apps for its key', () => {
    expect(isGameExeRunning([acGame, simhub], 'ac', acGame.path)).toBe(true)
  })

  test('false when only a companion under the same key is running (#587)', () => {
    expect(isGameExeRunning([simhub], 'ac', acGame.path)).toBe(false)
  })

  test('false when nothing for the game is running', () => {
    expect(isGameExeRunning([], 'ac', acGame.path)).toBe(false)
  })

  test('false when the game path is not configured', () => {
    expect(isGameExeRunning([acGame], 'ac', undefined)).toBe(false)
  })

  test('requires the gameKey to match, not just the path', () => {
    expect(isGameExeRunning([{ path: acGame.path, gameKey: 'acc' }], 'ac', acGame.path)).toBe(false)
  })

  test('matches case-insensitively (Windows paths)', () => {
    expect(
      isGameExeRunning([{ path: acGame.path.toUpperCase(), gameKey: 'ac' }], 'ac', acGame.path)
    ).toBe(true)
  })
})

// findGameExeRunningApp underpins isGameExeRunning but returns the matching entry
// itself, so the game icon can read that entry's warning + dismiss path for the
// stuck-dot Dismiss menu (#737).
describe('findGameExeRunningApp', () => {
  test('returns the matching entry, preserving its extra fields', () => {
    const warned = { path: acGame.path, gameKey: 'ac', warning: 'stub exited' }
    expect(findGameExeRunningApp([simhub, warned], 'ac', acGame.path)).toBe(warned)
  })

  test('returns undefined when only a companion is running (#587)', () => {
    expect(findGameExeRunningApp([simhub], 'ac', acGame.path)).toBeUndefined()
  })

  test('returns undefined when the game path is not configured', () => {
    expect(findGameExeRunningApp([acGame], 'ac', undefined)).toBeUndefined()
  })

  test('requires the gameKey to match, not just the path', () => {
    expect(
      findGameExeRunningApp([{ path: acGame.path, gameKey: 'acc' }], 'ac', acGame.path)
    ).toBeUndefined()
  })

  test('matches case-insensitively (Windows paths)', () => {
    const entry = { path: acGame.path.toUpperCase(), gameKey: 'ac' }
    expect(findGameExeRunningApp([entry], 'ac', acGame.path)).toBe(entry)
  })
})

/**
 * The partition the row needs before it offers Close Apps: `kill.ts` refuses a
 * name-scoped target, so counting one made the row swap Launch for a close that
 * could never run (#947, #929).
 *
 * These specify the predicate; the assertion that actually goes red against the
 * pre-fix code is in gameRowCanKillClosable.test.tsx, which drives the row.
 */
describe('getNameScopedSecondaries', () => {
  test('keeps only the bare names, trimmed and lowercased', () => {
    expect([
      ...getNameScopedSecondaries([
        ' AC2-Win64-Shipping.exe ',
        'C:\\Tools\\helper.exe',
        'C:app.exe'
      ])
    ]).toEqual(['ac2-win64-shipping.exe'])
  })

  test('a profile with no list has no name-scoped entries', () => {
    expect(getNameScopedSecondaries(undefined).size).toBe(0)
  })
})

describe('isClosableStripEntry', () => {
  // What the active profile lists under "Secondary executables to watch".
  const nameScoped = getNameScopedSecondaries(['AC2-Win64-Shipping.exe', 'C:\\Tools\\helper.exe'])

  test('a path-scoped companion is closable', () => {
    expect(isClosableStripEntry(simhub, nameScoped)).toBe(true)
  })

  test('the configured game path is closable by shape, the game exclusion is kill.ts', () => {
    // This predicate answers "could Close Apps act on this entry", not "is this
    // the game". The game is excluded by full path in getProfileCompanionTargets
    // and again at kill.ts:833, and the strip excludes it in GameList.
    expect(isClosableStripEntry(acGame, nameScoped)).toBe(true)
  })

  test('a bare name the profile lists as a secondary is not closable (#929)', () => {
    expect(isClosableStripEntry({ path: 'AC2-Win64-Shipping.exe' }, nameScoped)).toBe(false)
  })

  test('case and surrounding whitespace do not change the match', () => {
    expect(isClosableStripEntry({ path: 'AC2-WIN64-SHIPPING.EXE' }, nameScoped)).toBe(false)
    expect(isClosableStripEntry({ path: ' AC2-Win64-Shipping.exe ' }, nameScoped)).toBe(false)
  })

  test('a bare name the profile does not list is a curated target, so closable', () => {
    // Codex P2 on #950. A failed `/IM` close of a curated utility (the Garage61
    // agent) is published with its image name where a path would go, and
    // getProfileCompanionTargets still targets it, so shape alone cannot decide.
    expect(isClosableStripEntry({ path: 'Garage61 telemetry agent.exe' }, nameScoped)).toBe(true)
  })

  test('a drive-relative name is a path, not a bare name', () => {
    // path.win32.basename('C:app.exe') is 'app.exe', so main does not read this
    // as bare either. The two spellings of the rule have to agree, which is why
    // they are now one (src/shared/path.ts).
    expect(
      isClosableStripEntry({ path: 'C:app.exe' }, getNameScopedSecondaries(['C:app.exe']))
    ).toBe(true)
  })

  test('a forward-slash path is a path', () => {
    expect(isClosableStripEntry({ path: 'A:/Apps/SimHub/SimHubWPF.exe' }, nameScoped)).toBe(true)
  })
})
