/**
 * isGameExeRunning decides whether the green "Running" dot on a game and the
 * "<game> is now running" announcement fire. Both must mean the GAME ITSELF is
 * running — not merely that a companion (e.g. SimHub) under the same profile is
 * up, which is what the runningStatus[key] aggregate would wrongly report (#587).
 */

import { describe, expect, test } from 'vitest'

import { isGameExeRunning } from '../../src/renderer/src/lib/runningGame'

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
    expect(isGameExeRunning([{ path: acGame.path.toUpperCase(), gameKey: 'ac' }], 'ac', acGame.path)).toBe(true)
  })
})
