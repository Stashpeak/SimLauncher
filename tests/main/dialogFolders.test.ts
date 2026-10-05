import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'

// Electron 43 opens a dialog given no `defaultPath` in Downloads, every time,
// and Windows stops restoring the last folder (#907). These pin which folder
// SimLauncher hands it instead.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-folders-'))
const gameFolder = path.join(tmp, 'Games', 'ACC')
const otherFolder = path.join(tmp, 'Elsewhere')
const backupFolder = path.join(tmp, 'Backups')
for (const folder of [gameFolder, otherFolder, backupFolder])
  fs.mkdirSync(folder, { recursive: true })
const goneFolder = path.join(tmp, 'Uninstalled')

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** dialogFolders over an in-memory store holding `initial`, as electron-store would. */
async function loadDialogFolders(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = structuredClone(initial)
  vi.doMock('../../src/main/store', () => ({
    getStoredStringRecord: (key: string) => {
      const value = data[key]
      if (!value || typeof value !== 'object') return {}
      return Object.fromEntries(
        Object.entries(value).filter(([, item]) => typeof item === 'string')
      )
    },
    store: {
      get: (key: string) => data[key],
      set: (key: string, value: unknown) => {
        data[key] = value
      }
    }
  }))
  const mod = await import('../../src/main/dialogFolders')
  return { ...mod, data }
}

beforeEach(() => {
  vi.resetModules()
})

test('getSavedPathForInput finds game and companion paths by their store key', async () => {
  const { getSavedPathForInput } = await loadDialogFolders()
  const gamePaths = { acc: 'D:/Games/ACC/acc.exe' }
  const appPaths = { simhub: 'C:/Tools/SimHub/SimHubWPF.exe' }

  expect(getSavedPathForInput('acc', gamePaths, appPaths)).toBe('D:/Games/ACC/acc.exe')
  expect(getSavedPathForInput('simhub', gamePaths, appPaths)).toBe('C:/Tools/SimHub/SimHubWPF.exe')
  // A secondary executable's id names an editor row, not a stored value.
  expect(getSavedPathForInput('acc-tracked-0', gamePaths, appPaths)).toBeUndefined()
  // The id comes from the renderer: nothing inherited may answer it.
  expect(getSavedPathForInput('constructor', gamePaths, appPaths)).toBeUndefined()
  expect(getSavedPathForInput('__proto__', gamePaths, appPaths)).toBeUndefined()
})

test('getBrowseFolderCandidates orders this field, then its saved folder, then the last folder', async () => {
  const { getBrowseFolderCandidates } = await loadDialogFolders()

  expect(
    getBrowseFolderCandidates({
      lastPickForField: 'E:\\Picked',
      savedPath: 'D:\\Games\\ACC\\acc.exe',
      lastFolder: 'C:\\Tools'
    })
  ).toEqual(['E:\\Picked', 'D:\\Games\\ACC', 'C:\\Tools'])
  expect(
    getBrowseFolderCandidates({ savedPath: 'D:\\Games\\ACC\\acc.exe', lastFolder: 'C:\\Tools' })
  ).toEqual(['D:\\Games\\ACC', 'C:\\Tools'])
})

test('getBrowseFolderCandidates keeps only absolute folders, once each', async () => {
  const { getBrowseFolderCandidates } = await loadDialogFolders()

  // Electron forces a folder only for an absolute defaultPath; anything else
  // it prefills as a file name, so a relative candidate is never offered.
  expect(getBrowseFolderCandidates({ savedPath: 'acc.exe', lastFolder: 'Games' })).toEqual([])
  expect(getBrowseFolderCandidates({ savedPath: '   ', lastFolder: undefined })).toEqual([])
  // Rooted but drive-less: absolute to Node, relative to Chromium, so Electron
  // would not force it either. A saved path can look like this, because the
  // path check that admits it resolves against the current drive.
  expect(
    getBrowseFolderCandidates({
      savedPath: '\\Windows\\System32\\charmap.exe',
      lastFolder: '/Games'
    })
  ).toEqual([])
  expect(
    getBrowseFolderCandidates({ savedPath: '\\\\nas\\games\\ACC\\acc.exe', lastFolder: 'C:/Tools' })
  ).toEqual(['\\\\nas\\games\\ACC', 'C:/Tools'])
  expect(
    getBrowseFolderCandidates({
      lastPickForField: 'D:\\Games\\ACC',
      savedPath: 'D:\\Games\\ACC\\acc.exe',
      lastFolder: 'D:\\Games\\ACC'
    })
  ).toEqual(['D:\\Games\\ACC'])
})

test('firstExistingFolder takes the first folder that exists and survives a throwing check', async () => {
  const { firstExistingFolder } = await loadDialogFolders()
  const isFolder = vi.fn(async (candidate: string) => {
    if (candidate === 'A') throw new Error('EACCES')
    return candidate === 'C'
  })

  await expect(firstExistingFolder(['A', 'B', 'C', 'D'], isFolder)).resolves.toBe('C')
  expect(isFolder).not.toHaveBeenCalledWith('D')
  await expect(firstExistingFolder(['A', 'B'], isFolder)).resolves.toBeUndefined()
})

test('firstExistingFolder rejects a file and a folder that is gone', async () => {
  const { firstExistingFolder } = await loadDialogFolders()
  const file = path.join(gameFolder, 'acc.exe')
  fs.writeFileSync(file, '')

  // A missing folder handed to Electron opens its PARENT with the folder's
  // name prefilled as a file name, which is worse than no hint at all.
  await expect(firstExistingFolder([goneFolder, file, gameFolder])).resolves.toBe(gameFolder)
})

