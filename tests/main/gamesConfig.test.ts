import { expect, test } from 'vitest'
import fs from 'fs'
import path from 'path'

import { KNOWN_GAME_KEYS } from '../../src/main/store'
import { GAMES } from '../../src/renderer/src/lib/config'

// The icon check must be case-insensitive: SimLauncher is Windows-only and
// several pre-existing assets differ from their config string in case
// (iRacing.png vs assets/iracing.png), which Windows resolves fine.
const assetFilesLowercase = new Set(
  fs.readdirSync(path.resolve(process.cwd(), 'assets')).map((name) => name.toLowerCase())
)

test('every GAMES entry has a registered game key and an existing icon asset', () => {
  for (const game of GAMES) {
    expect(KNOWN_GAME_KEYS.has(game.key), `${game.key} missing in KNOWN_GAME_KEYS`).toBe(true)
    const iconFile = path.basename(game.icon).toLowerCase()
    expect(assetFilesLowercase.has(iconFile), `${game.icon} missing on disk`).toBe(true)
  }
})

test('flight sims are first-class supported games (#392)', () => {
  const keys = new Set(GAMES.map((game) => game.key))
  for (const key of ['msfs2020', 'msfs2024', 'xplane12', 'p3d', 'il2gb', 'aeroflyfs4']) {
    expect(keys.has(key), `${key} missing in GAMES`).toBe(true)
  }
})
