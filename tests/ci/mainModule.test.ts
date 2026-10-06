import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
// @ts-expect-error - plain .mjs repo tooling, no type declarations by design
import { isMainModule } from '../../scripts/isMainModule.mjs'

/**
 * Guards the main-module check the gate scripts share (#998).
 *
 * Node resolves a junction or symlink before it sets import.meta.url but
 * leaves process.argv[1] as typed. Compared raw, a gate started through one
 * skipped its check and exited 0: a pass that checked nothing.
 */

const scriptsDir = fileURLToPath(new URL('../../scripts/', import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'main-module-'))
const linkedScripts = path.join(tmp, 'scripts')
// 'junction' needs no privilege on Windows; elsewhere the type is ignored and
// a directory symlink is made, which sets the same trap.
fs.symlinkSync(scriptsDir, linkedScripts, 'junction')

afterAll(() => {
  // Remove the link itself before the temp dir, so nothing recursive ever
  // walks through it into scripts/. unlink removes a symlink, rmdir a junction.
  try {
    fs.unlinkSync(linkedScripts)
  } catch {
    fs.rmdirSync(linkedScripts)
  }
  fs.rmSync(tmp, { recursive: true, force: true })
})

const sizeCheck = path.join(scriptsDir, 'checkSizeBudget.mjs')
const sizeCheckUrl = pathToFileURL(sizeCheck).href
const sizeCheckThroughLink = path.join(linkedScripts, 'checkSizeBudget.mjs')

describe('isMainModule', () => {
  it('recognises a start through a junction or symlink', () => {
    // The raw paths differ, which is the trap this guards against.
    expect(path.resolve(sizeCheckThroughLink)).not.toBe(fileURLToPath(sizeCheckUrl))
    expect(isMainModule(sizeCheckUrl, sizeCheckThroughLink)).toBe(true)
  })

  it('is false for another script, and when there is no started script', () => {
    expect(isMainModule(sizeCheckUrl, path.join(scriptsDir, 'countCodeLines.mjs'))).toBe(false)
    expect(isMainModule(sizeCheckUrl, undefined)).toBe(false)
  })

  it.each(['checkSizeBudget.mjs', 'auditShippedRuntime.mjs'])(
    '%s runs its check only through isMainModule',
    (script) => {
      const source = fs.readFileSync(path.join(scriptsDir, script), 'utf8')
      expect(source).toMatch(/if \(isMainModule\(import\.meta\.url\)\) \{\s*(await )?main\(\)/)
    }
  )

  it('actually runs the size check when it is started through a junction', () => {
    const run = spawnSync(process.execPath, [sizeCheckThroughLink], { encoding: 'utf8' })
    expect(run.stdout).toContain('Code-line budget')
  }, 30_000)
})