test('Browse on a configured field opens in the folder of its saved path', async () => {
  const { getBrowseDefaultPath } = await loadDialogFolders({
    gamePaths: { acc: path.join(gameFolder, 'acc.exe') },
    dialogFolders: { executable: otherFolder }
  })

  await expect(getBrowseDefaultPath('acc')).resolves.toBe(gameFolder)
})

test('Browse on an empty field, or one whose folder is gone, opens in the last folder used', async () => {
  const { getBrowseDefaultPath } = await loadDialogFolders({
    gamePaths: { acc: path.join(goneFolder, 'acc.exe') },
    dialogFolders: { executable: otherFolder }
  })

  await expect(getBrowseDefaultPath('lmu')).resolves.toBe(otherFolder)
  await expect(getBrowseDefaultPath('acc')).resolves.toBe(otherFolder)
  await expect(getBrowseDefaultPath('acc-tracked-0')).resolves.toBe(otherFolder)
})

test('with nothing remembered and nothing saved there is no hint, so Electron picks its default', async () => {
  const { getBrowseDefaultPath, getConfigFileDefaultPath } = await loadDialogFolders({
    dialogFolders: { executable: goneFolder, config: goneFolder }
  })

  await expect(getBrowseDefaultPath('lmu')).resolves.toBeUndefined()
  await expect(getConfigFileDefaultPath()).resolves.toBeUndefined()
})

test('a pick is remembered across a restart, as Windows remembered it before Electron 43', async () => {
  const first = await loadDialogFolders()
  first.rememberBrowsePick('lmu', path.join(otherFolder, 'Le Mans Ultimate.exe'))
  expect(first.data.dialogFolders).toEqual({ executable: otherFolder })

  // A fresh module over the same persisted data is the next app start.
  vi.resetModules()
  const second = await loadDialogFolders(first.data)
  await expect(second.getBrowseDefaultPath('ams2')).resolves.toBe(otherFolder)
})

test("a second Browse on the same field reopens that field's last pick, not its older saved folder", async () => {
  // Main only sees the SAVED path. Without the per-field memory, picking a
  // file in Elsewhere and pressing Browse again before saving would reopen
  // the old Games folder the user had just navigated away from.
  const { getBrowseDefaultPath, rememberBrowsePick } = await loadDialogFolders({
    gamePaths: { acc: path.join(gameFolder, 'acc.exe'), ac: path.join(gameFolder, 'ac.exe') }
  })

  rememberBrowsePick('acc', path.join(otherFolder, 'acc.exe'))
  await expect(getBrowseDefaultPath('acc')).resolves.toBe(otherFolder)

  // Another field's pick moves the last folder, but not this field's memory,
  // and a field with no pick of its own still prefers its saved folder.
  rememberBrowsePick('lmu', path.join(backupFolder, 'lmu.exe'))
  await expect(getBrowseDefaultPath('acc')).resolves.toBe(otherFolder)
  await expect(getBrowseDefaultPath('ac')).resolves.toBe(gameFolder)
  await expect(getBrowseDefaultPath('ams2')).resolves.toBe(backupFolder)
})

test('config files keep their own folder, separate from executables', async () => {
  const { getConfigFileDefaultPath, rememberBrowsePick, rememberConfigFile, data } =
    await loadDialogFolders()

  rememberBrowsePick('acc', path.join(gameFolder, 'acc.exe'))
  await expect(getConfigFileDefaultPath()).resolves.toBeUndefined()

  rememberConfigFile(path.join(backupFolder, 'simlauncher-config.json'))
  await expect(getConfigFileDefaultPath()).resolves.toBe(backupFolder)
  expect(data.dialogFolders).toEqual({ executable: gameFolder, config: backupFolder })
})

test('a broken store costs the hint, never the dialog', async () => {
  vi.doMock('../../src/main/store', () => ({
    getStoredStringRecord: () => {
      throw new Error('store unavailable')
    },
    store: {
      get: () => {
        throw new Error('store unavailable')
      },
      set: () => {
        throw new Error('store unavailable')
      }
    }
  }))
  const { getBrowseDefaultPath, getConfigFileDefaultPath, rememberBrowsePick, rememberConfigFile } =
    await import('../../src/main/dialogFolders')

  await expect(getBrowseDefaultPath('acc')).resolves.toBeUndefined()
  await expect(getConfigFileDefaultPath()).resolves.toBeUndefined()
  expect(() => rememberBrowsePick('acc', path.join(gameFolder, 'acc.exe'))).not.toThrow()
  expect(() => rememberConfigFile(path.join(backupFolder, 'c.json'))).not.toThrow()
})

test('a folder that never answers is skipped, not waited for', async () => {
  // An unreachable network share keeps stat pending for the SMB timeout
  // (about 21 s measured); on Electron 42 the dialog opened at once.
  const { isExistingFolder } = await loadDialogFolders()
  const hanging = () => new Promise<{ isDirectory(): boolean }>(() => {})
  const started = Date.now()
  await expect(isExistingFolder('\\\\nas\\games', hanging, 30)).resolves.toBe(false)
  expect(Date.now() - started).toBeLessThan(1000)

  await expect(isExistingFolder(gameFolder)).resolves.toBe(true)
  await expect(isExistingFolder(path.join(gameFolder, 'missing'))).rejects.toThrow()
})
