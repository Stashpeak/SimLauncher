import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const realPath = (file) => {
  try {
    return fs.realpathSync(file)
  } catch {
    return path.resolve(file)
  }
}

/**
 * True when the module at `moduleUrl` is the script Node was started with, so
 * a gate script can be imported for its rules without running its check.
 *
 * Both sides go through realpath because Node resolves junctions and symlinks
 * before it sets import.meta.url but leaves process.argv[1] as typed. Compared
 * raw, a start through a junction skipped main() and exited 0: a gate that
 * passed without checking anything (#998). Not `import.meta.main`: it arrived
 * in Node 24.2, engines allows any 24, and where it is undefined the check
 * would skip just as silently.
 *
 * @param {string} moduleUrl the caller's import.meta.url
 * @param {string | undefined} [argv1] the started script; a parameter only so
 *   the junction case can be tested without spawning the gate
 * @returns {boolean}
 */
export function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  return realPath(argv1) === realPath(fileURLToPath(moduleUrl))
}
