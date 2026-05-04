import { execFile } from 'child_process'

const CACHE_TTL_MS = 500

let cachedResult: Set<string> | undefined
let cachedAt = 0
let inflight: Promise<Set<string>> | undefined

function spawnTasklist(): Promise<Set<string>> {
  return new Promise<Set<string>>((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        console.error('Failed to read running processes:', error)
        resolve(new Set())
        return
      }

      const names = new Set<string>()
      stdout.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^"([^"]+)"/)
        if (match) {
          names.add(match[1].toLowerCase())
        }
      })
      resolve(names)
    })
  })
}

export function readRunningProcessNames(): Promise<Set<string>> {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return Promise.resolve(cachedResult)
  }

  if (inflight) {
    return inflight
  }

  inflight = spawnTasklist()
    .then((names) => {
      cachedResult = names
      cachedAt = Date.now()
      return names
    })
    .finally(() => {
      inflight = undefined
    })

  return inflight
}

export function invalidateProcessNameCache() {
  cachedResult = undefined
  cachedAt = 0
}
