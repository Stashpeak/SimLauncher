import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function listFiles(directory: string): string[] {
  return readdirSync(path.join(root, directory)).flatMap((entry) => {
    const relativePath = path.join(directory, entry)
    const absolutePath = path.join(root, relativePath)

    return statSync(absolutePath).isDirectory() ? listFiles(relativePath) : relativePath
  })
}

function matches(source: string, pattern: RegExp) {
  return [...source.matchAll(pattern)].map((match) => match[1])
}

function toPosix(relativePath: string) {
  return relativePath.replace(/\\/g, '/')
}

test('every invoked IPC channel has a main-process handler and no stale handler remains', () => {
  const sourceFiles = listFiles('src').filter(
    (file) => file.endsWith('.ts') || file.endsWith('.tsx')
  )
  const source = sourceFiles.map(read).join('\n')
  const invokedChannels = new Set(matches(source, /ipcRenderer\.invoke\(\s*'([^']+)'/g))
  const handledChannels = new Set(matches(source, /ipcMain\.handle\(\s*'([^']+)'/g))

  assert.deepEqual(
    [...invokedChannels].filter((channel) => !handledChannels.has(channel)).sort(),
    []
  )
  assert.deepEqual(
    [...handledChannels].filter((channel) => !invokedChannels.has(channel)).sort(),
    []
  )
  assert.ok(invokedChannels.has('restart-app'))
})

test('preload declarations stay aligned with exposed Electron APIs', () => {
  const preload = read('src/preload/index.ts')
  const declarations = read('src/preload/api.ts')
  const exposedApiNames = new Set(matches(preload, /^\s{2}([A-Za-z]\w*):/gm))
  const electronApiBody =
    declarations.match(/export interface ElectronAPI \{([\s\S]*)\n\}/)?.[1] ?? ''
  const declaredApiNames = new Set(matches(electronApiBody, /^\s{2}([A-Za-z]\w*):/gm))

  assert.deepEqual(
    [...exposedApiNames].filter((apiName) => !declaredApiNames.has(apiName)).sort(),
    []
  )
  assert.deepEqual(
    [...declaredApiNames].filter((apiName) => !exposedApiNames.has(apiName)).sort(),
    []
  )
  assert.ok(exposedApiNames.has('restartApp'))
})

test('renderer wrapper exports are called outside their wrapper modules', () => {
  const wrapperFiles = ['src/renderer/src/lib/electron.ts', 'src/renderer/src/lib/store.ts']
  const wrappers = wrapperFiles.map(read).join('\n')
  const wrapperExportNames = new Set(matches(wrappers, /export const ([A-Za-z]\w*)/g))
  const rendererSource = listFiles('src/renderer/src')
    .filter((file) => {
      const normalizedFile = toPosix(file)

      return (
        (normalizedFile.endsWith('.ts') || normalizedFile.endsWith('.tsx')) &&
        !wrapperFiles.includes(normalizedFile)
      )
    })
    .map(read)
    .join('\n')

  assert.deepEqual(
    [...wrapperExportNames]
      .filter((apiName) => !new RegExp(`\\b${apiName}\\b`).test(rendererSource))
      .sort(),
    []
  )
})
